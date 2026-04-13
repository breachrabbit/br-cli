const fs = require("fs");
const path = require("path");
const { ensureDir } = require("../core/fs-utils");
const { runCommand } = require("../core/process");

function sanitizeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function createRepoBackup(source, destinationDir, logger) {
  ensureDir(destinationDir);
  const backupName = `${sanitizeName(source.name)}.tar.gz`;
  const backupPath = path.join(destinationDir, backupName);

  runCommand("tar", [
    "-czf",
    backupPath,
    "--exclude=.git",
    "--exclude=.DS_Store",
    "-C",
    path.dirname(source.path),
    path.basename(source.path)
  ]);

  logger.info(`Backup created: ${backupPath}`);

  return {
    name: source.name,
    path: backupPath,
    size: fs.statSync(backupPath).size
  };
}

function restoreBackup(backupPath, targetDir) {
  ensureDir(targetDir);
  runCommand("tar", ["-xzf", backupPath, "-C", targetDir]);
}

module.exports = {
  createRepoBackup,
  restoreBackup
};
