const chalk = require("chalk").default;
const { clearScreen, printBrand, printSection } = require("./layout");

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

function renderPicker({ title, hint, items, selectedIndex }) {
  clearScreen();
  printBrand("BR Labs", "Backup & recovery CLI for Breach Rabbit environments");
  printSection(title);
  if (hint) {
    process.stdout.write(`${chalk.gray(hint)}\n\n`);
  }

  items.forEach((item, index) => {
    const active = index === selectedIndex;
    const pointer = active ? chalk.cyan("▸") : " ";
    const marker = item.selected ? chalk.green("✔") : chalk.gray("○");
    const label = active ? chalk.cyan(item.label) : chalk.white(item.label);
    process.stdout.write(`${pointer} ${marker} ${label}\n`);
  });

  process.stdout.write(`\n${chalk.gray("↑↓ Navigate  |  Space Toggle  |  Enter Confirm  |  Q Cancel")}\n`);
}

async function promptMultiSelect({ input = process.stdin, output = process.stdout, title, hint, items }) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Interactive repository selection requires a TTY terminal.");
  }

  const state = items.map((item) => ({
    ...item,
    selected: Boolean(item.selected)
  }));
  let selectedIndex = 0;

  if (typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  if (typeof input.resume === "function") {
    input.resume();
  }
  output.write("\x1b[?25l");

  try {
    renderPicker({ title, hint, items: state, selectedIndex });

    while (true) {
      const key = await readKey(input);

      if (key === "\u0003" || key.toLowerCase() === "q") {
        return [];
      }

      if (key === "\r" || key === "\n") {
        return state.filter((item) => item.selected).map((item) => item.value);
      }

      if (key === " ") {
        state[selectedIndex].selected = !state[selectedIndex].selected;
        renderPicker({ title, hint, items: state, selectedIndex });
        continue;
      }

      if (key === "\u001b[A") {
        selectedIndex = (selectedIndex - 1 + state.length) % state.length;
        renderPicker({ title, hint, items: state, selectedIndex });
        continue;
      }

      if (key === "\u001b[B") {
        selectedIndex = (selectedIndex + 1) % state.length;
        renderPicker({ title, hint, items: state, selectedIndex });
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

module.exports = {
  promptMultiSelect
};
