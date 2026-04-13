function buildBackupMetadata(input) {
  return {
    version: 1,
    backupId: input.backupId,
    mode: input.mode,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    dayStamp: input.dayStamp,
    status: input.status,
    errorMessage: input.errorMessage || null,
    localPath: input.localPath,
    s3Prefix: input.s3Prefix || null,
    envS3Prefix: input.envS3Prefix || null,
    repoSnapshots: input.repoSnapshots || {},
    repoBackups: input.repoBackups || [],
    envBundle: input.envBundle || null,
    gitResults: input.gitResults || [],
    parentBackupId: input.parentBackupId || null,
    noOp: Boolean(input.noOp)
  };
}

module.exports = {
  buildBackupMetadata
};
