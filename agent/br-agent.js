#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const { loadLastRuns } = require("../backup/history-service");
const { clearAgentHeartbeat, loadCurrentRun, updateAgentHeartbeat } = require("../backup/runtime-state");
const { LAUNCHD_PATH } = require("../config/constants");
const { hasConfig, loadConfig } = require("../config/store");
const { ensureRcloneInstalled, testConnection } = require("../core/storage/rclone");
const { formatRelativeTimestamp } = require("../core/time");
const { getLaunchdRuntimeStatus, getScheduleStatus } = require("../scheduler/launchd");

try {
  const electron = require("electron");
  if (typeof electron === "string") {
    const child = spawn(electron, [__filename], {
      detached: true,
      env: {
        ...process.env,
        PATH: process.env.PATH || LAUNCHD_PATH
      },
      stdio: "ignore"
    });
    child.unref();
    process.exit(0);
  }

  var { app, Menu, Notification, nativeImage } = electron;
  var { menubar } = require("menubar");
} catch (error) {
  process.stderr.write(`BR Labs agent requires Electron and menubar: ${error.message}\n`);
  process.exit(1);
}

const state = {
  currentStep: "",
  detail: "",
  elapsedLabel: "",
  lastBackupId: null,
  lastExitCode: null,
  mode: null,
  percent: null,
  running: false,
  schedule: {
    full: "disabled",
    quick: "disabled",
    launchd: "unknown"
  },
  storage: {
    detail: "not checked",
    ok: false
  }
};

let lastMenuPaintAt = 0;

function runCommand(command, args = []) {
  const child = spawn(command, args, {
    detached: true,
    env: {
      ...process.env,
      PATH: process.env.PATH || LAUNCHD_PATH
    },
    stdio: "ignore"
  });
  child.unref();
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function notify(title, body) {
  if (!Notification || !Notification.isSupported()) {
    return;
  }
  try {
    if (hasConfig() && loadConfig().notificationEnabled === false) {
      return;
    }
  } catch (_) {
    // Notification fallback should never crash the agent.
  }

  new Notification({
    body,
    icon: path.join(__dirname, "..", "ui", "assets", "icon.png"),
    title
  }).show();
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseBackupOutput(chunk) {
  stripAnsi(chunk)
    .split(/\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith("{")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "progress") {
            state.currentStep = String(event.label || "").toLowerCase();
            state.detail = String(event.detail || "");
            state.percent = Number(event.percent);
            paintMenuThrottled();
            return;
          }
        } catch (_) {
          // Continue with human output parsing below.
        }
      }

      const percentMatch = line.match(/([0-9]{1,3})%/);
      if (percentMatch) {
        state.percent = Math.max(0, Math.min(100, Number(percentMatch[1])));
      }

      if (line.includes("Syncing repositories")) {
        state.currentStep = "syncing repositories";
        state.detail = "";
        state.percent = null;
      } else if (line.includes("Creating repository backups")) {
        state.currentStep = "creating backups";
      } else if (line.includes("Uploading repositories") || line.includes("Repository upload progress")) {
        state.currentStep = "uploading repositories";
      } else if (line.includes("Uploading environment") || line.includes("Environment upload progress")) {
        state.currentStep = "uploading environment";
      } else if (line.includes("Backup completed") || line.includes("Backup successful")) {
        state.currentStep = "completed";
        state.percent = 100;
      }
      paintMenuThrottled();
    });
}

function runBrBackup(mode) {
  if (state.running) {
    notify("BR Labs", "Backup is already running");
    return;
  }

  const command = mode === "quick" ? "quick" : "run";
  state.running = true;
  state.mode = mode;
  state.detail = "";
  state.percent = null;
  state.currentStep = "starting";
  state.lastExitCode = null;
  renderMenu();

  const child = spawn("br", [command], {
    env: {
      ...process.env,
      BR_AGENT_PROGRESS: "1",
      BR_SUPPRESS_CLI_NOTIFICATIONS: "1",
      PATH: process.env.PATH || LAUNCHD_PATH
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", parseBackupOutput);
  child.stderr.on("data", parseBackupOutput);

  child.on("error", (error) => {
    state.running = false;
    state.detail = "";
    state.currentStep = "failed";
    state.lastExitCode = 1;
    notify("BR Labs", `Backup failed: ${error.message}`);
    renderMenu();
  });

  child.on("close", (code) => {
    state.running = false;
    state.detail = "";
    state.percent = null;
    state.lastExitCode = code;
    state.currentStep = code === 0 ? "completed" : "failed";
    notify("BR Labs", code === 0 ? "Backup completed successfully" : "Backup failed");
    refreshStatus();
    renderMenu();
  });
}

function openTerminal(command) {
  const script = [
    'tell application "Terminal"',
    "activate",
    `do script ${JSON.stringify(command)}`,
    "end tell"
  ].join("\n");
  runCommand("osascript", ["-e", script]);
}

function latestRun() {
  const lastRuns = loadLastRuns();
  const runs = [lastRuns.full, lastRuns.quick].filter(Boolean);
  if (runs.length === 0) {
    return null;
  }

  return runs.sort((left, right) => new Date(right.endedAt) - new Date(left.endedAt))[0];
}

function backupStatusLabel() {
  if (!state.running) {
    return latestRunLabel();
  }

  const percent = Number.isFinite(state.percent) ? ` ${state.percent}%` : "";
  const step = state.currentStep ? ` • ${state.currentStep}` : "";
  const detail = state.detail ? ` • ${state.detail}` : "";
  const elapsed = state.elapsedLabel ? ` • ${state.elapsedLabel}` : "";
  return `Backup running:${percent}${step}${detail}${elapsed}`;
}

function statusIcon(status) {
  if (status === "success") {
    return "✔";
  }
  if (status === "error") {
    return "✖";
  }
  return "⚠";
}

function formatAgentTime(input) {
  const date = new Date(input);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  return formatRelativeTimestamp(input);
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function latestRunLabel() {
  const run = latestRun();
  if (!run) {
    return "Last backup: never";
  }

  return `Last backup: ${statusIcon(run.status)} ${formatAgentTime(run.endedAt)}`;
}

function formatScheduleLine(mode, value, loaded) {
  if (!value.enabled) {
    return `${mode}: disabled`;
  }

  const status = loaded ? "loaded" : "not loaded";
  if (mode === "full") {
    return `full: daily at ${value.time} • ${status}`;
  }

  const interval = value.intervalMinutes >= 60 && value.intervalMinutes % 60 === 0
    ? `every ${value.intervalMinutes / 60}h`
    : `every ${value.intervalMinutes}m`;
  return `quick: ${interval} • ${status}`;
}

function refreshStatus() {
  const currentRun = loadCurrentRun();
  if (currentRun && currentRun.status === "running" && isProcessAlive(currentRun.pid)) {
    state.running = true;
    state.mode = currentRun.mode;
    state.detail = currentRun.detail || currentRun.currentRepo || "";
    state.percent = Number.isFinite(currentRun.percent) ? currentRun.percent : null;
    state.currentStep = currentRun.step || "running";
    state.elapsedLabel = formatElapsed(currentRun.elapsedMs || (Date.now() - new Date(currentRun.startedAt).getTime()));
  } else {
    state.running = false;
    state.detail = "";
    state.percent = null;
    state.currentStep = "";
    state.elapsedLabel = "";
  }

  const run = latestRun();
  if (run && run.backupId && state.lastBackupId && run.backupId !== state.lastBackupId && !state.running) {
    notify("BR Labs", `Backup finished: ${statusIcon(run.status)} ${run.mode}`);
  }
  if (run && run.backupId) {
    state.lastBackupId = run.backupId;
  }

  try {
    const schedule = getScheduleStatus();
    const launchd = getLaunchdRuntimeStatus();
    state.schedule = {
      full: formatScheduleLine("full", schedule.full, launchd.full),
      launchd: launchd.agent ? "agent: loaded" : "agent: not loaded",
      quick: formatScheduleLine("quick", schedule.quick, launchd.quick)
    };
  } catch (error) {
    state.schedule = {
      full: "full: unknown",
      launchd: "agent: unknown",
      quick: "quick: unknown"
    };
  }
}

function refreshStorageStatus() {
  try {
    if (!hasConfig()) {
      state.storage = {
        detail: "not configured",
        ok: false
      };
      return;
    }

    const config = loadConfig();
    const rclonePath = ensureRcloneInstalled(config);
    testConnection(config);
    state.storage = {
      detail: `connected • ${path.basename(rclonePath)}`,
      ok: true
    };
  } catch (error) {
    state.storage = {
      detail: error && error.code === "RCLONE_MISSING" ? "rclone unavailable" : "connection failed",
      ok: false
    };
  }
}

function buildMenu(renderMenu) {
  return Menu.buildFromTemplate([
    {
      enabled: false,
      label: "BR Labs"
    },
    {
      type: "separator"
    },
    {
      click: () => runBrBackup("full"),
      enabled: !state.running,
      label: "Run full backup"
    },
    {
      click: () => runBrBackup("quick"),
      enabled: !state.running,
      label: "Run quick backup"
    },
    {
      type: "separator"
    },
    {
      enabled: false,
      label: backupStatusLabel()
    },
    {
      enabled: false,
      label: `Storage: ${state.storage.ok ? "✔" : "⚠"} ${state.storage.detail}`
    },
    {
      enabled: false,
      label: `Schedule: ${state.schedule.full}`
    },
    {
      enabled: false,
      label: `Schedule: ${state.schedule.quick}`
    },
    {
      enabled: false,
      label: `Agent: ${state.schedule.launchd.replace(/^agent: /, "")}`
    },
    {
      type: "separator"
    },
    {
      click: () => openTerminal("br"),
      label: "Open CLI"
    },
    {
      click: () => openTerminal("br setup"),
      label: "Setup"
    },
    {
      click: () => openTerminal("br settings"),
      label: "Settings"
    },
    {
      click: () => openTerminal("br schedule"),
      label: "Schedule"
    },
    {
      click: () => openTerminal("br history"),
      label: "View history"
    },
    {
      click: () => openTerminal("br doctor"),
      label: "Doctor"
    },
    {
      click: () => openTerminal("br logs"),
      label: "View logs"
    },
    {
      type: "separator"
    },
    {
      click: () => {
        refreshStorageStatus();
        refreshStatus();
        renderMenu();
      },
      label: "Refresh"
    },
    {
      type: "separator"
    },
    {
      click: () => app.quit(),
      label: "Quit"
    }
  ]);
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, "..", "ui", "assets", "menubar-iconTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
}

const mb = menubar({
  browserWindow: {
    height: 1,
    show: false,
    width: 1
  },
  icon: createTrayIcon(),
  preloadWindow: false,
  showDockIcon: false,
  tooltip: "BR Labs"
});

function paintMenu() {
  mb.tray.setContextMenu(buildMenu(renderMenu));
}

function paintMenuThrottled() {
  const now = Date.now();
  if (now - lastMenuPaintAt < 750 || !mb.tray) {
    return;
  }
  lastMenuPaintAt = now;
  paintMenu();
}

function renderMenu() {
  refreshStatus();
  paintMenu();
}

mb.on("ready", () => {
  if (app.dock) {
    app.dock.hide();
  }
  app.setName("BR Labs");
  updateAgentHeartbeat({
    source: "br-agent"
  });
  refreshStorageStatus();
  refreshStatus();
  renderMenu();
  setInterval(() => {
    updateAgentHeartbeat({
      source: "br-agent"
    });
  }, 5000).unref();
  setInterval(() => {
    refreshStatus();
    paintMenu();
  }, 1000).unref();
  setInterval(() => {
    refreshStorageStatus();
    renderMenu();
  }, 60 * 1000).unref();
  setInterval(renderMenu, 30 * 1000).unref();
});

app.on("before-quit", () => {
  clearAgentHeartbeat();
});
