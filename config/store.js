const path = require("path");
const { RBError } = require("../core/errors");
const {
  ensureDir,
  listDirectories,
  pathExists,
  readJson,
  resolveInputPath,
  writeJson
} = require("../core/fs-utils");
const {
  CONFIG_PATH,
  DEFAULT_ENDPOINT,
  DEFAULT_RCLONE_REMOTE,
  HISTORY_PATH,
  HISTORY_DIR,
  LAST_RUN_PATH,
  LOG_DIR,
  STATE_DIR
} = require("./constants");

function normalizePaths(rawConfig) {
  const rawPaths = Array.isArray(rawConfig.paths) && rawConfig.paths.length > 0
    ? rawConfig.paths
    : [rawConfig.projectsRoot || process.cwd()];

  return [...new Set(
    rawPaths
      .map((entry) => resolveInputPath(entry))
      .filter(Boolean)
  )];
}

function normalizeRepoEntry(entry, paths) {
  const fallbackRoot = paths[0] || process.cwd();

  if (typeof entry === "string") {
    const repoPath = path.isAbsolute(entry)
      ? path.normalize(entry)
      : path.join(fallbackRoot, entry);

    return {
      name: path.basename(repoPath),
      path: path.resolve(repoPath)
    };
  }

  if (!entry || !entry.path) {
    return null;
  }

  const repoPath = path.isAbsolute(entry.path)
    ? entry.path
    : path.join(fallbackRoot, entry.path);

  return {
    name: entry.name || path.basename(repoPath),
    path: path.resolve(repoPath)
  };
}

function detectLegacyWarnings(rawConfig) {
  const warnings = [];
  const legacyAwsFields = ["awsProfile", "awsRegion", "awsAccessKeyId", "awsSecretAccessKey"];
  const presentFields = legacyAwsFields.filter((field) => rawConfig[field]);

  if (presentFields.length > 0) {
    warnings.push(`Ignored legacy AWS fields: ${presentFields.join(", ")}`);
  }

  return warnings;
}

function normalizeConfig(rawConfig, options = {}) {
  const paths = normalizePaths(rawConfig);
  const backupDir = resolveInputPath(
    rawConfig.backupDir || path.join(process.env.HOME || "", "Backups", "br-cli")
  );

  const repos = (rawConfig.repos || [])
    .map((entry) => normalizeRepoEntry(entry, paths))
    .filter(Boolean);

  const normalized = {
    paths,
    rclonePath: rawConfig.rclonePath || "",
    backupDir,
    storage: {
      provider: "rclone",
      remoteName:
        (rawConfig.storage && rawConfig.storage.remoteName) || DEFAULT_RCLONE_REMOTE,
      bucket:
        (rawConfig.storage && rawConfig.storage.bucket) || rawConfig.bucket || rawConfig.s3Bucket || "",
      endpoint:
        (rawConfig.storage && rawConfig.storage.endpoint) || rawConfig.endpoint || DEFAULT_ENDPOINT,
      prefix:
        (rawConfig.storage && rawConfig.storage.prefix) || rawConfig.prefix || ""
    },
    repos,
    notificationEnabled: rawConfig.notificationEnabled !== false,
    envEncryption: {
      enabled: Boolean(rawConfig.envEncryption && rawConfig.envEncryption.enabled),
      passphraseCommand:
        (rawConfig.envEncryption && rawConfig.envEncryption.passphraseCommand) || ""
    },
    retention: {
      localDays:
        (rawConfig.retention && Number(rawConfig.retention.localDays)) > 0
          ? Number(rawConfig.retention.localDays)
          : 14,
      s3Days:
        (rawConfig.retention && Number(rawConfig.retention.s3Days)) > 0
          ? Number(rawConfig.retention.s3Days)
          : 30
    },
    schedule: {
      full: {
        enabled: Boolean(rawConfig.schedule && rawConfig.schedule.full && rawConfig.schedule.full.enabled),
        time:
          (rawConfig.schedule && rawConfig.schedule.full && rawConfig.schedule.full.time) || "02:00"
      },
      quick: {
        enabled: Boolean(rawConfig.schedule && rawConfig.schedule.quick && rawConfig.schedule.quick.enabled),
        intervalMinutes:
          (rawConfig.schedule && rawConfig.schedule.quick && Number(rawConfig.schedule.quick.intervalMinutes)) > 0
            ? Number(rawConfig.schedule.quick.intervalMinutes)
            : 60
      }
    }
  };

  if (options.includeWarnings) {
    normalized.warnings = detectLegacyWarnings(rawConfig);
  }

  return normalized;
}

function ensureStateDirectories() {
  ensureDir(STATE_DIR);
  ensureDir(HISTORY_DIR);
  ensureDir(LOG_DIR);
  if (!pathExists(HISTORY_PATH)) {
    writeJson(HISTORY_PATH, []);
  }
  if (!pathExists(LAST_RUN_PATH)) {
    writeJson(LAST_RUN_PATH, {
      full: null,
      quick: null
    });
  }
}

function hasConfig() {
  return pathExists(CONFIG_PATH);
}

function loadConfig() {
  if (!hasConfig()) {
    throw new RBError(
      `Config not found at ${CONFIG_PATH}. Run "br setup" first.`,
      { code: "CONFIG_MISSING" }
    );
  }

  return normalizeConfig(readJson(CONFIG_PATH), { includeWarnings: true });
}

function saveConfig(rawConfig) {
  ensureStateDirectories();
  const normalized = normalizeConfig(rawConfig);
  writeJson(CONFIG_PATH, normalized);
  return normalized;
}

module.exports = {
  CONFIG_PATH,
  ensureStateDirectories,
  hasConfig,
  listDirectories,
  loadConfig,
  normalizeConfig,
  saveConfig
};
