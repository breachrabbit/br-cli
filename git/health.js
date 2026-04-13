const { RBError } = require("../core/errors");
const { runCommand } = require("../core/process");

const GitStatus = {
  AHEAD: "ahead",
  BEHIND: "behind",
  DETACHED: "detached",
  DIRTY: "dirty",
  DIVERGED: "diverged",
  ERROR: "error",
  NO_UPSTREAM: "no_upstream",
  OK: "ok",
  UP_TO_DATE: "up_to_date"
};

function runGit(repoPath, args, options = {}) {
  return runCommand("git", ["-C", repoPath, ...args], {
    allowFailure: true,
    ...options
  });
}

function hasOrigin(repoPath) {
  const result = runGit(repoPath, ["remote", "get-url", "origin"]);
  return result.status === 0;
}

function getBranch(repoPath) {
  const result = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() || "HEAD" : "HEAD";
}

function getStatusLines(repoPath) {
  const result = runGit(repoPath, ["status", "-sb"]);
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function getUpstream(repoPath) {
  const result = runGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function fetchAll(repoPath) {
  return runGit(repoPath, ["fetch", "--all", "--prune"]);
}

function isFetchWritePermissionIssue(output) {
  const normalized = String(output || "").toLowerCase();
  return normalized.includes("fetch_head") && normalized.includes("operation not permitted");
}

function isRemoteFetchFailure(output) {
  const normalized = String(output || "").toLowerCase();
  return (
    normalized.includes("authentication failed") ||
    normalized.includes("could not read from remote repository") ||
    normalized.includes("could not resolve host") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("connection timed out") ||
    normalized.includes("operation timed out") ||
    normalized.includes("permission denied") ||
    normalized.includes("access denied") ||
    normalized.includes("repository not found")
  );
}

function parseStatusLine(line) {
  const trimmed = String(line || "").trim();
  const detached = /^## HEAD(?: |\b)/.test(trimmed) || trimmed.includes("(no branch)");
  const upstreamMatch = trimmed.match(/^## (?<branch>[^\.\s]+)(?:\.\.\.(?<upstream>[^\s]+))?(?: \[(?<tracking>[^\]]+)\])?/);
  const tracking = upstreamMatch && upstreamMatch.groups ? upstreamMatch.groups.tracking || "" : "";
  const aheadMatch = tracking.match(/ahead (\d+)/);
  const behindMatch = tracking.match(/behind (\d+)/);

  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    detached,
    hasUpstream: Boolean(upstreamMatch && upstreamMatch.groups && upstreamMatch.groups.upstream),
    line: trimmed,
    tracking
  };
}

function describeStatus(status) {
  switch (status) {
    case GitStatus.UP_TO_DATE:
    case GitStatus.OK:
      return {
        action: "",
        label: "up-to-date",
        level: "success",
        risk: ""
      };
    case GitStatus.AHEAD:
      return {
        action: "git push",
        label: "local commits ahead",
        level: "success",
        risk: ""
      };
    case GitStatus.BEHIND:
      return {
        action: "git pull --rebase",
        label: "remote ahead",
        level: "warning",
        risk: "backup may be outdated"
      };
    case GitStatus.DIVERGED:
      return {
        action: "resolve divergence manually",
        label: "branch diverged",
        level: "warning",
        risk: "backup may not match intended history"
      };
    case GitStatus.NO_UPSTREAM:
      return {
        action: "git push --set-upstream origin <branch>",
        label: "no upstream",
        level: "warning",
        risk: "git sync will be skipped"
      };
    case GitStatus.DETACHED:
      return {
        action: "checkout a branch",
        label: "detached HEAD",
        level: "warning",
        risk: "backup has no branch tracking"
      };
    case GitStatus.DIRTY:
      return {
        action: "commit or stash changes if needed",
        label: "uncommitted changes",
        level: "warning",
        risk: "backup contains local-only modifications"
      };
    default:
      return {
        action: "inspect git output",
        label: "git error",
        level: "error",
        risk: "git sync could not be verified"
      };
  }
}

function classifyRepoHealth(repo, logger) {
  const branch = getBranch(repo.path);
  const statusLines = getStatusLines(repo.path);
  const summaryLine = parseStatusLine(statusLines[0] || "");
  const dirty = statusLines.length > 1;
  const base = {
    action: "",
    branch,
    detail: "",
    level: "warning",
    name: repo.name,
    path: repo.path,
    risk: "",
    status: GitStatus.ERROR
  };

  if (summaryLine.detached || branch === "HEAD") {
    const meta = describeStatus(GitStatus.DETACHED);
    logger.warn(`Git health warning for ${repo.name}: detached HEAD`);
    return {
      ...base,
      ...meta,
      status: GitStatus.DETACHED
    };
  }

  if (!hasOrigin(repo.path)) {
    logger.warn(`Git health warning for ${repo.name}: origin remote missing`);
    return {
      ...base,
      action: "git remote add origin <url>",
      label: "no origin",
      level: "warning",
      risk: "git sync will be skipped",
      status: GitStatus.ERROR
    };
  }

  const fetchResult = fetchAll(repo.path);
  if (fetchResult.status !== 0) {
    const fetchOutput = `${fetchResult.stdout}\n${fetchResult.stderr}`.trim();
    if (isRemoteFetchFailure(fetchOutput)) {
      logger.error(`Git health error for ${repo.name}: ${fetchOutput}`);
      return {
        ...base,
        action: "check network or credentials",
        detail: fetchOutput,
        label: "fetch failed",
        level: "error",
        risk: "git state could not be refreshed",
        status: GitStatus.ERROR
      };
    }

    if (!isFetchWritePermissionIssue(fetchOutput)) {
      logger.warn(`Git health refresh skipped for ${repo.name}: ${fetchOutput}`);
    }
  }

  const upstream = getUpstream(repo.path);
  if (!upstream && !summaryLine.hasUpstream) {
    const meta = describeStatus(GitStatus.NO_UPSTREAM);
    logger.warn(`Git health warning for ${repo.name}: no upstream`);
    return {
      ...base,
      ...meta,
      status: GitStatus.NO_UPSTREAM
    };
  }

  if (summaryLine.ahead > 0 && summaryLine.behind > 0) {
    const meta = describeStatus(GitStatus.DIVERGED);
    logger.warn(`Git health warning for ${repo.name}: diverged`);
    return {
      ...base,
      ...meta,
      status: GitStatus.DIVERGED
    };
  }

  if (summaryLine.behind > 0) {
    const meta = describeStatus(GitStatus.BEHIND);
    logger.warn(`Git health warning for ${repo.name}: remote ahead`);
    return {
      ...base,
      ...meta,
      status: GitStatus.BEHIND
    };
  }

  if (summaryLine.ahead > 0) {
    const meta = describeStatus(GitStatus.AHEAD);
    logger.info(`Git health ok for ${repo.name}: ahead`);
    return {
      ...base,
      ...meta,
      status: GitStatus.AHEAD
    };
  }

  if (dirty) {
    const meta = describeStatus(GitStatus.DIRTY);
    logger.warn(`Git health warning for ${repo.name}: dirty working tree`);
    return {
      ...base,
      ...meta,
      status: GitStatus.DIRTY
    };
  }

  const meta = describeStatus(GitStatus.UP_TO_DATE);
  logger.info(`Git health ok for ${repo.name}: up-to-date`);
  return {
    ...base,
    ...meta,
    status: GitStatus.UP_TO_DATE
  };
}

function summarizeHealth(results) {
  return results.reduce((summary, result) => {
    if ([GitStatus.OK, GitStatus.UP_TO_DATE, GitStatus.AHEAD].includes(result.status)) {
      summary.healthy += 1;
      return summary;
    }

    if (result.status === GitStatus.ERROR) {
      summary.errors += 1;
    } else {
      summary.warnings += 1;
    }

    if (result.status === GitStatus.NO_UPSTREAM) {
      summary.noUpstream += 1;
    }
    if (result.status === GitStatus.BEHIND) {
      summary.behind += 1;
    }
    if (result.status === GitStatus.DETACHED) {
      summary.detached += 1;
    }
    if (result.status === GitStatus.DIVERGED) {
      summary.diverged += 1;
    }
    if (result.status === GitStatus.DIRTY) {
      summary.dirty += 1;
    }
    return summary;
  }, {
    behind: 0,
    detached: 0,
    dirty: 0,
    diverged: 0,
    errors: 0,
    healthy: 0,
    noUpstream: 0,
    warnings: 0
  });
}

function hasStrictIssues(results) {
  return results.some((result) => ![GitStatus.OK, GitStatus.UP_TO_DATE, GitStatus.AHEAD].includes(result.status));
}

function renderGitHealth(results, modeLabel = "SAFE") {
  const output = require("../ui/output");
  const summary = summarizeHealth(results);

  output.sync("Checking repository health...");
  output.print("");
  results.forEach((result) => {
    const icon = result.level === "success" ? "✔" : result.level === "error" ? "✖" : "⚠";
    output.print(result.name);
    output.print(`  ${icon} ${result.label}`);
    if (result.action) {
      output.print(`  → run: ${result.action}`);
    }
    if (result.risk && result.level !== "success") {
      output.print(`  Risk: ${result.risk}`);
    }
    output.print("");
  });

  output.section("Summary");
  output.success(`${summary.healthy} healthy`);
  if (summary.warnings > 0) {
    output.warn(`${summary.warnings} need attention`);
  }
  if (summary.errors > 0) {
    output.error(`${summary.errors} error`);
  }
  output.note(`Mode: ${modeLabel} ${hasStrictIssues(results) && modeLabel === "STRICT" ? "→ backup will stop" : "→ continuing backup"}`);
}

function setUpstream(repo, logger) {
  const branch = getBranch(repo.path);
  const remoteBranchResult = runGit(repo.path, ["rev-parse", "--verify", `origin/${branch}`]);
  if (remoteBranchResult.status === 0) {
    return runGit(repo.path, ["branch", "--set-upstream-to", `origin/${branch}`, branch]);
  }

  logger.info(`Creating upstream branch for ${repo.name}`);
  return runGit(repo.path, ["push", "-u", "origin", "HEAD"]);
}

function autoFixRepoHealth(result, logger) {
  if (result.status === GitStatus.BEHIND) {
    logger.info(`Applying auto-fix for ${result.name}: git pull --rebase`);
    return runGit(result.path, ["pull", "--rebase"]);
  }

  if (result.status === GitStatus.NO_UPSTREAM) {
    logger.info(`Applying auto-fix for ${result.name}: set upstream`);
    return setUpstream(result, logger);
  }

  return null;
}

function attemptAutoFixes(results, logger) {
  results.forEach((result) => {
    if ([GitStatus.BEHIND, GitStatus.NO_UPSTREAM].includes(result.status)) {
      autoFixRepoHealth(result, logger);
    }
  });
}

function checkGitHealth(repos, logger, options = {}) {
  const mode = options.mode || "safe";
  const results = repos.map((repo) => classifyRepoHealth(repo, logger));

  if (mode === "smart") {
    attemptAutoFixes(results, logger);
    return repos.map((repo) => classifyRepoHealth(repo, logger));
  }

  return results;
}

function healthSummaryLine(results) {
  const summary = summarizeHealth(results);
  const parts = [];
  if (summary.noUpstream > 0) {
    parts.push("no upstream configured");
  }
  if (summary.behind > 0) {
    parts.push("remote ahead");
  }
  if (summary.detached > 0) {
    parts.push("detached HEAD");
  }
  if (summary.diverged > 0) {
    parts.push("diverged");
  }
  if (summary.dirty > 0) {
    parts.push("dirty working tree");
  }

  return parts.join(", ") || "healthy";
}

function assertStrictHealth(results) {
  if (!hasStrictIssues(results)) {
    return;
  }

  throw new RBError("Strict mode blocked backup because repository health warnings were found.", {
    code: "GIT_HEALTH_BLOCKED",
    details: healthSummaryLine(results)
  });
}

module.exports = {
  GitStatus,
  assertStrictHealth,
  checkGitHealth,
  hasStrictIssues,
  healthSummaryLine,
  renderGitHealth,
  summarizeHealth
};
