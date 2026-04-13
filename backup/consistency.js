const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { verifyRemoteFile } = require("../core/storage/rclone");
const { RBError } = require("../core/errors");
const { pathExists, removePath } = require("../core/fs-utils");
const { runCommand } = require("../core/process");
const { decryptFile } = require("../env/encryption");

function toArchiveRecord(input) {
  return {
    archivePath: input.archivePath,
    archiveSizeBytes: input.archiveSizeBytes,
    integrityVerified: Boolean(input.integrityVerified),
    path: input.archivePath,
    remotePath: input.remotePath || null,
    sha256: input.sha256 || "",
    size: input.archiveSizeBytes,
    uploadVerified: Boolean(input.uploadVerified)
  };
}

function humanArtifactLabel(label) {
  return label || "archive";
}

function assertArchiveExists(filePath, label) {
  if (!filePath || !pathExists(filePath)) {
    throw new RBError("Backup integrity check failed", {
      code: "BACKUP_INTEGRITY_FAILED",
      details: `${humanArtifactLabel(label)} is missing`
    });
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new RBError("Backup integrity check failed", {
      code: "BACKUP_INTEGRITY_FAILED",
      details: `${humanArtifactLabel(label)} is empty`
    });
  }

  return stats.size;
}

function assertTarReadable(filePath, label) {
  const result = runCommand("tar", ["-tzf", filePath], {
    allowFailure: true,
    stdio: ["ignore", "ignore", "pipe"]
  });

  if (result.status !== 0) {
    throw new RBError("Backup integrity check failed", {
      code: "BACKUP_INTEGRITY_FAILED",
      details: `${humanArtifactLabel(label)} cannot be opened as tar.gz`
    });
  }
}

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyLocalArchive(options) {
  const archivePath = options.archivePath;
  const label = options.label;
  const archiveSizeBytes = assertArchiveExists(archivePath, label);
  let verificationPath = options.verificationPath || archivePath;
  let cleanupPath = "";

  if (options.encrypted && verificationPath === archivePath) {
    const decryptedPath = decryptFile(archivePath, options.envEncryption);
    if (!decryptedPath) {
      throw new RBError("Backup integrity check failed", {
        code: "BACKUP_INTEGRITY_FAILED",
        details: `${humanArtifactLabel(label)} could not be decrypted for verification`
      });
    }
    verificationPath = decryptedPath;
    cleanupPath = decryptedPath;
  }

  try {
    assertArchiveExists(verificationPath, label);
    assertTarReadable(verificationPath, label);
    const sha256 = await computeSha256(archivePath);

    if (options.expectedSizeBytes != null && Number(options.expectedSizeBytes) !== archiveSizeBytes) {
      throw new RBError("Backup integrity check failed", {
        code: "BACKUP_INTEGRITY_FAILED",
        details: `${humanArtifactLabel(label)} size mismatch`
      });
    }

    if (options.expectedSha256 && options.expectedSha256 !== sha256) {
      throw new RBError("Backup integrity check failed", {
        code: "BACKUP_INTEGRITY_FAILED",
        details: `${humanArtifactLabel(label)} hash mismatch`
      });
    }

    return {
      archivePath,
      archiveSizeBytes,
      integrityVerified: true,
      sha256
    };
  } finally {
    if (cleanupPath) {
      removePath(cleanupPath);
    }
  }
}

async function verifyRemoteArtifact(config, artifact, label) {
  if (!artifact || !artifact.remotePath) {
    throw new RBError("Upload verification failed", {
      code: "BACKUP_UPLOAD_VERIFY_FAILED",
      details: `${humanArtifactLabel(label)} remote path is missing`
    });
  }

  const result = verifyRemoteFile(config, artifact.remotePath, artifact.archiveSizeBytes);
  if (!result.verified) {
    throw new RBError("Upload verification failed", {
      code: "BACKUP_UPLOAD_VERIFY_FAILED",
      details: `${humanArtifactLabel(label)} was not found remotely or size did not match`
    });
  }

  return {
    ...artifact,
    remotePath: result.remotePath,
    uploadVerified: true
  };
}

async function verifyBackupArtifacts({ envBundle, logger, repoBackups, config }) {
  const verifiedRepoBackups = [];
  for (const repoBackup of repoBackups) {
    logger.info(`Verifying repository archive: ${repoBackup.name}`);
    const verified = await verifyLocalArchive({
      archivePath: repoBackup.path || repoBackup.archivePath,
      label: repoBackup.name
    });
    verifiedRepoBackups.push({
      ...repoBackup,
      ...toArchiveRecord(verified)
    });
  }

  let verifiedEnvBundle = envBundle || null;
  if (envBundle && !envBundle.skipped && envBundle.backupPath) {
    logger.info("Verifying environment archive");
    const verified = await verifyLocalArchive({
      archivePath: envBundle.backupPath,
      encrypted: envBundle.encrypted,
      envEncryption: config.envEncryption,
      label: "environment archive",
      verificationPath: envBundle.verificationPath || envBundle.backupPath
    });
    verifiedEnvBundle = {
      ...envBundle,
      ...toArchiveRecord(verified),
      backupPath: verified.archivePath
    };
  }

  if (
    verifiedEnvBundle &&
    verifiedEnvBundle.verificationPath &&
    verifiedEnvBundle.verificationPath !== verifiedEnvBundle.backupPath
  ) {
    removePath(verifiedEnvBundle.verificationPath);
  }
  if (verifiedEnvBundle && verifiedEnvBundle.verificationPath) {
    delete verifiedEnvBundle.verificationPath;
  }

  return {
    envBundle: verifiedEnvBundle,
    repoBackups: verifiedRepoBackups
  };
}

async function verifyUploadedArtifacts({ config, envBundle, manifestArtifact, repoBackups }) {
  const verifiedRepoBackups = [];
  for (const repoBackup of repoBackups) {
    verifiedRepoBackups.push(await verifyRemoteArtifact(config, repoBackup, repoBackup.name));
  }

  let verifiedEnvBundle = envBundle || null;
  if (envBundle && !envBundle.skipped && envBundle.archivePath) {
    verifiedEnvBundle = {
      ...envBundle,
      ...(await verifyRemoteArtifact(config, envBundle, "environment archive"))
    };
  }

  const verifiedManifest = await verifyRemoteArtifact(config, manifestArtifact, "backup manifest");

  return {
    envBundle: verifiedEnvBundle,
    manifestArtifact: verifiedManifest,
    repoBackups: verifiedRepoBackups
  };
}

function isRestoreReady(manifest) {
  const repoReady = (manifest.repoBackups || []).every(
    (item) => item.integrityVerified && item.uploadVerified
  );
  const envReady = !manifest.envBundle || manifest.envBundle.skipped
    ? true
    : Boolean(manifest.envBundle.integrityVerified && manifest.envBundle.uploadVerified);

  return Boolean(manifest.uploadVerified && repoReady && envReady && !manifest.noOp);
}

function loadManifestForEntry(entry) {
  if (!entry || !entry.manifestPath || !pathExists(entry.manifestPath)) {
    throw new RBError("Backup verification failed", {
      code: "VERIFY_MANIFEST_MISSING",
      details: "Manifest file is missing"
    });
  }

  return JSON.parse(fs.readFileSync(entry.manifestPath, "utf8"));
}

async function verifyBackupManifest(entry, config) {
  const manifest = loadManifestForEntry(entry);
  const verifiedRepoBackups = [];

  for (const repoBackup of manifest.repoBackups || []) {
    const verified = await verifyLocalArchive({
      archivePath: repoBackup.archivePath || repoBackup.path,
      expectedSha256: repoBackup.sha256,
      expectedSizeBytes: repoBackup.archiveSizeBytes || repoBackup.size,
      label: repoBackup.name
    });
    verifiedRepoBackups.push({
      ...repoBackup,
      ...toArchiveRecord(verified),
      name: repoBackup.name,
      remotePath: repoBackup.remotePath || null,
      uploadVerified: Boolean(repoBackup.uploadVerified)
    });
  }

  let verifiedEnvBundle = manifest.envBundle || null;
  if (manifest.envBundle && !manifest.envBundle.skipped && (manifest.envBundle.archivePath || manifest.envBundle.backupPath)) {
    const verified = await verifyLocalArchive({
      archivePath: manifest.envBundle.archivePath || manifest.envBundle.backupPath,
      encrypted: manifest.envBundle.encrypted,
      envEncryption: config ? config.envEncryption : null,
      expectedSha256: manifest.envBundle.sha256,
      expectedSizeBytes: manifest.envBundle.archiveSizeBytes || manifest.envBundle.size,
      label: "environment archive"
    });
    verifiedEnvBundle = {
      ...manifest.envBundle,
      ...toArchiveRecord(verified),
      backupPath: verified.archivePath
    };
  }

  let uploadVerified = Boolean(manifest.uploadVerified);
  if (config) {
    const manifestArtifact = {
      archivePath: entry.manifestPath,
      archiveSizeBytes: fs.statSync(entry.manifestPath).size,
      remotePath: manifest.manifestRemotePath,
      uploadVerified: false
    };

    const uploaded = await verifyUploadedArtifacts({
      config,
      envBundle: verifiedEnvBundle && !verifiedEnvBundle.skipped ? verifiedEnvBundle : verifiedEnvBundle,
      manifestArtifact,
      repoBackups: verifiedRepoBackups
    });

    uploadVerified =
      uploaded.manifestArtifact.uploadVerified &&
      uploaded.repoBackups.every((item) => item.uploadVerified) &&
      (!uploaded.envBundle || uploaded.envBundle.skipped || uploaded.envBundle.uploadVerified);

    verifiedEnvBundle = uploaded.envBundle;
    uploaded.repoBackups.forEach((item, index) => {
      verifiedRepoBackups[index] = item;
    });
  }

  const verifiedManifest = {
    ...manifest,
    envBundle: verifiedEnvBundle,
    repoBackups: verifiedRepoBackups,
    restoreReady: false,
    uploadVerified
  };
  verifiedManifest.restoreReady = isRestoreReady(verifiedManifest);

  return verifiedManifest;
}

module.exports = {
  isRestoreReady,
  toArchiveRecord,
  verifyBackupArtifacts,
  verifyBackupManifest,
  verifyLocalArchive,
  verifyUploadedArtifacts
};
