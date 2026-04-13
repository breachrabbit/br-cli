const fs = require("fs");
const path = require("path");
const { resolveInputPath, listDirectories } = require("../core/fs-utils");
const { hasConfig, loadConfig, saveConfig } = require("./store");
const { isGitRepository } = require("../git/repository");
const {
  configureRemote,
  detectRclonePath,
  ensureRcloneInstalled,
  testConnection
} = require("../core/storage/rclone");
const { runCommand } = require("../core/process");
const output = require("../ui/output");
const { clearScreen, printBrand, printSection } = require("../ui/layout");
const {
  askConfirm,
  askInput,
  askSecret,
  ensureInteractive
} = require("../ui/prompts");
const { promptMultiSelect } = require("../ui/multiselect");

function getStorageEndpointInitial(existingConfig) {
  const value = existingConfig && existingConfig.storage ? existingConfig.storage.endpoint : "";
  if (!value || value === "https://s3.twcstorage.ru") {
    return "";
  }
  return value;
}

function parsePathList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => resolveInputPath(entry.trim()))
    .filter(Boolean);
}

function validateBackupPaths(paths) {
  const normalizedPaths = Array.isArray(paths) ? paths : [paths].filter(Boolean);

  if (normalizedPaths.length === 0) {
    throw new Error("At least one backup path is required.");
  }

  normalizedPaths.forEach((entryPath) => {
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isDirectory()) {
      throw new Error(`Backup path does not exist or is not a directory: ${entryPath}`);
    }
  });

  return [...new Set(normalizedPaths)];
}

function discoverRepositoryCandidates(paths) {
  const roots = Array.isArray(paths) ? paths : [paths].filter(Boolean);
  const unique = new Map();

  roots.forEach((rootPath) => {
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      return;
    }

    listDirectories(rootPath).forEach((entryPath) => {
      unique.set(path.resolve(entryPath), {
        name: path.basename(entryPath),
        path: entryPath,
        rootPath,
        isGit: isGitRepository(entryPath)
      });
    });
  });

  return [...unique.values()];
}

async function selectRepositories(paths, initialRepos = []) {
  const roots = Array.isArray(paths) ? paths : [paths].filter(Boolean);
  const candidates = discoverRepositoryCandidates(roots);
  const gitRepos = candidates.filter((entry) => entry.isGit);

  if (gitRepos.length === 0) {
    throw new Error("No git repositories were found in the selected paths.");
  }

  const initiallySelected = new Set(initialRepos.map((repo) => path.resolve(repo.path)));
  const selectedPaths = await promptMultiSelect({
    title: "Repositories",
    hint: "Use arrows and Space to choose repositories to back up.",
    items: gitRepos.map((repo) => ({
      label: repo.name,
      value: repo.path,
      selected: initiallySelected.has(path.resolve(repo.path))
    }))
  });

  if (selectedPaths.length === 0) {
    throw new Error("Select at least one repository to continue.");
  }

  return gitRepos
    .filter((repo) => selectedPaths.includes(repo.path))
    .map((repo) => ({
      name: repo.name,
      path: repo.path
    }));
}

function storePassphraseInKeychain(passphrase) {
  const serviceName = "br-env-key";
  runCommand("security", [
    "add-generic-password",
    "-U",
    "-a",
    process.env.USER || "br",
    "-s",
    serviceName,
    "-w",
    passphrase
  ]);

  return 'security find-generic-password -a "$USER" -s br-env-key -w';
}

async function promptWorkspaceSettings(existingConfig) {
  printSection("Workspace");

  const paths = validateBackupPaths(parsePathList(
    await askInput({
      message: "Backup paths (comma-separated)",
      initial: existingConfig ? existingConfig.paths.join(", ") : "",
      required: true
    })
  ));

  const backupDir = resolveInputPath(
    await askInput({
      message: "Local backup directory",
      initial: existingConfig ? existingConfig.backupDir : path.join(process.env.HOME || "", "Backups", "br-cli"),
      required: true
    })
  );

  return {
    backupDir,
    paths
  };
}

async function promptStorageSettings(existingConfig, options = {}) {
  printSection("Storage");
  const rclonePath = ensureRcloneInstalled();

  const accessKeyId = await askInput({
    message: options.requireCredentials ? "S3-compatible access key" : "S3-compatible access key (leave blank to keep current remote credentials)",
    required: Boolean(options.requireCredentials)
  });

  const secretAccessKey = await askSecret({
    message: options.requireCredentials ? "S3-compatible secret key" : "S3-compatible secret key (leave blank to keep current remote credentials)",
    required: Boolean(options.requireCredentials)
  });

  if (!options.requireCredentials && Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("Provide both access key and secret key, or leave both empty.");
  }

  const storage = {
    provider: "rclone",
    remoteName: "br-s3",
    bucket: await askInput({
      message: "S3 bucket",
      initial: existingConfig ? existingConfig.storage.bucket : "",
      required: true
    }),
    endpoint: await askInput({
      message: "S3 endpoint",
      initial: getStorageEndpointInitial(existingConfig),
      required: true
    }),
    prefix: await askInput({
      message: "S3 folder prefix (optional)",
      initial: existingConfig ? existingConfig.storage.prefix || "" : ""
    })
  };

  const shouldConfigureRemote =
    options.requireCredentials ||
    Boolean(accessKeyId && secretAccessKey) ||
    Boolean(existingConfig);
  if (shouldConfigureRemote) {
    output.info("Configuring rclone remote br-s3...");
    configureRemote({
      remoteName: "br-s3",
      endpoint: storage.endpoint,
      accessKeyId,
      secretAccessKey,
      rclonePath
    });
  }

  return storage;
}

async function promptRepositorySettings(existingConfig, options = {}) {
  printSection("Repositories");

  const paths = validateBackupPaths(parsePathList(
    await askInput({
      message: "Backup paths (comma-separated)",
      initial: existingConfig.paths.join(", "),
      required: true
    })
  ));

  const repos = await selectRepositories(paths, existingConfig.repos);
  if (!options.silent) {
    output.success(`${repos.length} repositories selected.`);
  }

  return {
    paths,
    repos
  };
}

async function promptNotificationSettings(existingConfig) {
  printSection("Notifications");
  const notificationEnabled = await askConfirm({
    message: "Enable macOS notifications",
    initial: existingConfig ? existingConfig.notificationEnabled : true
  });
  return {
    notificationEnabled
  };
}

async function promptRetentionSettings(existingConfig) {
  printSection("Retention");
  const localDays = Number(
    await askInput({
      message: "Local retention days",
      initial: existingConfig ? String(existingConfig.retention.localDays) : "14",
      required: true,
      validate(value) {
        return Number(value) > 0 || "Retention must be a positive number.";
      }
    })
  );
  const s3Days = Number(
    await askInput({
      message: "Remote retention days",
      initial: existingConfig ? String(existingConfig.retention.s3Days) : "30",
      required: true,
      validate(value) {
        return Number(value) > 0 || "Retention must be a positive number.";
      }
    })
  );

  return {
    retention: {
      localDays,
      s3Days
    }
  };
}

async function promptEncryptionSettings(existingConfig) {
  printSection("Encryption");
  const currentlyEnabled = Boolean(existingConfig && existingConfig.envEncryption.enabled);
  const enableEncryption = await askConfirm({
    message: "Protect .env backups with a passphrase stored in macOS Keychain",
    initial: currentlyEnabled
  });

  if (!enableEncryption) {
    return {
      envEncryption: {
        enabled: false,
        passphraseCommand: ""
      }
    };
  }

  output.note("Enter a passphrase once. It will be stored in macOS Keychain and reused automatically.");
  const passphrase = await askSecret({
    message: "Encryption passphrase",
    required: true
  });
  const confirmPassphrase = await askSecret({
    message: "Repeat passphrase",
    required: true
  });

  if (passphrase !== confirmPassphrase) {
    throw new Error("Encryption passphrases do not match.");
  }

  return {
    envEncryption: {
      enabled: true,
      passphraseCommand: storePassphraseInKeychain(passphrase)
    }
  };
}

function validateStorageConnection(config) {
  output.info(`Validating access to br-s3:${config.storage.bucket}...`);
  testConnection(config);
}

async function runSetupWizard() {
  ensureInteractive();
  clearScreen();
  printBrand("BR Labs", "Backup & recovery CLI for Breach Rabbit environments");
  printSection("Setup");
  const existingConfig = hasConfig() ? loadConfig() : null;

  const workspace = await promptWorkspaceSettings(existingConfig);
  const storage = await promptStorageSettings(existingConfig, { requireCredentials: !existingConfig });
  const repositories = await promptRepositorySettings({
    paths: workspace.paths,
    repos: existingConfig ? existingConfig.repos : []
  });
  const notifications = await promptNotificationSettings(existingConfig);
  const encryption = await promptEncryptionSettings(existingConfig);
  const retention = await promptRetentionSettings(existingConfig);

  const config = saveConfig({
    paths: repositories.paths,
    rclonePath: detectRclonePath(),
    backupDir: workspace.backupDir,
    storage,
    repos: repositories.repos,
    notificationEnabled: notifications.notificationEnabled,
    envEncryption: encryption.envEncryption,
    retention: retention.retention
  });

  validateStorageConnection(config);

  output.success(`Config saved to ${require("./constants").CONFIG_PATH}`);
  return config;
}

module.exports = {
  discoverRepositoryCandidates,
  parsePathList,
  promptEncryptionSettings,
  promptNotificationSettings,
  promptRepositorySettings,
  promptRetentionSettings,
  promptStorageSettings,
  runSetupWizard,
  selectRepositories,
  validateBackupPaths,
  validateStorageConnection
};
