const path = require("path");
const { DEFAULT_ENDPOINT, DEFAULT_RCLONE_REMOTE } = require("../../config/constants");
const { RBError } = require("../errors");
const { runCommand, runCommandAsync } = require("../process");

function detectRclonePath() {
  const result = runCommand("which", ["rclone"], { allowFailure: true });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }

  return "";
}

function getRclonePath(config = {}) {
  return config.rclonePath || detectRclonePath() || "rclone";
}

function ensureRcloneInstalled(config = {}) {
  const rclonePath = getRclonePath(config);
  const result = runCommand(rclonePath, ["version"], { allowFailure: true });

  if (result.status !== 0) {
    throw new RBError("rclone is required but not installed or not available.", {
      code: "RCLONE_MISSING"
    });
  }

  return rclonePath;
}

function getRemoteName(config) {
  return (config.storage && config.storage.remoteName) || DEFAULT_RCLONE_REMOTE;
}

function getBucket(config) {
  return (config.storage && config.storage.bucket) || config.bucket || config.s3Bucket || "";
}

function getBasePrefix(config) {
  return (config.storage && config.storage.prefix) || config.prefix || "";
}

function sanitizeRemotePath(value) {
  return String(value || "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function buildRemotePath(config, remotePath = "") {
  const remoteName = getRemoteName(config);
  const bucket = getBucket(config);

  if (!bucket) {
    throw new RBError("Storage bucket is not configured. Run \"br setup\" again.", {
      code: "STORAGE_BUCKET_MISSING"
    });
  }

  const basePrefix = sanitizeRemotePath(getBasePrefix(config));
  const suffix = sanitizeRemotePath(remotePath);
  const fullPath = [basePrefix, suffix].filter(Boolean).join("/");
  return fullPath ? `${remoteName}:${bucket}/${fullPath}` : `${remoteName}:${bucket}`;
}

function parseRcloneProgressChunk(chunk) {
  const lines = chunk
    .split(/\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const match = line.match(/Transferred:\s+(.+?)\s*\/\s*(.+?),\s*([0-9]+)%,\s*(.+?)(?:,\s*ETA|$)/i);
    if (match) {
      return {
        transferred: match[1].trim(),
        total: match[2].trim(),
        percent: Number(match[3]),
        speed: match[4].trim()
      };
    }
  }

  return null;
}

function listRemotes(config = {}) {
  const rclonePath = ensureRcloneInstalled(config);
  const result = runCommand(rclonePath, ["listremotes"], { allowFailure: true });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim().replace(/:$/, ""))
    .filter(Boolean);
}

function remoteExists(remoteName, config = {}) {
  return listRemotes(config).includes(remoteName);
}

function configureRemote({ remoteName = DEFAULT_RCLONE_REMOTE, endpoint, accessKeyId, secretAccessKey, rclonePath }) {
  const command = ensureRcloneInstalled({ rclonePath });

  const action = remoteExists(remoteName, { rclonePath }) ? "update" : "create";
  const args = [
    "config",
    action,
    remoteName
  ];

  if (action === "create") {
    args.push("s3");
  }

  args.push("provider", "Other", "env_auth", "false");
  if (accessKeyId) {
    args.push("access_key_id", accessKeyId);
  }
  if (secretAccessKey) {
    args.push("secret_access_key", secretAccessKey);
  }
  if (endpoint || DEFAULT_ENDPOINT) {
    args.push("endpoint", endpoint || DEFAULT_ENDPOINT);
  }

  runCommand(command, args);
}

function testConnection(config) {
  const rclonePath = ensureRcloneInstalled(config);
  const rootConfig = {
    ...config,
    storage: {
      ...(config.storage || {}),
      prefix: ""
    }
  };
  const result = runCommand(rclonePath, ["ls", buildRemotePath(rootConfig)], { allowFailure: true });

  if (result.status !== 0) {
    const detail = `${result.stdout}\n${result.stderr}`.trim();
    throw new RBError(
      `rclone connection test failed for ${buildRemotePath(rootConfig)}${detail ? `\n${detail}` : ""}`,
      { code: "RCLONE_CONNECTION_FAILED" }
    );
  }

  return {
    remotePath: buildRemotePath(config)
  };
}

async function uploadDirectory(config, localDir, remotePath) {
  const rclonePath = ensureRcloneInstalled(config);
  const remote = buildRemotePath(config, remotePath);
  const onProgress = typeof config.onProgress === "function" ? config.onProgress : null;
  let latestProgress = null;
  const result = await runCommandAsync(
    rclonePath,
    [
      "copy",
      localDir,
      remote,
      "--create-empty-src-dirs",
      "--progress",
      "--stats=1s",
      "--stats-one-line"
    ],
    {
      allowFailure: true,
      onStdout(chunk) {
        const progress = parseRcloneProgressChunk(chunk);
        if (progress && onProgress) {
          latestProgress = progress;
          onProgress(progress);
        }
      },
      onStderr(chunk) {
        const progress = parseRcloneProgressChunk(chunk);
        if (progress && onProgress) {
          latestProgress = progress;
          onProgress(progress);
        }
      }
    }
  );

  if (result.status !== 0) {
    throw new RBError("Failed to upload backups", {
      code: "RCLONE_UPLOAD_FAILED",
      details: `${result.stdout}\n${result.stderr}`.trim()
    });
  }

  return {
    remotePath: remote,
    speed: latestProgress ? latestProgress.speed : "",
    total: latestProgress ? latestProgress.total : "",
    transferred: latestProgress ? latestProgress.transferred : ""
  };
}

async function uploadFile(config, filePath, remoteDir) {
  const rclonePath = ensureRcloneInstalled(config);
  const remote = buildRemotePath(config, remoteDir);
  const onProgress = typeof config.onProgress === "function" ? config.onProgress : null;
  let latestProgress = null;
  const result = await runCommandAsync(
    rclonePath,
    [
      "copy",
      filePath,
      remote,
      "--progress",
      "--stats=1s",
      "--stats-one-line"
    ],
    {
      allowFailure: true,
      onStdout(chunk) {
        const progress = parseRcloneProgressChunk(chunk);
        if (progress && onProgress) {
          latestProgress = progress;
          onProgress(progress);
        }
      },
      onStderr(chunk) {
        const progress = parseRcloneProgressChunk(chunk);
        if (progress && onProgress) {
          latestProgress = progress;
          onProgress(progress);
        }
      }
    }
  );

  if (result.status !== 0) {
    throw new RBError("Failed to upload backups", {
      code: "RCLONE_UPLOAD_FAILED",
      details: `${result.stdout}\n${result.stderr}`.trim()
    });
  }

  return {
    remotePath: `${remote}/${path.basename(filePath)}`,
    speed: latestProgress ? latestProgress.speed : "",
    total: latestProgress ? latestProgress.total : "",
    transferred: latestProgress ? latestProgress.transferred : ""
  };
}

function listBackups(config, remotePath = "") {
  const rclonePath = ensureRcloneInstalled(config);
  const result = runCommand(
    rclonePath,
    ["lsf", buildRemotePath(config, remotePath), "--dirs-only"],
    { allowFailure: true }
  );

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

module.exports = {
  buildRemotePath,
  configureRemote,
  detectRclonePath,
  ensureRcloneInstalled,
  getRclonePath,
  listBackups,
  testConnection,
  uploadDirectory,
  uploadFile
};
