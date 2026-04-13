const { parseArgs } = require("./args");
const { runBackupMode, printHistory } = require("../backup/runner");
const { findLogPathByBackupId, getAvailableLogs, printLogFile, printLogList } = require("../backup/log-viewer");
const { computeRetentionPlan, pruneLocalBackups } = require("../backup/retention");
const { loadHistory, loadLastRuns, saveHistory } = require("../backup/history-service");
const { runSettingsMenu } = require("../config/settings");
const { runSetupWizard } = require("../config/setup");
const { ensureStateDirectories, hasConfig, loadConfig, saveConfig } = require("../config/store");
const { printRestorePlan, runRestore } = require("../restore/service");
const {
  disableMenuBarAgent,
  disableSchedule,
  getMenuBarAgentStatus,
  getScheduleStatus,
  installMenuBarAgent,
  installFullSchedule,
  installQuickSchedule
} = require("../scheduler/launchd");
const { getUpdateNotice, printUpdateStatus } = require("./update-check");
const { notify } = require("../ui/notifications");
const {
  promptFullScheduleConfig,
  promptLogsMenu,
  promptMainMenu,
  promptQuickScheduleConfig,
  promptScheduleMenu
} = require("../ui/menu");
const { formatRelativeTimestamp, formatTimestamp } = require("./time");
const { waitForEnter } = require("../ui/prompts");
const output = require("../ui/output");

function printConfigWarnings(config) {
  (config.warnings || []).forEach((warning) => {
    output.warn(warning);
  });
}

function printHelp() {
  output.header("usage");
  output.print("br run                 Run full backup");
  output.print("br quick               Run quick backup");
  output.print("br setup               Run setup wizard");
  output.print("br settings            Edit one configuration section");
  output.print("br history [--limit N] Show backup history");
  output.print("br logs [--backup-id ID] [--lines N] View backup logs");
  output.print("br schedule            Open interactive schedule menu");
  output.print("br schedule status");
  output.print("br schedule enable --mode full --time 02:00");
  output.print("br schedule enable --mode quick --interval-minutes 60");
  output.print("br schedule disable [--mode full|quick|all]");
  output.print("br agent install       Enable the macOS menu bar agent");
  output.print("br agent disable       Disable the macOS menu bar agent");
  output.print("br agent status        Show menu bar agent status");
  output.print("br restore plan [--backup-id ID] [--at ISO]");
  output.print("br restore run --backup-id ID --target /path [--include-incrementals]");
  output.print("br retention [--apply]");
  output.print("br update              Check for updates");
  output.print("br notify-test         Send a test macOS notification");
  output.print("br --debug             Show verbose errors");
}

async function ensureConfigLoaded() {
  if (hasConfig()) {
    const config = loadConfig();
    printConfigWarnings(config);
    return config;
  }

  output.warn("Config not found. Starting setup wizard.");
  return runSetupWizard();
}

function formatInterval(intervalMinutes) {
  const value = Number(intervalMinutes) || 60;
  if (value >= 60 && value % 60 === 0) {
    const hours = value / 60;
    return `every ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `every ${value} minute${value === 1 ? "" : "s"}`;
}

function computeNextFullRun(time) {
  const [hour, minute] = String(time || "02:00").split(":").map((value) => Number(value));
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next <= new Date()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function computeNextQuickRun(intervalMinutes, lastRun) {
  const base = lastRun ? new Date(lastRun) : new Date();
  const next = new Date(base.getTime() + (Number(intervalMinutes) || 60) * 60 * 1000);
  return next;
}

function printScheduleStatus() {
  const status = getScheduleStatus();
  const lastRuns = loadLastRuns();
  const iconForStatus = (value) => {
    if (value === "success") {
      return "✔";
    }
    if (value === "error") {
      return "✖";
    }
    return "⚠";
  };

  output.header("schedule");
  output.print("Schedule status");
  output.print("");
  output.print("Full backup:");
  output.print(status.full.enabled ? `enabled • daily at ${status.full.time}` : "disabled (not scheduled)");

  output.print("");
  output.print("Quick backup:");
  output.print(status.quick.enabled ? `enabled • ${formatInterval(status.quick.intervalMinutes)}` : "disabled (not scheduled)");

  output.print("");
  output.print("Next run:");
  output.print(
    `full: ${status.full.enabled ? formatRelativeTimestamp(computeNextFullRun(status.full.time)) : "not scheduled"}`
  );
  output.print(
    `quick: ${status.quick.enabled ? formatRelativeTimestamp(computeNextQuickRun(status.quick.intervalMinutes, lastRuns.quick && lastRuns.quick.endedAt)) : "not scheduled"}`
  );

  output.print("");
  output.print("Last run:");
  output.print(
    `full: ${lastRuns.full ? `${formatRelativeTimestamp(lastRuns.full.endedAt)} ${iconForStatus(lastRuns.full.status)}` : "never"}`
  );
  output.print(
    `quick: ${lastRuns.quick ? `${formatRelativeTimestamp(lastRuns.quick.endedAt)} ${iconForStatus(lastRuns.quick.status)}` : "never"}`
  );
}

function handleRetention(config, options) {
  const history = loadHistory();
  const plan = computeRetentionPlan(history, config.retention);

  output.header("retention");
  output.printKeyValue("Local prune candidates", plan.local.length);
  output.printKeyValue("Remote prune candidates", plan.remote.length);

  if (options.apply) {
    pruneLocalBackups(plan.local);
    const removed = new Set(plan.local.map((entry) => entry.backupId));
    saveHistory(history.filter((entry) => !removed.has(entry.backupId)));
    output.success("Local retention cleanup applied.");
  }
}

async function handleInteractiveSchedule(config) {
  let currentConfig = config;

  while (true) {
    const action = await promptScheduleMenu();

    if (!action || action === "back") {
      return currentConfig;
    }

    if (action === "status") {
      printScheduleStatus();
      await waitForEnter();
      continue;
    }

    if (action === "disable-full") {
      disableSchedule("full");
      currentConfig.schedule.full.enabled = false;
      currentConfig = saveConfig(currentConfig);
      output.success("Full backup schedule disabled.");
      await waitForEnter();
      continue;
    }

    if (action === "disable-quick") {
      disableSchedule("quick");
      currentConfig.schedule.quick.enabled = false;
      currentConfig = saveConfig(currentConfig);
      output.success("Quick backup schedule disabled.");
      await waitForEnter();
      continue;
    }

    if (action === "disable") {
      disableSchedule("all");
      currentConfig.schedule.full.enabled = false;
      currentConfig.schedule.quick.enabled = false;
      currentConfig = saveConfig(currentConfig);
      output.success("All schedules disabled.");
      await waitForEnter();
      continue;
    }

    if (action === "full") {
      const schedule = await promptFullScheduleConfig(currentConfig.schedule.full);
      installFullSchedule(schedule);
      currentConfig.schedule.full = {
        enabled: true,
        time: schedule.time
      };
      currentConfig = saveConfig(currentConfig);
      output.success(`Full backup scheduled daily at ${schedule.time}.`);
      await waitForEnter();
      continue;
    }

    if (action === "quick") {
      const schedule = await promptQuickScheduleConfig(currentConfig.schedule.quick);
      installQuickSchedule(schedule);
      currentConfig.schedule.quick = {
        enabled: true,
        intervalMinutes: schedule.intervalMinutes
      };
      currentConfig = saveConfig(currentConfig);
      output.success(`Quick backup scheduled ${formatInterval(schedule.intervalMinutes)}.`);
      await waitForEnter();
    }
  }
}

async function handleInteractiveLogs() {
  while (true) {
    const logs = getAvailableLogs(20);

    if (logs.length === 0) {
      printLogList(20);
      await waitForEnter();
      return;
    }

    const choice = await promptLogsMenu(logs);
    if (!choice || choice === "back") {
      return;
    }

    const logPath = findLogPathByBackupId(choice);
    if (!logPath) {
      output.warn("Selected log is no longer available.");
      await waitForEnter();
      continue;
    }

    printLogFile(logPath, { lines: 200 });
    await waitForEnter();
  }
}

async function runInteractiveShell() {
  ensureStateDirectories();

  while (true) {
    const updateNotice = await getUpdateNotice();
    const menuCommand = await promptMainMenu({ updateNotice });

    if (!menuCommand) {
      return;
    }

    const [command] = menuCommand;

    if (command === "schedule") {
      const config = await ensureConfigLoaded();
      await handleInteractiveSchedule(config);
      continue;
    }

    if (command === "settings") {
      const config = await ensureConfigLoaded();
      await runSettingsMenu(config);
      continue;
    }

    if (command === "logs") {
      await handleInteractiveLogs();
      continue;
    }

    await run(menuCommand);
    if (process.stdin.isTTY && process.stdout.isTTY && command !== "setup") {
      await waitForEnter();
    }
  }
}

async function run(argv) {
  if (argv.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      return runInteractiveShell();
    }

    printHelp();
    return;
  }

  const [command, ...rest] = argv;
  const options = parseArgs(rest);

  switch (command) {
    case "--help":
    case "-h":
    case "help":
      printHelp();
      return;

    case "setup":
      ensureStateDirectories();
      await runSetupWizard();
      return;

    case "settings": {
      ensureStateDirectories();
      const config = await ensureConfigLoaded();
      await runSettingsMenu(config);
      return;
    }

    case "run": {
      ensureStateDirectories();
      const config = await ensureConfigLoaded();
      const result = await runBackupMode("full", config);
      if (result.status !== "success") {
        process.exitCode = 1;
      }
      return;
    }

    case "quick": {
      ensureStateDirectories();
      const config = await ensureConfigLoaded();
      const result = await runBackupMode("quick", config);
      if (result.status !== "success") {
        process.exitCode = 1;
      }
      return;
    }

    case "history":
      ensureStateDirectories();
      printHistory(options.limit || 10);
      return;

    case "logs":
      ensureStateDirectories();
      if (options["backup-id"]) {
        const logPath = findLogPathByBackupId(String(options["backup-id"]));
        if (!logPath) {
          throw new Error(`Log not found for backup: ${options["backup-id"]}`);
        }
        printLogFile(logPath, { lines: options.lines || 200 });
        return;
      }

      if (process.stdin.isTTY && process.stdout.isTTY) {
        await handleInteractiveLogs();
          return;
      }
      printLogList(options.limit || 20);
      return;

    case "schedule": {
      ensureStateDirectories();
      if (!options._[0]) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          const config = await ensureConfigLoaded();
          await handleInteractiveSchedule(config);
          return;
        }

        printScheduleStatus();
        return;
      }

      if (options._[0] === "status") {
        printScheduleStatus();
        return;
      }

      if (options._[0] === "enable") {
        const config = await ensureConfigLoaded();

        if (options.mode === "quick") {
          const schedule = "interval-minutes" in options
            ? { intervalMinutes: Number(options["interval-minutes"]) }
            : await promptQuickScheduleConfig(config.schedule.quick);
          installQuickSchedule(schedule);
          config.schedule.quick = {
            enabled: true,
            intervalMinutes: schedule.intervalMinutes
          };
          saveConfig(config);
          output.success(`Quick backup scheduled ${formatInterval(schedule.intervalMinutes)}.`);
          return;
        }

        const schedule = options.time
          ? { time: String(options.time) }
          : await promptFullScheduleConfig(config.schedule.full);
        installFullSchedule(schedule);
        config.schedule.full = {
          enabled: true,
          time: schedule.time
        };
        saveConfig(config);
        output.success(`Full backup scheduled daily at ${schedule.time}.`);
        return;
      }

      if (options._[0] === "disable") {
        const config = await ensureConfigLoaded();
        const mode = options.mode || "all";
        disableSchedule(mode);
        if (mode === "all" || mode === "full") {
          config.schedule.full.enabled = false;
        }
        if (mode === "all" || mode === "quick") {
          config.schedule.quick.enabled = false;
        }
        saveConfig(config);
        output.success(mode === "all" ? "All schedules disabled." : `${mode} schedule disabled.`);
        return;
      }

      throw new Error(`Unknown schedule action: ${options._[0]}`);
    }

    case "agent": {
      ensureStateDirectories();
      const action = options._[0] || "status";

      if (action === "install" || action === "enable") {
        const result = installMenuBarAgent();
        output.success(`Menu bar agent enabled at ${result.path}`);
        return;
      }

      if (action === "disable") {
        disableMenuBarAgent();
        output.success("Menu bar agent disabled.");
        return;
      }

      if (action === "status") {
        const status = getMenuBarAgentStatus();
        output.header("agent");
        output.print(`Menu bar agent: ${status.enabled ? "enabled" : "disabled"}`);
        output.print(`LaunchAgent: ${status.path}`);
        return;
      }

      throw new Error(`Unknown agent action: ${action}`);
    }

    case "restore": {
      ensureStateDirectories();
      const config = await ensureConfigLoaded();
      const action = options._[0] || "plan";

      if (action === "plan") {
        printRestorePlan({
          backupId: options["backup-id"],
          at: options.at
        });
        return;
      }

      if (action === "run") {
        runRestore(
          {
            backupId: options["backup-id"],
            at: options.at,
            target: options.target,
            includeIncrementals: Boolean(options["include-incrementals"])
          },
          config
        );
        return;
      }

      throw new Error(`Unknown restore action: ${action}`);
    }

    case "retention": {
      ensureStateDirectories();
      const config = await ensureConfigLoaded();
      handleRetention(config, options);
      return;
    }

    case "update":
      ensureStateDirectories();
      await printUpdateStatus();
      return;

    case "notify-test":
      ensureStateDirectories();
      notify("BR Labs", "Test notification from br");
      output.success("Test notification sent.");
      return;

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

module.exports = {
  run
};
