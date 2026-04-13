const chalk = require("chalk").default;

const ICONS = {
  error: "✖",
  progress: "⏳",
  start: "🚀",
  success: "✔",
  sync: "🔄",
  upload: "☁️",
  warning: "⚠"
};

const state = {
  debug: false
};

function print(line = "") {
  process.stdout.write(`${line}\n`);
}

function icon(kind) {
  switch (kind) {
    case "success":
      return chalk.green(ICONS.success);
    case "warning":
      return chalk.yellow(ICONS.warning);
    case "error":
      return chalk.red(ICONS.error);
    case "start":
      return chalk.cyan(ICONS.start);
    case "upload":
      return chalk.blue(ICONS.upload);
    case "sync":
      return chalk.cyan(ICONS.sync);
    default:
      return chalk.cyan(ICONS.progress);
  }
}

function line(kind, message) {
  print(`${icon(kind)} ${message}`);
}

function setDebug(enabled) {
  state.debug = Boolean(enabled);
}

function isDebugEnabled() {
  return state.debug;
}

function start(message) {
  line("start", chalk.bold(message));
}

function info(message) {
  line("progress", message);
}

function upload(message) {
  line("upload", message);
}

function sync(message) {
  line("sync", message);
}

function success(message) {
  line("success", message);
}

function warn(message) {
  line("warning", message);
}

function error(message) {
  line("error", message);
}

function note(message) {
  print(chalk.gray(message));
}

function header(title) {
  print("");
  print(chalk.bold.white(`BR Labs ${chalk.gray(`• ${title}`)}`));
  print("");
}

function section(title) {
  print("");
  print(chalk.bold.white(title));
}

function divider() {
  print(chalk.gray("─".repeat(52)));
}

function printKeyValue(label, value) {
  print(`${chalk.gray(`${label}:`)} ${value}`);
}

function statusLine(label, status, detail = "") {
  const width = 28;
  const padded = String(label).padEnd(width, " ");
  const detailText = detail ? chalk.gray(detail) : "";
  print(`${chalk.white(padded)} ${icon(status)} ${detailText}`);
}

function printFrame(lines, status = "success") {
  const visibleLines = lines.filter(Boolean);
  const width = Math.max(...visibleLines.map((line) => line.length), 24);
  const borderColor = status === "error" ? chalk.red : status === "warning" ? chalk.yellow : chalk.green;
  print("");
  print(borderColor(`╭${"─".repeat(width + 2)}╮`));
  visibleLines.forEach((lineText) => {
    print(borderColor(`│ `) + lineText.padEnd(width, " ") + borderColor(" │"));
  });
  print(borderColor(`╰${"─".repeat(width + 2)}╯`));
}

function debug(message) {
  if (state.debug) {
    print(chalk.magenta(`debug ${message}`));
  }
}

function formatError(errorObject) {
  const message = errorObject && errorObject.message ? errorObject.message : String(errorObject);
  const detail = errorObject && errorObject.details ? errorObject.details : null;

  if (message.includes("rclone connection test failed")) {
    return {
      title: "rclone connection failed",
      reason: "Check the endpoint, bucket, or access credentials."
    };
  }

  if (message.includes("Storage bucket is not configured")) {
    return {
      title: "storage is not configured",
      reason: "Run br setup or update storage settings."
    };
  }

  if (message.includes("Failed to upload") || message.includes("rclone")) {
    return {
      title: "failed to upload backups",
      reason: "Check the network connection, endpoint, and rclone configuration."
    };
  }

  return {
    title: message,
    reason: detail
  };
}

function printError(errorObject) {
  const formatted = formatError(errorObject);
  error(formatted.title);
  if (formatted.reason) {
    print(`Reason: ${formatted.reason}`);
  }

  if (state.debug && errorObject) {
    if (errorObject.stack) {
      print(chalk.gray(errorObject.stack));
    } else if (errorObject.details) {
      print(chalk.gray(String(errorObject.details)));
    }
  }
}

module.exports = {
  debug,
  divider,
  error,
  header,
  info,
  isDebugEnabled,
  note,
  print,
  printError,
  printFrame,
  printKeyValue,
  section,
  setDebug,
  start,
  statusLine,
  success,
  sync,
  upload,
  warn
};
