const { AGENT_HEARTBEAT_PATH, CURRENT_RUN_PATH } = require("../config/constants");
const { readJson, removePath, writeJson } = require("../core/fs-utils");

function loadCurrentRun() {
  return readJson(CURRENT_RUN_PATH, null);
}

function startCurrentRun(value) {
  writeJson(CURRENT_RUN_PATH, {
    ...value,
    status: "running"
  });
}

function updateCurrentRun(patch) {
  const current = loadCurrentRun();
  if (!current) {
    return;
  }

  writeJson(CURRENT_RUN_PATH, {
    ...current,
    ...patch,
    status: "running"
  });
}

function clearCurrentRun() {
  removePath(CURRENT_RUN_PATH);
}

function updateAgentHeartbeat(value = {}) {
  writeJson(AGENT_HEARTBEAT_PATH, {
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...value
  });
}

function loadAgentHeartbeat() {
  return readJson(AGENT_HEARTBEAT_PATH, null);
}

function clearAgentHeartbeat() {
  removePath(AGENT_HEARTBEAT_PATH);
}

module.exports = {
  clearAgentHeartbeat,
  clearCurrentRun,
  loadAgentHeartbeat,
  loadCurrentRun,
  startCurrentRun,
  updateAgentHeartbeat,
  updateCurrentRun
};
