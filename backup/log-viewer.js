const fs = require("fs");
const path = require("path");
const { loadHistory } = require("./history-service");
const { LOG_DIR } = require("../config/constants");
const { formatCompactTimestamp } = require("../core/time");
const output = require("../ui/output");

function getAvailableLogs(limit = 20) {
  const fromHistory = loadHistory()
    .filter((entry) => entry.logPath && fs.existsSync(entry.logPath))
    .map((entry) => ({
      backupId: entry.backupId,
      description: [
        entry.mode === "quick" ? "quick" : "full",
        formatCompactTimestamp(entry.endedAt),
        entry.status
      ].join(" • "),
      logPath: entry.logPath
    }));

  if (fromHistory.length > 0) {
    return fromHistory.slice(0, Number(limit));
  }

  if (!fs.existsSync(LOG_DIR)) {
    return [];
  }

  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.endsWith(".log"))
    .sort()
    .reverse()
    .slice(0, Number(limit))
    .map((name) => ({
      backupId: path.basename(name, ".log"),
      description: path.join(LOG_DIR, name),
      logPath: path.join(LOG_DIR, name)
    }));
}

function printLogList(limit = 20) {
  const logs = getAvailableLogs(limit);
  output.header("logs");

  if (logs.length === 0) {
    output.info("No logs recorded yet.");
    return;
  }

  logs.forEach((entry) => {
    output.statusLine(entry.backupId, "success", entry.description);
  });
  output.print("");
  output.note("Open one with: br logs --backup-id <backup-id>");
}

function printLogFile(logPath, options = {}) {
  const lines = Number(options.lines || 200);
  const content = fs.readFileSync(logPath, "utf8");
  const fileLines = content.split("\n").filter(Boolean);
  const selected = fileLines.slice(-lines);

  output.header(`log • ${path.basename(logPath)}`);
  output.printKeyValue("Path", logPath);
  output.printKeyValue("Lines", selected.length);
  output.print("");

  if (selected.length === 0) {
    output.note("Log file is empty.");
    return;
  }

  selected.forEach((line) => output.print(line));
}

function findLogPathByBackupId(backupId) {
  const entry = loadHistory().find((item) => item.backupId === backupId && item.logPath && fs.existsSync(item.logPath));
  return entry ? entry.logPath : null;
}

module.exports = {
  findLogPathByBackupId,
  getAvailableLogs,
  printLogFile,
  printLogList
};
