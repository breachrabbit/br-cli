const chalk = require("chalk").default;
const { formatDuration } = require("../core/time");

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function renderBar(percent, width = 24) {
  const safePercent = clampPercent(percent);
  const filled = Math.round((safePercent / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function emitAgentProgress(label, percent, detail = "") {
  if (process.env.BR_AGENT_PROGRESS !== "1") {
    return;
  }

  process.stdout.write(`${JSON.stringify({
    type: "progress",
    label,
    percent: clampPercent(percent),
    detail
  })}\n`);
}

class ProgressBar {
  constructor(label) {
    this.label = label;
    this.enabled = Boolean(process.stdout.isTTY);
    this.currentDetail = "";
    this.currentPercent = 0;
    this.startedAt = Date.now();
    this.timer = null;
  }

  render() {
    const bar = renderBar(this.currentPercent);
    const elapsed = formatDuration(Date.now() - this.startedAt);
    const suffix = [this.currentDetail, elapsed].filter(Boolean).join(" • ");
    process.stdout.write(`\r${chalk.cyan("⏳")} ${this.label} ${chalk.cyan(`[${bar}] ${String(clampPercent(this.currentPercent)).padStart(3, " ")}%`)}${suffix ? ` ${chalk.gray(suffix)}` : ""}`);
  }

  update(percent, detail = "") {
    this.currentPercent = clampPercent(percent);
    this.currentDetail = detail;
    if (!this.enabled) {
      emitAgentProgress(this.label, this.currentPercent, this.currentDetail);
      return;
    }

    this.render();
  }

  startTicker() {
    if (!this.enabled || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.render();
    }, 1000);
  }

  clear() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.enabled) {
      process.stdout.write("\r\x1b[2K");
    }
  }

  complete(message, detail = "") {
    this.clear();
    if (!this.enabled) {
      process.stdout.write(`${chalk.green("✔")} ${message}${detail ? ` ${detail}` : ""}\n`);
      return;
    }

    process.stdout.write(`${chalk.green("✔")} ${message}${detail ? ` ${chalk.gray(detail)}` : ""}\n`);
  }

  fail(message, detail = "") {
    this.clear();
    if (!this.enabled) {
      process.stdout.write(`${chalk.red("✖")} ${message}${detail ? ` ${detail}` : ""}\n`);
      return;
    }

    process.stdout.write(`${chalk.red("✖")} ${message}${detail ? ` ${chalk.gray(detail)}` : ""}\n`);
  }
}

async function withPercentProgress(label, task, options = {}) {
  const bar = new ProgressBar(label);
  bar.update(0);
  bar.startTicker();

  try {
    const result = await task({
      set(percent, detail = "") {
        bar.update(percent, detail);
      }
    });
    if (options.completeMessage !== false) {
      bar.complete(options.completeMessage || label);
    } else {
      bar.clear();
    }
    return result;
  } catch (error) {
    bar.fail(options.failMessage || label);
    throw error;
  }
}

async function withStepProgress(label, total, task, options = {}) {
  const bar = new ProgressBar(label);
  let current = 0;
  const safeTotal = Math.max(1, total);
  bar.update(0);
  bar.startTicker();

  try {
    const result = await task({
      advance(detail = "") {
        current += 1;
        bar.update((current / safeTotal) * 100, detail);
      },
      set(currentValue, detail = "") {
        current = currentValue;
        bar.update((current / safeTotal) * 100, detail);
      }
    });
    if (options.completeMessage !== false) {
      bar.complete(options.completeMessage || label);
    } else {
      bar.clear();
    }
    return result;
  } catch (error) {
    bar.fail(options.failMessage || label);
    throw error;
  }
}

module.exports = {
  ProgressBar,
  withPercentProgress,
  withStepProgress
};
