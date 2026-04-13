const path = require("path");
const { runCommand } = require("../core/process");

function isGitRepository(repoPath) {
  const result = runCommand(
    "git",
    ["-C", repoPath, "rev-parse", "--is-inside-work-tree"],
    { allowFailure: true }
  );

  return result.status === 0 && result.stdout.trim() === "true";
}

function hasOrigin(repoPath) {
  const result = runCommand(
    "git",
    ["-C", repoPath, "remote", "get-url", "origin"],
    { allowFailure: true }
  );
  return result.status === 0;
}

function getCurrentBranch(repoPath) {
  const result = runCommand(
    "git",
    ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
    { allowFailure: true }
  );

  if (result.status !== 0) {
    return "HEAD";
  }

  return result.stdout.trim() || "HEAD";
}

function getHeadCommit(repoPath) {
  const result = runCommand(
    "git",
    ["-C", repoPath, "rev-parse", "HEAD"],
    { allowFailure: true }
  );

  return result.status === 0 ? result.stdout.trim() : null;
}

function getWorkingTreeStatus(repoPath) {
  const result = runCommand(
    "git",
    ["-C", repoPath, "status", "--porcelain"],
    { allowFailure: true }
  );

  return result.status === 0 ? result.stdout.trim() : "";
}

function getRepoSnapshot(repoPath) {
  return {
    headCommit: getHeadCommit(repoPath),
    status: getWorkingTreeStatus(repoPath)
  };
}

function isMissingUpstream(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("has no upstream branch") ||
    normalized.includes("current branch") && normalized.includes("no upstream branch") ||
    normalized.includes("set the remote as upstream") ||
    normalized.includes("no upstream configured") ||
    normalized.includes("you are not currently on a branch")
  );
}

function isEverythingUpToDate(output) {
  return output.toLowerCase().includes("everything up-to-date");
}

function isDetachedHead(branch) {
  return branch === "HEAD";
}

function isNonFastForward(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("non-fast-forward") ||
    normalized.includes("fetch first") ||
    normalized.includes("tip of your current branch is behind") ||
    normalized.includes("updates were rejected because")
  );
}

function isRealGitFailure(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("permission denied") ||
    normalized.includes("authentication failed") ||
    normalized.includes("could not read from remote repository") ||
    normalized.includes("could not resolve host") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("connection timed out") ||
    normalized.includes("operation timed out") ||
    normalized.includes("access denied") ||
    normalized.includes("repository not found")
  );
}

function pushRepository(repo, logger) {
  const baseResult = {
    name: repo.name,
    path: repo.path,
    relativePath: path.relative(process.cwd(), repo.path) || repo.path
  };

  if (!isGitRepository(repo.path)) {
    logger.warn(`Skipping non-git path: ${repo.path}`);
    return {
      ...baseResult,
      status: "warning",
      reason: "not-git",
      summary: "not a git repository"
    };
  }

  if (!hasOrigin(repo.path)) {
    logger.warn(`Skipping ${repo.name}: origin remote is missing`);
    return {
      ...baseResult,
      status: "warning",
      reason: "missing-origin",
      summary: "no origin configured",
      skipped: true
    };
  }

  const branch = getCurrentBranch(repo.path);

  if (isDetachedHead(branch)) {
    logger.warn(`Git sync skipped for ${repo.name}: detached HEAD`);
    return {
      ...baseResult,
      status: "warning",
      branch,
      reason: "detached-head",
      summary: "detached HEAD (skipped)",
      skipped: true
    };
  }

  const pushResult = runCommand("git", ["-C", repo.path, "push"], { allowFailure: true });
  const pushOutput = `${pushResult.stdout}\n${pushResult.stderr}`;

  if (pushResult.status === 0) {
    logger.info(`Git push ok for ${repo.name}`);
    return {
      ...baseResult,
      status: "success",
      branch,
      reason: isEverythingUpToDate(pushOutput) ? "up-to-date" : "pushed",
      summary: isEverythingUpToDate(pushOutput) ? "up-to-date" : "pushed"
    };
  }

  if (isMissingUpstream(pushOutput)) {
    const upstreamResult = runCommand(
      "git",
      ["-C", repo.path, "push", "-u", "origin", "HEAD"],
      { allowFailure: true }
    );
    const upstreamOutput = `${upstreamResult.stdout}\n${upstreamResult.stderr}`;

    if (upstreamResult.status === 0) {
      logger.info(`Configured upstream and pushed ${repo.name}`);
      return {
        ...baseResult,
        status: "success",
        branch,
        upstreamFixed: true,
        reason: "upstream-configured",
        summary: isEverythingUpToDate(upstreamOutput) ? "up-to-date" : "pushed"
      };
    }

    if (isNonFastForward(upstreamOutput)) {
      logger.warn(`Git sync skipped for ${repo.name}: remote is ahead`);
      return {
        ...baseResult,
        status: "warning",
        branch,
        reason: "remote-ahead",
        summary: "remote ahead (pull needed)",
        skipped: true,
        detail: upstreamOutput.trim()
      };
    }

    logger.warn(`Unable to set upstream for ${repo.name}`);
    return {
      ...baseResult,
      status: "warning",
      branch,
      reason: "upstream-failed",
      summary: "no upstream (not configured)",
      skipped: true,
      detail: upstreamOutput.trim()
    };
  }

  if (isNonFastForward(pushOutput)) {
    logger.warn(`Git sync skipped for ${repo.name}: remote is ahead`);
    return {
      ...baseResult,
      status: "warning",
      branch,
      reason: "remote-ahead",
      summary: "remote ahead (pull needed)",
      skipped: true,
      detail: pushOutput.trim()
    };
  }

  if (!isRealGitFailure(pushOutput)) {
    logger.warn(`Git sync skipped for ${repo.name}`);
    return {
      ...baseResult,
      status: "warning",
      branch,
      reason: "upstream-failed",
      summary: "no upstream (not configured)",
      skipped: true,
      detail: pushOutput.trim()
    };
  }

  logger.error(`Git push failed for ${repo.name}`);
  return {
    ...baseResult,
    status: "error",
    branch,
    reason: "push-failed",
    summary: "failed",
    detail: pushOutput.trim()
  };
}

function pushRepositories(repos, logger) {
  return repos.map((repo) => pushRepository(repo, logger));
}

module.exports = {
  getCurrentBranch,
  getRepoSnapshot,
  isGitRepository,
  pushRepositories
};
