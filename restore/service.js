const fs = require("fs");
const path = require("path");
const { restoreBackup } = require("../backup/bundle");
const { readJson, ensureDir, removePath } = require("../core/fs-utils");
const { loadHistory } = require("../backup/history-service");
const { buildRestorePlan } = require("./planner");
const { decryptFile } = require("../env/encryption");
const output = require("../ui/output");

function loadManifest(entry) {
  if (!entry || !entry.manifestPath || !fs.existsSync(entry.manifestPath)) {
    return null;
  }

  return readJson(entry.manifestPath, null);
}

function printRestorePlan(options = {}) {
  const plan = buildRestorePlan(loadHistory(), options);

  output.header("restore plan");

  if (!plan) {
    output.warn("No restore plan could be built from local history.");
    return null;
  }

  output.print(`Target backup: ${plan.target.backupId}`);
  output.print(`Base full backup: ${plan.fullBackup.backupId}`);
  output.print(
    `Incrementals: ${plan.incrementals.length > 0 ? plan.incrementals.map((entry) => entry.backupId).join(", ") : "none"}`
  );

  return plan;
}

function restoreEnvBundle(manifest, targetDir, config) {
  const storedPath = manifest.envBundle && manifest.envBundle.backupPath;
  if (!manifest.envBundle || manifest.envBundle.skipped || !storedPath) {
    return;
  }

  const envTarget = path.join(targetDir, "env", manifest.backupId);
  ensureDir(envTarget);

  let backupPath = storedPath;

  if (manifest.envBundle.encrypted) {
    const decrypted = decryptFile(backupPath, config.envEncryption);
    if (!decrypted) {
      throw new Error("Unable to decrypt env backup. Check envEncryption.passphraseCommand.");
    }
    backupPath = decrypted;
  }

  restoreBackup(backupPath, envTarget);

  if (backupPath !== storedPath) {
    removePath(backupPath);
  }
}

function runRestore(options, config) {
  const plan = buildRestorePlan(loadHistory(), options);
  if (!plan) {
    throw new Error("No matching backup set found for restore.");
  }

  const targetDir = path.resolve(options.target || path.join(process.cwd(), "br-restore"));
  ensureDir(targetDir);

  const backupsToApply = [plan.fullBackup];
  if (options.includeIncrementals) {
    backupsToApply.push(...plan.incrementals);
  }

  backupsToApply.forEach((entry) => {
    const manifest = loadManifest(entry);
    if (!manifest) {
      throw new Error(`Manifest missing for backup ${entry.backupId}`);
    }

    const repoBackups = manifest.repoBackups || manifest.folderBackups || [];
    repoBackups.forEach((backup) => {
      restoreBackup(backup.path, targetDir);
    });

    restoreEnvBundle(manifest, targetDir, config);
  });

  output.success(`Restore completed into ${targetDir}`);
  return {
    targetDir,
    appliedBackups: backupsToApply.map((entry) => entry.backupId)
  };
}

module.exports = {
  printRestorePlan,
  runRestore
};
