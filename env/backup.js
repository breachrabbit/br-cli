const fs = require("fs");
const path = require("path");
const { ensureDir, removePath } = require("../core/fs-utils");
const { runCommand } = require("../core/process");
const { encryptFile } = require("./encryption");

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next"]);
const IGNORED_ENV_FILES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.schema"
]);

function isEnvFile(fileName) {
  return fileName === ".env" || (fileName.startsWith(".env.") && !IGNORED_ENV_FILES.has(fileName));
}

function walkEnvFiles(rootPath, basePath, files = []) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });

  entries.forEach((entry) => {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = path.relative(basePath, absolutePath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        return;
      }
      walkEnvFiles(absolutePath, basePath, files);
      return;
    }

    if (entry.isFile() && isEnvFile(entry.name)) {
      const stats = fs.statSync(absolutePath);
      files.push({
        sourcePath: absolutePath,
        relativePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      });
    }
  });

  return files;
}

function collectEnvFiles(repos) {
  return repos.flatMap((repo) =>
    walkEnvFiles(repo.path, repo.path).map((item) => ({
      ...item,
      repoName: repo.name
    }))
  );
}

function buildEnvFingerprint(files) {
  return files
    .map((file) => `${file.repoName}:${file.relativePath}:${file.size}:${Math.round(file.mtimeMs)}`)
    .sort()
    .join("|");
}

function createEnvBackup({ repos, runRoot, envEncryption, logger, quickFingerprint }) {
  const envFiles = collectEnvFiles(repos);
  const fingerprint = buildEnvFingerprint(envFiles);

  if (envFiles.length === 0) {
    return {
      skipped: true,
      reason: "no-env-files",
      fingerprint
    };
  }

  if (quickFingerprint && quickFingerprint === fingerprint) {
    return {
      skipped: true,
      reason: "unchanged",
      fingerprint
    };
  }

  const sourceDir = path.join(runRoot, "env-source");
  ensureDir(sourceDir);

  envFiles.forEach((file) => {
    const targetPath = path.join(sourceDir, file.repoName, file.relativePath);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(file.sourcePath, targetPath);
  });

  const manifest = {
    createdAt: new Date().toISOString(),
    files: envFiles.map((file) => ({
      repoName: file.repoName,
      relativePath: file.relativePath,
      size: file.size
    }))
  };
  fs.writeFileSync(path.join(sourceDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const backupPath = path.join(runRoot, "env-files.tar.gz");
  runCommand("tar", ["-czf", backupPath, "-C", sourceDir, "."]);

  let finalPath = backupPath;
  let verificationPath = backupPath;
  let encrypted = false;

  if (envEncryption && envEncryption.enabled) {
    const encryptedPath = `${backupPath}.enc`;
    const result = encryptFile(backupPath, encryptedPath, envEncryption);
    if (result) {
      encrypted = true;
      finalPath = encryptedPath;
    } else {
      logger.warn("Env encryption enabled, but passphrase command did not return a value. Saving plain env backup.");
    }
  }

  removePath(sourceDir);

  return {
    backupPath: finalPath,
    encrypted,
    fileCount: envFiles.length,
    fingerprint,
    verificationPath
  };
}

module.exports = {
  buildEnvFingerprint,
  collectEnvFiles,
  createEnvBackup
};
