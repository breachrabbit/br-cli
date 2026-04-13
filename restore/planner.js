function resolveTargetEntry(history, options) {
  if (options.backupId) {
    return history.find((entry) => entry.backupId === options.backupId) || null;
  }

  if (!options.at) {
    return history.find((entry) => entry.status === "success") || null;
  }

  const targetTime = new Date(options.at).getTime();
  return (
    history
      .filter((entry) => entry.status === "success")
      .find((entry) => new Date(entry.endedAt).getTime() <= targetTime) || null
  );
}

function buildRestorePlan(history, options = {}) {
  const successful = history
    .filter((entry) => entry.status === "success")
    .sort((left, right) => new Date(right.endedAt) - new Date(left.endedAt));

  const target = resolveTargetEntry(successful, options);
  if (!target) {
    return null;
  }

  const targetTime = new Date(target.endedAt).getTime();
  const fullBackup = successful.find(
    (entry) => entry.mode === "full" && new Date(entry.endedAt).getTime() <= targetTime
  );

  if (!fullBackup) {
    return null;
  }

  const incrementals = successful
    .filter((entry) => {
      const endedAt = new Date(entry.endedAt).getTime();
      return (
        entry.mode === "quick" &&
        endedAt > new Date(fullBackup.endedAt).getTime() &&
        endedAt <= targetTime
      );
    })
    .sort((left, right) => new Date(left.endedAt) - new Date(right.endedAt));

  return {
    target,
    fullBackup,
    incrementals
  };
}

module.exports = {
  buildRestorePlan
};
