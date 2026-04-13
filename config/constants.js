const os = require("os");
const path = require("path");

const HOME_DIR = os.homedir();
const CONFIG_PATH = path.join(HOME_DIR, ".br-config.json");
const STATE_DIR = path.join(HOME_DIR, ".br");
const HISTORY_DIR = path.join(HOME_DIR, ".br-history");
const LOG_DIR = path.join(STATE_DIR, "logs");
const HISTORY_PATH = path.join(STATE_DIR, "history.json");
const CURRENT_RUN_PATH = path.join(STATE_DIR, "current-run.json");
const AGENT_HEARTBEAT_PATH = path.join(STATE_DIR, "agent-heartbeat.json");
const LAST_RUN_PATH = path.join(HISTORY_DIR, "last-run.json");
const LAUNCH_AGENT_DIR = path.join(
  HOME_DIR,
  "Library",
  "LaunchAgents"
);
const FULL_LAUNCH_AGENT_LABEL = "com.breachrabbit.br.full";
const QUICK_LAUNCH_AGENT_LABEL = "com.breachrabbit.br.quick";
const AGENT_LAUNCH_AGENT_LABEL = "com.breachrabbit.br.agent";
const FULL_LAUNCH_AGENT_PATH = path.join(LAUNCH_AGENT_DIR, "br.full.plist");
const QUICK_LAUNCH_AGENT_PATH = path.join(LAUNCH_AGENT_DIR, "br.quick.plist");
const AGENT_LAUNCH_AGENT_PATH = path.join(LAUNCH_AGENT_DIR, "br.agent.plist");
const LAUNCHD_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const DEFAULT_ENDPOINT = "";
const DEFAULT_RCLONE_REMOTE = "br-s3";

module.exports = {
  AGENT_LAUNCH_AGENT_LABEL,
  AGENT_LAUNCH_AGENT_PATH,
  AGENT_HEARTBEAT_PATH,
  CONFIG_PATH,
  CURRENT_RUN_PATH,
  DEFAULT_ENDPOINT,
  DEFAULT_RCLONE_REMOTE,
  FULL_LAUNCH_AGENT_LABEL,
  FULL_LAUNCH_AGENT_PATH,
  HISTORY_PATH,
  HISTORY_DIR,
  HOME_DIR,
  LAST_RUN_PATH,
  LAUNCH_AGENT_DIR,
  LAUNCHD_PATH,
  LOG_DIR,
  QUICK_LAUNCH_AGENT_LABEL,
  QUICK_LAUNCH_AGENT_PATH,
  STATE_DIR
};
