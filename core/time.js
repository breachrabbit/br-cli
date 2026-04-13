function pad(value) {
  return String(value).padStart(2, "0");
}

function getDayStamp(input = new Date()) {
  const date = new Date(input);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getBackupId(input = new Date()) {
  const date = new Date(input);
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function formatTimestamp(input) {
  const date = new Date(input);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatCompactTimestamp(input) {
  const date = new Date(input);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(inputMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(inputMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatRelativeTimestamp(input) {
  if (!input) {
    return "never";
  }

  const date = new Date(input);
  const now = new Date();
  const targetDay = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (targetDay === today) {
    return `today at ${time}`;
  }

  if (targetDay === tomorrowKey) {
    return `tomorrow at ${time}`;
  }

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${time}`;
}

module.exports = {
  formatCompactTimestamp,
  formatDuration,
  formatRelativeTimestamp,
  formatTimestamp,
  getBackupId,
  getDayStamp
};
