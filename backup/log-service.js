const fs = require("fs");
const path = require("path");
const { ensureDir } = require("../core/fs-utils");
const { LOG_DIR } = require("../config/constants");

function createLogger(backupId) {
  ensureDir(LOG_DIR);
  const filePath = path.join(LOG_DIR, `${backupId}.log`);

  function write(level, message) {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    fs.appendFileSync(filePath, line, "utf8");
  }

  return {
    filePath,
    info(message) {
      write("INFO", message);
    },
    warn(message) {
      write("WARN", message);
    },
    error(message) {
      write("ERROR", message);
    }
  };
}

module.exports = {
  createLogger
};
