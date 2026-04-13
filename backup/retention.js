const { removePath } = require("../core/fs-utils");

function computeRetentionPlan(history, retentionConfig) {
  const now = Date.now();
  const localDeadline = now - retentionConfig.localDays * 24 * 60 * 60 * 1000;
  const s3Deadline = now - retentionConfig.s3Days * 24 * 60 * 60 * 1000;

  const local = history.filter((entry) => {
    if (!entry.endedAt || !entry.localPath) {
      return false;
    }
    return new Date(entry.endedAt).getTime() < localDeadline;
  });

  const remote = history.filter((entry) => {
    if (!entry.endedAt || !entry.s3Prefix) {
      return false;
    }
    return new Date(entry.endedAt).getTime() < s3Deadline;
  });

  return { local, remote };
}

function pruneLocalBackups(entries) {
  entries.forEach((entry) => {
    if (entry.localPath) {
      removePath(entry.localPath);
    }

    if (entry.manifestPath) {
      removePath(entry.manifestPath);
    }
  });
}

module.exports = {
  computeRetentionPlan,
  pruneLocalBackups
};
