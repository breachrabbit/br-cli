const { readJson, writeJson } = require("../core/fs-utils");
const { HISTORY_PATH, LAST_RUN_PATH } = require("../config/constants");

function loadHistory() {
  return readJson(HISTORY_PATH, []);
}

function saveHistory(entries) {
  writeJson(HISTORY_PATH, entries);
}

function loadLastRuns() {
  return readJson(LAST_RUN_PATH, {
    full: null,
    quick: null
  });
}

function saveLastRuns(value) {
  writeJson(LAST_RUN_PATH, value);
}

function appendHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  saveHistory(history.slice(0, 500));

  const lastRuns = loadLastRuns();
  const scheduleMode = entry.mode === "quick" ? "quick" : "full";
  lastRuns[scheduleMode] = {
    backupId: entry.backupId,
    endedAt: entry.endedAt,
    mode: entry.mode,
    status: entry.status
  };
  saveLastRuns(lastRuns);
}

function getLatestSuccessfulBackup(mode = null) {
  return loadHistory().find(
    (entry) => entry.status === "success" && (!mode || entry.mode === mode)
  ) || null;
}

function findBackupById(backupId) {
  return loadHistory().find((entry) => entry.backupId === backupId) || null;
}

module.exports = {
  appendHistory,
  findBackupById,
  getLatestSuccessfulBackup,
  loadLastRuns,
  loadHistory,
  saveHistory
};
