const { saveConfig } = require("./store");
const {
  parsePathList,
  promptEncryptionSettings,
  promptNotificationSettings,
  promptRepositorySettings,
  promptRetentionSettings,
  promptStorageSettings,
  selectRepositories,
  validateBackupPaths,
  validateStorageConnection
} = require("./setup");
const output = require("../ui/output");
const { askInput, askSelect, waitForEnter } = require("../ui/prompts");
const { promptRepositorySettingsMenu, promptSettingsMenu } = require("../ui/menu");

async function updateStorage(config) {
  const storage = await promptStorageSettings(config, { requireCredentials: false });
  const updated = saveConfig({
    ...config,
    rclonePath: require("../core/storage/rclone").detectRclonePath() || config.rclonePath,
    storage
  });
  validateStorageConnection(updated);
  output.success("Storage settings updated.");
  return updated;
}

async function updateRepositories(config) {
  let current = config;

  while (true) {
    const action = await promptRepositorySettingsMenu(current.paths);

    if (!action || action === "back") {
      return current;
    }

    if (action === "add-path") {
      const nextPath = validateBackupPaths(parsePathList(
        await askInput({
          message: "Path to add",
          required: true
        })
      ))[0];
      const paths = validateBackupPaths([...current.paths, nextPath]);
      const repos = await selectRepositories(paths, current.repos);
      current = saveConfig({
        ...current,
        paths,
        repos
      });
      output.success("Repository path added.");
      await waitForEnter();
      continue;
    }

    if (action === "remove-path") {
      if (current.paths.length === 0) {
        output.warn("No backup paths configured.");
        await waitForEnter();
        continue;
      }

      const pathToRemove = await askSelect({
        message: "Path to remove",
        choices: current.paths.map((entryPath) => ({
          label: entryPath,
          value: entryPath
        }))
      });
      const paths = current.paths.filter((entryPath) => entryPath !== pathToRemove);
      if (paths.length === 0) {
        output.warn("At least one backup path is required.");
        await waitForEnter();
        continue;
      }
      const repos = current.repos.filter((repo) =>
        paths.some((rootPath) => repo.path === rootPath || repo.path.startsWith(`${rootPath}/`))
      );
      current = saveConfig({
        ...current,
        paths,
        repos
      });
      output.success("Repository path removed.");
      await waitForEnter();
      continue;
    }

    if (action === "rescan") {
      const repositories = await promptRepositorySettings(current);
      current = saveConfig({
        ...current,
        paths: repositories.paths,
        repos: repositories.repos
      });
      output.success("Repositories updated.");
      await waitForEnter();
    }
  }
}

async function updateNotifications(config) {
  const notifications = await promptNotificationSettings(config);
  const updated = saveConfig({
    ...config,
    notificationEnabled: notifications.notificationEnabled
  });
  output.success("Notification settings updated.");
  return updated;
}

async function updateRetention(config) {
  const retention = await promptRetentionSettings(config);
  const updated = saveConfig({
    ...config,
    retention: retention.retention
  });
  output.success("Retention settings updated.");
  return updated;
}

async function updateEncryption(config) {
  const encryption = await promptEncryptionSettings(config);
  const updated = saveConfig({
    ...config,
    envEncryption: encryption.envEncryption
  });
  output.success("Encryption settings updated.");
  return updated;
}

async function runSettingsMenu(initialConfig) {
  let config = initialConfig;

  while (true) {
    const choice = await promptSettingsMenu();

    if (!choice || choice === "back") {
      return config;
    }

    switch (choice) {
      case "storage":
        config = await updateStorage(config);
        break;
      case "repositories":
        config = await updateRepositories(config);
        continue;
      case "notifications":
        config = await updateNotifications(config);
        break;
      case "retention":
        config = await updateRetention(config);
        break;
      case "encryption":
        config = await updateEncryption(config);
        break;
      default:
        return config;
    }

    output.note("Press Enter to continue.");
    await waitForEnter();
  }
}

module.exports = {
  runSettingsMenu
};
