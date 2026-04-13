const chalk = require("chalk").default;
const { askInput } = require("./prompts");
const { clearScreen, printBrand } = require("./layout");

const MAIN_MENU = [
  {
    description: "Run a complete repository backup",
    label: "Run full backup",
    value: "run"
  },
  {
    description: "Run a faster lightweight backup pass",
    label: "Run quick backup",
    value: "quick"
  },
  {
    description: "Configure storage and repositories",
    label: "Setup",
    value: "setup"
  },
  {
    description: "Review previous backup results",
    label: "History",
    value: "history"
  },
  {
    description: "Open and inspect backup logs",
    label: "Logs",
    value: "logs"
  },
  {
    description: "Automate backups with launchd",
    label: "Schedule",
    value: "schedule"
  },
  {
    description: "Configure storage, repositories, and backup behavior",
    label: "Settings",
    value: "settings"
  },
  {
    description: "Close the CLI",
    label: "Exit",
    value: "exit"
  }
];

const SCHEDULE_MENU = [
  {
    description: "Inspect full and quick schedule state",
    label: "View schedule",
    value: "status"
  },
  {
    description: "Set daily backup time",
    label: "Configure full backup",
    value: "full"
  },
  {
    description: "Set interval for quick backups",
    label: "Configure quick backup",
    value: "quick"
  },
  {
    description: "Disable the daily full backup schedule",
    label: "Disable full backup",
    value: "disable-full"
  },
  {
    description: "Disable the recurring quick backup schedule",
    label: "Disable quick backup",
    value: "disable-quick"
  },
  {
    description: "Return to the main menu",
    label: "Back",
    value: "back"
  }
];

const SETTINGS_MENU = [
  {
    description: "Edit S3 bucket, endpoint, and remote settings",
    label: "Storage",
    value: "storage"
  },
  {
    description: "Choose repositories included in backups",
    label: "Repositories",
    value: "repositories"
  },
  {
    description: "Control macOS notification behavior",
    label: "Notifications",
    value: "notifications"
  },
  {
    description: "Adjust local and remote retention windows",
    label: "Retention",
    value: "retention"
  },
  {
    description: "Manage .env backup protection",
    label: "Encryption",
    value: "encryption"
  },
  {
    description: "Return to the main menu",
    label: "Back",
    value: "back"
  }
];

const REPOSITORY_MENU = [
  {
    description: "Add another folder to scan for repositories",
    label: "Add path",
    value: "add-path"
  },
  {
    description: "Remove a folder from repository scanning",
    label: "Remove path",
    value: "remove-path"
  },
  {
    description: "Scan configured paths and choose repositories",
    label: "Rescan",
    value: "rescan"
  },
  {
    description: "Return to settings",
    label: "Back",
    value: "back"
  }
];

function buildLogsMenu(logs) {
  return [
    ...logs.map((entry) => ({
      description: entry.description,
      label: entry.backupId,
      value: entry.backupId
    })),
    {
      description: "Return to the main menu",
      label: "Back",
      value: "back"
    }
  ];
}

function readKey(input) {
  return new Promise((resolve, reject) => {
    function onData(chunk) {
      cleanup();
      resolve(chunk.toString("utf8"));
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function cleanup() {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
    }

    input.once("data", onData);
    input.once("error", onError);
  });
}

function renderScreen({ items, selectedIndex, title, subtitle, footer, updateNotice }) {
  clearScreen();
  printBrand("BR Labs", subtitle);
  if (updateNotice) {
    process.stdout.write(`${chalk.yellow(updateNotice)}\n\n`);
  }
  if (title) {
    process.stdout.write(`${chalk.white(title)}\n\n`);
  }

  const labelWidth = 26;

  items.forEach((item, index) => {
    const active = index === selectedIndex;
    const pointer = active ? chalk.cyan("▸") : " ";
    const paddedLabel = item.label.padEnd(labelWidth, " ");
    const label = active ? chalk.cyan(paddedLabel) : chalk.white(paddedLabel);
    const description = active ? chalk.cyanBright(item.description) : chalk.gray(item.description);
    process.stdout.write(`${pointer} ${label} ${description}\n`);
  });

  process.stdout.write(`\n${chalk.gray(footer || "↑↓ Navigate  |  Enter Select  |  Q Quit")}\n`);
}

async function promptScreen({ items, title, subtitle, footer, updateNotice }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive menu requires a TTY terminal.");
  }

  let selectedIndex = 0;
  const input = process.stdin;
  const output = process.stdout;

  if (typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  if (typeof input.resume === "function") {
    input.resume();
  }
  output.write("\x1b[?25l");

  try {
    renderScreen({ items, selectedIndex, title, subtitle, footer, updateNotice });

    while (true) {
      const key = await readKey(input);

      if (key === "\u0003" || key.toLowerCase() === "q") {
        return null;
      }

      if (key === "\r" || key === "\n") {
        return items[selectedIndex].value;
      }

      if (key === "\u001b[A") {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        renderScreen({ items, selectedIndex, title, subtitle, footer, updateNotice });
        continue;
      }

      if (key === "\u001b[B") {
        selectedIndex = (selectedIndex + 1) % items.length;
        renderScreen({ items, selectedIndex, title, subtitle, footer, updateNotice });
        continue;
      }

      const numericChoice = Number(key);
      if (Number.isInteger(numericChoice) && numericChoice > 0 && numericChoice <= items.length) {
        selectedIndex = numericChoice - 1;
        renderScreen({ items, selectedIndex, title, subtitle, footer, updateNotice });
      }
    }
  } finally {
    if (typeof input.pause === "function") {
      input.pause();
    }
    if (typeof input.setRawMode === "function") {
      input.setRawMode(false);
    }
    output.write("\x1b[?25h");
  }
}

async function promptMainMenu(options = {}) {
  const choice = await promptScreen({
    footer: "↑↓ Navigate  |  Enter Select  |  Q Quit",
    items: MAIN_MENU,
    subtitle: "Backup & recovery CLI for Breach Rabbit environments",
    title: "",
    updateNotice: options.updateNotice
  });

  if (!choice || choice === "exit") {
    return null;
  }

  return [choice];
}

async function promptScheduleMenu() {
  return promptScreen({
    footer: "↑↓ Navigate  |  Enter Select  |  Q Back",
    items: SCHEDULE_MENU,
    subtitle: "Automate full and quick backups with launchd",
    title: "Schedule"
  });
}

async function promptSettingsMenu() {
  return promptScreen({
    footer: "↑↓ Navigate  |  Enter Select  |  Q Back",
    items: SETTINGS_MENU,
    subtitle: "Configure storage, repositories, and backup behavior",
    title: "Settings"
  });
}

async function promptRepositorySettingsMenu(paths) {
  return promptScreen({
    footer: "↑↓ Navigate  |  Enter Select  |  Q Back",
    items: REPOSITORY_MENU,
    subtitle: `${paths.length} backup path${paths.length === 1 ? "" : "s"} configured`,
    title: "Repositories"
  });
}

async function promptLogsMenu(logs) {
  return promptScreen({
    footer: "↑↓ Navigate  |  Enter Select  |  Q Back",
    items: buildLogsMenu(logs),
    subtitle: "Inspect recent backup logs",
    title: "Logs"
  });
}

async function promptFullScheduleConfig(current = {}) {
  const time = await askInput({
    message: "Daily full backup time (HH:MM)",
    initial: current.time || "02:00",
    required: true,
    validate(value) {
      return /^\d{2}:\d{2}$/.test(String(value)) || "Use HH:MM format.";
    }
  });

  return { time };
}

async function promptQuickScheduleConfig(current = {}) {
  const intervalMinutes = await askInput({
    message: "Quick backup interval in minutes",
    initial: String(current.intervalMinutes || 60),
    required: true,
    validate(value) {
      return Number(value) > 0 || "Interval must be greater than zero.";
    }
  });

  return {
    intervalMinutes: Number(intervalMinutes)
  };
}

module.exports = {
  promptFullScheduleConfig,
  promptLogsMenu,
  promptMainMenu,
  promptQuickScheduleConfig,
  promptRepositorySettingsMenu,
  promptScheduleMenu,
  promptSettingsMenu
};
