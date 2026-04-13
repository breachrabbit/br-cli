const fs = require("fs");
const path = require("path");
const { RBError } = require("../core/errors");
const { ensureDir } = require("../core/fs-utils");
const { runCommand } = require("../core/process");
const {
  AGENT_LAUNCH_AGENT_LABEL,
  AGENT_LAUNCH_AGENT_PATH,
  FULL_LAUNCH_AGENT_LABEL,
  FULL_LAUNCH_AGENT_PATH,
  LAUNCH_AGENT_DIR,
  LAUNCHD_PATH,
  LOG_DIR,
  QUICK_LAUNCH_AGENT_LABEL,
  QUICK_LAUNCH_AGENT_PATH
} = require("../config/constants");

function buildNodeScriptProgramArguments(scriptPath, args = []) {
  return `
    <key>ProgramArguments</key>
    <array>
      <string>${process.execPath}</string>
      <string>${scriptPath}</string>
${args.map((arg) => `      <string>${arg}</string>`).join("\n")}
    </array>`;
}

function buildProgramArguments(mode) {
  return buildNodeScriptProgramArguments(path.resolve(__dirname, "..", "bin", "br"), [mode]);
}

function buildEnvironmentVariables() {
  return `    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${LAUNCHD_PATH}</string>
      <key>BR_SUPPRESS_CLI_NOTIFICATIONS</key>
      <string>1</string>
    </dict>`;
}

function buildPlist({ label, mode, standardOutPath, standardErrorPath, scheduleBlock }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
${buildProgramArguments(mode)}
${buildEnvironmentVariables()}
${scheduleBlock}
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${standardOutPath}</string>
    <key>StandardErrorPath</key>
    <string>${standardErrorPath}</string>
  </dict>
</plist>
`;
}

function buildAgentPlist() {
  const scriptPath = path.resolve(__dirname, "..", "agent", "br-agent.js");
  let electronPath = process.execPath;
  try {
    const electron = require("electron");
    if (typeof electron === "string") {
      electronPath = electron;
    }
  } catch (_) {
    electronPath = process.execPath;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${AGENT_LAUNCH_AGENT_LABEL}</string>
${buildNodeScriptProgramArgumentsWithCommand(electronPath, scriptPath)}
${buildEnvironmentVariables()}
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${path.join(LOG_DIR, "agent.out.log")}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(LOG_DIR, "agent.err.log")}</string>
  </dict>
</plist>
`;
}

function buildNodeScriptProgramArgumentsWithCommand(command, scriptPath, args = []) {
  return `
    <key>ProgramArguments</key>
    <array>
      <string>${command}</string>
      <string>${scriptPath}</string>
${args.map((arg) => `      <string>${arg}</string>`).join("\n")}
    </array>`;
}

function buildFullScheduleBlock(time) {
  const [hour, minute] = String(time || "02:00")
    .split(":")
    .map((value) => Number(value));

  return `    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>`;
}

function buildQuickScheduleBlock(intervalMinutes) {
  const seconds = Math.max(60, Number(intervalMinutes) * 60);
  return `    <key>StartInterval</key>
    <integer>${seconds}</integer>`;
}

function schedulePaths(mode) {
  if (mode === "agent") {
    return {
      label: AGENT_LAUNCH_AGENT_LABEL,
      out: path.join(LOG_DIR, "agent.out.log"),
      path: AGENT_LAUNCH_AGENT_PATH,
      err: path.join(LOG_DIR, "agent.err.log")
    };
  }

  if (mode === "quick") {
    return {
      label: QUICK_LAUNCH_AGENT_LABEL,
      out: path.join(LOG_DIR, "schedule.quick.out.log"),
      path: QUICK_LAUNCH_AGENT_PATH,
      err: path.join(LOG_DIR, "schedule.quick.err.log")
    };
  }

  return {
    label: FULL_LAUNCH_AGENT_LABEL,
    out: path.join(LOG_DIR, "schedule.full.out.log"),
    path: FULL_LAUNCH_AGENT_PATH,
    err: path.join(LOG_DIR, "schedule.full.err.log")
  };
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new RBError("Scheduling is only supported on macOS.", {
      code: "SCHEDULE_UNSUPPORTED"
    });
  }
}

function runLaunchctl(args, options = {}) {
  const result = runCommand("launchctl", args, { allowFailure: true });

  if (result.status !== 0 && !options.allowFailure) {
    const detail = `${result.stdout}\n${result.stderr}`.trim();
    throw new RBError("failed to enable schedule", {
      code: "SCHEDULE_COMMAND_FAILED",
      details: detail || args.join(" ")
    });
  }

  return result;
}

function writePlist(mode, content) {
  ensureDir(LAUNCH_AGENT_DIR);
  ensureDir(LOG_DIR);
  const paths = schedulePaths(mode);
  fs.writeFileSync(paths.path, content, "utf8");
  return paths;
}

function bootstrapAgent(paths) {
  const uid = String(process.getuid());
  runLaunchctl(["bootout", `gui/${uid}`, paths.path], { allowFailure: true });
  runLaunchctl(["bootstrap", `gui/${uid}`, paths.path]);
  runLaunchctl(["enable", `gui/${uid}/${paths.label}`], { allowFailure: true });
}

function installFullSchedule({ time = "02:00" }) {
  ensureMacOS();
  const plist = buildPlist({
    label: FULL_LAUNCH_AGENT_LABEL,
    mode: "run",
    scheduleBlock: buildFullScheduleBlock(time),
    standardOutPath: schedulePaths("full").out,
    standardErrorPath: schedulePaths("full").err
  });
  const paths = writePlist("full", plist);
  bootstrapAgent(paths);
  return {
    enabled: true,
    mode: "full",
    path: paths.path,
    time
  };
}

function installQuickSchedule({ intervalMinutes = 60 }) {
  ensureMacOS();
  const plist = buildPlist({
    label: QUICK_LAUNCH_AGENT_LABEL,
    mode: "quick",
    scheduleBlock: buildQuickScheduleBlock(intervalMinutes),
    standardOutPath: schedulePaths("quick").out,
    standardErrorPath: schedulePaths("quick").err
  });
  const paths = writePlist("quick", plist);
  bootstrapAgent(paths);
  return {
    enabled: true,
    intervalMinutes,
    mode: "quick",
    path: paths.path
  };
}

function installMenuBarAgent() {
  ensureMacOS();
  const paths = writePlist("agent", buildAgentPlist());
  bootstrapAgent(paths);
  return {
    enabled: true,
    mode: "agent",
    path: paths.path
  };
}

function disableSchedule(mode = "all") {
  ensureMacOS();
  const uid = String(process.getuid());
  const modes = mode === "all" ? ["full", "quick"] : [mode];

  modes.forEach((currentMode) => {
    const paths = schedulePaths(currentMode);
    runLaunchctl(["bootout", `gui/${uid}`, paths.path], { allowFailure: true });
    if (fs.existsSync(paths.path)) {
      fs.unlinkSync(paths.path);
    }
  });
}

function disableMenuBarAgent() {
  ensureMacOS();
  const uid = String(process.getuid());
  const paths = schedulePaths("agent");
  runLaunchctl(["bootout", `gui/${uid}`, paths.path], { allowFailure: true });
  if (fs.existsSync(paths.path)) {
    fs.unlinkSync(paths.path);
  }
}

function getMenuBarAgentStatus() {
  const paths = schedulePaths("agent");
  return {
    enabled: fs.existsSync(paths.path),
    label: paths.label,
    path: paths.path
  };
}

function isLaunchAgentLoaded(label) {
  if (process.platform !== "darwin") {
    return false;
  }

  const uid = String(process.getuid());
  const result = runLaunchctl(["print", `gui/${uid}/${label}`], { allowFailure: true });
  return result.status === 0;
}

function getLaunchdRuntimeStatus() {
  return {
    full: isLaunchAgentLoaded(FULL_LAUNCH_AGENT_LABEL),
    quick: isLaunchAgentLoaded(QUICK_LAUNCH_AGENT_LABEL),
    agent: isLaunchAgentLoaded(AGENT_LAUNCH_AGENT_LABEL)
  };
}

function parseScheduleStatusFromFile(mode) {
  const paths = schedulePaths(mode);
  if (!fs.existsSync(paths.path)) {
    return {
      enabled: false,
      mode
    };
  }

  const content = fs.readFileSync(paths.path, "utf8");
  if (mode === "quick") {
    const intervalMatch = content.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
    return {
      enabled: true,
      intervalMinutes: intervalMatch ? Number(intervalMatch[1]) / 60 : null,
      mode,
      path: paths.path
    };
  }

  const hourMatch = content.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
  const minuteMatch = content.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
  return {
    enabled: true,
    mode,
    path: paths.path,
    time: `${String(hourMatch ? Number(hourMatch[1]) : 2).padStart(2, "0")}:${String(minuteMatch ? Number(minuteMatch[1]) : 0).padStart(2, "0")}`
  };
}

function getScheduleStatus() {
  return {
    full: parseScheduleStatusFromFile("full"),
    quick: parseScheduleStatusFromFile("quick")
  };
}

module.exports = {
  disableSchedule,
  disableMenuBarAgent,
  getMenuBarAgentStatus,
  getLaunchdRuntimeStatus,
  getScheduleStatus,
  installMenuBarAgent,
  installFullSchedule,
  installQuickSchedule
};
