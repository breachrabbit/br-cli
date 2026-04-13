const { runCommand } = require("../core/process");

function escapeAppleScriptString(input) {
  return String(input || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function notify(title, message) {
  if (process.platform !== "darwin") {
    return;
  }

  const escapedTitle = escapeAppleScriptString(title);
  const escapedMessage = escapeAppleScriptString(message);
  runCommand("osascript", [
    "-e",
    `display notification "${escapedMessage}" with title "${escapedTitle}"`
  ], { allowFailure: true });
}

module.exports = {
  notify
};
