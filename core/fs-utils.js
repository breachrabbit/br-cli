const fs = require("fs");
const os = require("os");
const path = require("path");

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function resolveInputPath(inputPath) {
  return path.resolve(expandHome(inputPath));
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

function readJson(filePath, fallbackValue = null) {
  if (!pathExists(filePath)) {
    return fallbackValue;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function removePath(targetPath) {
  if (!pathExists(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function listDirectories(rootPath) {
  if (!pathExists(rootPath)) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name));
}

module.exports = {
  ensureDir,
  expandHome,
  listDirectories,
  pathExists,
  readJson,
  removePath,
  resolveInputPath,
  writeJson
};
