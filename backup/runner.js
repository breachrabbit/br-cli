const fs = require("fs");
const path = require("path");
const { createRepoBackup } = require("./bundle");
const { buildBackupMetadata } = require("./metadata");
const { appendHistory, getLatestSuccessfulBackup } = require("./history-service");
const { createLogger } = require("./log-service");
const { createEnvBackup } = require("../env/backup");
const { getRepoSnapshot, isGitRepository, pushRepositories } = require("../git/repository");
const { uploadDirectory, uploadFile } = require("../core/storage/rclone");
const { ensureDir } = require("../core/fs-utils");
const { formatCompactTimestamp, formatDuration, formatTimestamp, getBackupId, getDayStamp } = require("../core/time");
const output = require("../ui/output");
const { notify } = require("../ui/notifications");
const { withPercentProgress, withStepProgress } = require("../ui/progress");

function snapshotMapForRepos(repos) {
  return repos.reduce((accumulator, repo) => {
    if (isGitRepository(repo.path)) {
      accumulator[repo.name] = {
        path: repo.path,
        ...getRepoSnapshot(repo.path)
      };
    }
    return accumulator;
  }, {});
}

function determineQuickCandidates(repos, previousSnapshots) {
  return repos.filter((repo) => {
    const current = getRepoSnapshot(repo.path);
    const previous = previousSnapshots[repo.name];

    if (!previous) {
      return true;
    }

    return current.headCommit !== previous.headCommit || current.status !== previous.status;
  });
}

function buildS3Prefix(mode, dayStamp, backupId) {
  const modePrefix = mode === "full" ? "full" : "incremental";
  return `${modePrefix}/${dayStamp}/${backupId}`;
}

function summarizeGitResults(results) {
  return results.reduce(
    (accumulator, result) => {
      if (result.status === "success") {
        accumulator.synced += 1;
      } else if (result.status === "warning") {
        accumulator.skipped += 1;
        if (result.reason === "no-upstream" || result.reason === "upstream-failed") {
          accumulator.noUpstream += 1;
        }
        if (result.reason === "missing-origin") {
          accumulator.noOrigin += 1;
        }
        if (result.reason === "remote-ahead") {
          accumulator.remoteAhead += 1;
        }
        if (result.reason === "detached-head") {
          accumulator.detachedHead += 1;
        }
        if (result.reason === "not-git") {
          accumulator.notGit += 1;
        }
      } else if (result.status === "error") {
        accumulator.failed += 1;
      }
      return accumulator;
    },
    { detachedHead: 0, failed: 0, noOrigin: 0, noUpstream: 0, notGit: 0, remoteAhead: 0, skipped: 0, synced: 0 }
  );
}

function formatGitSkipReason(gitSummary) {
  const reasons = [];
  if (gitSummary.noUpstream > 0) {
    reasons.push("no upstream configured");
  }
  if (gitSummary.remoteAhead > 0) {
    reasons.push("remote ahead");
  }
  if (gitSummary.detachedHead > 0) {
    reasons.push("detached HEAD");
  }
  if (gitSummary.noOrigin > 0) {
    reasons.push("no origin");
  }
  if (gitSummary.notGit > 0) {
    reasons.push("not a git repository");
  }

  return reasons.join(", ") || "git skipped";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const format = (number) => String(number.toFixed(1)).replace(/\.0$/, "");
  if (value >= 1024 * 1024 * 1024) {
    return `${format(value / (1024 * 1024 * 1024))} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${format(value / (1024 * 1024))} MB`;
  }
  if (value >= 1024) {
    return `${format(value / 1024)} KB`;
  }
  return `${value} B`;
}

function formatEnvSkipReason(reason) {
  if (reason === "no-env-files") {
    return "no .env files found";
  }
  if (reason === "unchanged") {
    return "no .env changes";
  }
  return reason || "no changes";
}

function printBackupSummary(summary) {
  output.success("Backup completed successfully");
  output.note("All data safely stored in S3");
  output.section("Summary");
  output.print("Repositories:");
  output.success(`${summary.git.synced} synced`);
  if (summary.git.skipped > 0) {
    output.warn(
      `${summary.git.skipped} skipped${summary.git.skipReason ? ` (${summary.git.skipReason})` : ""}`
    );
  }
  if (summary.git.failed > 0) {
    output.error(`${summary.git.failed} failed`);
  }

  output.print("Storage:");
  if (summary.storage.status === "success") {
    output.success(`${summary.storage.label}${summary.storage.detail ? ` • ${summary.storage.detail}` : ""}`);
  } else if (summary.storage.status === "warning") {
    output.warn(`${summary.storage.label}${summary.storage.detail ? ` • ${summary.storage.detail}` : ""}`);
  } else {
    output.error(`${summary.storage.label}${summary.storage.detail ? ` • ${summary.storage.detail}` : ""}`);
  }

  output.print("Env:");
  if (summary.env.status === "success") {
    output.success(`${summary.env.label}${summary.env.detail ? ` • ${summary.env.detail}` : ""}`);
  } else if (summary.env.status === "warning") {
    output.warn(`${summary.env.label}${summary.env.detail ? ` • ${summary.env.detail}` : ""}`);
  } else {
    output.error(`${summary.env.label}${summary.env.detail ? ` • ${summary.env.detail}` : ""}`);
  }

  output.printFrame(
    [
      summary.finalMessage,
      " ",
      `${summary.totalSizeLabel} stored`,
      `${summary.durationLabel}`
    ],
    summary.finalStatus
  );
}

async function runBackupMode(mode, config) {
  const startedAt = new Date();
  const backupId = getBackupId(startedAt);
  const dayStamp = getDayStamp(startedAt);
  const backupFolder = mode === "full" ? "full" : "incremental";
  const localPath = path.join(config.backupDir, backupFolder, dayStamp, backupId);
  const reposDirectory = path.join(localPath, "repositories");
  const manifestPath = path.join(localPath, "manifest.json");
  const logger = createLogger(backupId);

  ensureDir(reposDirectory);

  output.header(mode === "full" ? "full backup" : "quick backup");
  output.info(`Backup id: ${backupId}`);
  output.info(`Started at: ${formatTimestamp(startedAt)}`);

  const previousSuccess = getLatestSuccessfulBackup();
  const previousSnapshots = previousSuccess
    ? previousSuccess.repoSnapshots || previousSuccess.sourceSnapshots || {}
    : {};
  const previousEnvFingerprint = previousSuccess ? previousSuccess.envFingerprint || "" : "";

  let metadata;
  let status = "success";
  let errorMessage = null;
  let storageSummary = {
    status: "warning",
    label: "not uploaded",
    detail: "no changes"
  };
  let envSummary = {
    status: "warning",
    label: "skipped",
    detail: "no env files changed"
  };
  let displayedSizeLabel = "0 B";
  let totalUploadedBytes = 0;

  try {
    output.start(mode === "full" ? "Starting full backup" : "Starting quick backup");
    output.sync("Syncing repositories...");
    output.print("");
    const gitResults = pushRepositories(config.repos, logger);
    gitResults.forEach((result) => {
      output.statusLine(result.name, result.status, result.summary || result.reason || "");
    });
    output.print("");
    const gitSummary = summarizeGitResults(gitResults);

    const gitRepos = config.repos.filter((repo) => isGitRepository(repo.path));
    const backupCandidates =
      mode === "full"
        ? gitRepos
        : determineQuickCandidates(gitRepos, previousSnapshots);

    const repoBackups = [];
    if (backupCandidates.length > 0) {
      await withStepProgress("Creating repository backups", backupCandidates.length, async (progress) => {
        backupCandidates.forEach((repo) => {
          repoBackups.push(createRepoBackup(repo, reposDirectory, logger));
          progress.advance(repo.name);
        });
      });
    }

    const envBundle = createEnvBackup({
      repos: gitRepos,
      runRoot: localPath,
      envEncryption: config.envEncryption,
      logger,
      quickFingerprint: mode === "quick" ? previousEnvFingerprint : ""
    });

    const repoSnapshots = snapshotMapForRepos(gitRepos);
    const s3Prefix = buildS3Prefix(mode, dayStamp, backupId);
    const envS3Prefix = `env/${dayStamp}/${backupId}`;
    const noOp = backupCandidates.length === 0 && Boolean(envBundle.skipped);

    metadata = buildBackupMetadata({
      backupId,
      mode,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      dayStamp,
      status: "success",
      localPath,
      s3Prefix,
      envS3Prefix,
      repoSnapshots,
      repoBackups: repoBackups.map((item) => ({
        name: item.name,
        path: item.path,
        size: item.size
      })),
      envBundle,
      gitResults,
      parentBackupId: mode === "quick" && previousSuccess ? previousSuccess.backupId : null,
      noOp
    });

    fs.writeFileSync(manifestPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    if (!noOp) {
      if (repoBackups.length > 0) {
        output.upload("Uploading repositories...");
        const repoUpload = await withPercentProgress("Repository upload progress", ({ set }) =>
          uploadDirectory(
            {
              ...config,
              onProgress(progress) {
                const speedText = progress.speed ? ` • ${progress.speed}` : "";
                set(progress.percent, `${progress.transferred} / ${progress.total}${speedText}`);
              }
            },
            reposDirectory,
            `${s3Prefix}/repositories`
          )
        , { completeMessage: false, failMessage: "Repository upload failed" });
        output.success(`Uploaded (${repoUpload.transferred || formatBytes(repoBackups.reduce((sum, item) => sum + item.size, 0))})`);
        storageSummary = {
          status: "success",
          label: "uploaded",
          detail: repoUpload.transferred
            ? `${repoUpload.transferred}${repoUpload.speed ? ` • ${repoUpload.speed}` : ""}`
            : repoUpload.remotePath
        };
        displayedSizeLabel = repoUpload.transferred || formatBytes(repoBackups.reduce((sum, item) => sum + item.size, 0));
        totalUploadedBytes += repoBackups.reduce((sum, item) => sum + item.size, 0);
      }

      output.info("Uploading backup manifest...");
      const manifestUpload = await uploadFile(config, manifestPath, s3Prefix);
      output.success(`Manifest uploaded to ${manifestUpload.remotePath}`);
      totalUploadedBytes += fs.statSync(manifestPath).size;
      if (storageSummary.status !== "success") {
        storageSummary = {
          status: "success",
          label: "uploaded",
          detail: manifestUpload.remotePath
        };
        displayedSizeLabel = formatBytes(fs.statSync(manifestPath).size);
      }

      if (!envBundle.skipped && envBundle.backupPath) {
        output.upload("Uploading environment backup...");
        const envUpload = await withPercentProgress("Environment upload progress", ({ set }) =>
          uploadFile(
            {
              ...config,
              onProgress(progress) {
                const speedText = progress.speed ? ` • ${progress.speed}` : "";
                set(progress.percent, `${progress.transferred} / ${progress.total}${speedText}`);
              }
            },
            envBundle.backupPath,
            envS3Prefix
          )
        , { completeMessage: false, failMessage: "Environment upload failed" });
        output.success(`Env backup uploaded to ${envUpload.remotePath}`);
        envSummary = {
          status: "success",
          label: "saved",
          detail: envUpload.remotePath
        };
        totalUploadedBytes += fs.statSync(envBundle.backupPath).size;
      } else {
        envSummary = {
          status: "warning",
          label: "skipped",
          detail: formatEnvSkipReason(envBundle.reason)
        };
      }
    } else {
      storageSummary = {
        status: "warning",
        label: "skipped",
        detail: "nothing changed"
      };
      envSummary = {
        status: "warning",
        label: "skipped",
        detail: formatEnvSkipReason(envBundle.reason || "nothing changed")
      };
    }

    status = "success";

    metadata.status = status;
    metadata.endedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    appendHistory({
      backupId,
      mode,
      startedAt: metadata.startedAt,
      endedAt: metadata.endedAt,
      durationMs: Date.now() - startedAt.getTime(),
      status,
      noOp,
      localPath,
      manifestPath,
      s3Prefix: metadata.s3Prefix,
      envS3Prefix: metadata.envS3Prefix,
      logPath: logger.filePath,
      sizeLabel: displayedSizeLabel || formatBytes(totalUploadedBytes),
      totalSizeBytes: totalUploadedBytes,
      repoSnapshots,
      envFingerprint: envBundle.fingerprint || "",
      parentBackupId: metadata.parentBackupId || null
    });

    printBackupSummary({
      durationLabel: formatDuration(Date.now() - startedAt.getTime()),
      env: envSummary,
      finalMessage: gitSummary.failed > 0 ? "Backup completed with warnings ⚠" : "Backup successful ✔",
      finalStatus: gitSummary.failed > 0 ? "warning" : "success",
      git: {
        ...gitSummary,
        skipReason: formatGitSkipReason(gitSummary)
      },
      storage: storageSummary,
      totalSizeLabel: displayedSizeLabel || formatBytes(totalUploadedBytes)
    });

    if (config.notificationEnabled && process.env.BR_SUPPRESS_CLI_NOTIFICATIONS !== "1") {
      const notificationMessage = gitSummary.skipped > 0 || gitSummary.failed > 0
        ? "Backup completed with git warnings"
        : noOp
          ? "Backup finished: nothing changed"
          : "Backup completed successfully";
      notify("br", notificationMessage);
    }

    return metadata;
  } catch (error) {
    status = "error";
    errorMessage = error.message;
    metadata = buildBackupMetadata({
      backupId,
      mode,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      dayStamp,
      status,
      errorMessage,
      localPath
    });
    fs.writeFileSync(manifestPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    appendHistory({
      backupId,
      mode,
      startedAt: metadata.startedAt,
      endedAt: metadata.endedAt,
      status,
      noOp: false,
      localPath,
      manifestPath,
      logPath: logger.filePath,
      durationMs: Date.now() - startedAt.getTime(),
      repoSnapshots: {},
      envFingerprint: ""
    });

    output.error(error.message);
    if (config.notificationEnabled && process.env.BR_SUPPRESS_CLI_NOTIFICATIONS !== "1") {
      notify("br", "Backup failed");
    }
    throw error;
  }
}

function printHistory(limit = 10) {
  const history = require("./history-service").loadHistory();

  output.header("history");

  if (history.length === 0) {
    output.info("No backups recorded yet.");
    return;
  }

  history.slice(0, Number(limit)).forEach((entry) => {
    output.statusLine(
      entry.backupId,
      entry.status === "success" ? "success" : entry.status === "error" ? "error" : "warning",
      [
        entry.mode === "quick" ? "quick" : "full",
        formatCompactTimestamp(entry.endedAt),
        entry.sizeLabel || "",
        entry.durationMs ? formatDuration(entry.durationMs) : "",
        entry.noOp ? "no changes" : ""
      ].filter(Boolean).join(" • ")
    );
  });
}

module.exports = {
  printHistory,
  runBackupMode
};
