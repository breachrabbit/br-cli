const { MultiSelect, Select } = require("enquirer");
const readline = require("readline");

function ensureInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive mode requires a TTY terminal.");
  }
}

function requiredValidator(message) {
  return (value) => {
    if (String(value || "").trim()) {
      return true;
    }
    return `${message} is required.`;
  };
}

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function askLine(promptText) {
  const rl = createInterface();
  return new Promise((resolve) => {
    rl.question(promptText, (value) => {
      rl.close();
      resolve(String(value || ""));
    });
  });
}

async function askInput({ message, initial = "", required = false, validate }) {
  ensureInteractive();
  const validator = validate || (required ? requiredValidator(message) : undefined);

  while (true) {
    const suffix = initial ? ` [${initial}]` : "";
    const rawValue = await askLine(`${message}${suffix}: `);
    const value = rawValue.trim() || String(initial || "").trim();

    if (!validator) {
      return value;
    }

    const validation = validator(value);
    if (validation === true) {
      return value;
    }

    process.stdout.write(`${validation}\n`);
  }
}

async function askSecret({ message, required = false }) {
  ensureInteractive();
  const validator = required ? requiredValidator(message) : undefined;

  while (true) {
    process.stdout.write(`${message}: `);
    const value = await new Promise((resolve, reject) => {
      let buffer = "";
      const input = process.stdin;
      const output = process.stdout;
      const wasRaw = Boolean(input.isRaw);
      const wasPaused = input.isPaused ? input.isPaused() : false;

      function cleanup() {
        input.removeListener("data", onData);
        if (typeof input.setRawMode === "function") {
          input.setRawMode(wasRaw);
        }
        if (!wasPaused && typeof input.resume === "function") {
          input.resume();
        }
        if (wasPaused && typeof input.pause === "function") {
          input.pause();
        }
      }

      function finish(result) {
        cleanup();
        output.write("\n");
        resolve(result);
      }

      function fail(error) {
        cleanup();
        output.write("\n");
        reject(error);
      }

      function onData(chunk) {
        const key = chunk.toString("utf8");

        if (key === "\u0003") {
          fail(new Error("Prompt cancelled."));
          return;
        }

        if (key === "\r" || key === "\n") {
          finish(buffer.trim());
          return;
        }

        if (key === "\u007f") {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
          }
          return;
        }

        if (key >= " " && key !== "\u001b") {
          buffer += key;
        }
      }

      if (typeof input.setRawMode === "function") {
        input.setRawMode(true);
      }
      if (typeof input.resume === "function") {
        input.resume();
      }
      input.on("data", onData);
    });

    if (!validator) {
      return value;
    }

    const validation = validator(value);
    if (validation === true) {
      return value;
    }

    process.stdout.write(`${validation}\n`);
  }
}

async function askConfirm({ message, initial = false }) {
  ensureInteractive();
  const suffix = initial ? "[Y/n]" : "[y/N]";
  const answer = (await askLine(`${message} ${suffix}: `)).trim().toLowerCase();

  if (!answer) {
    return Boolean(initial);
  }

  if (["y", "yes"].includes(answer)) {
    return true;
  }

  if (["n", "no"].includes(answer)) {
    return false;
  }

  return Boolean(initial);
}

async function askSelect({ message, choices, initial }) {
  ensureInteractive();
  const prompt = new Select({
    message,
    initial,
    prefix: "",
    separator: "",
    choices: choices.map((choice) =>
      typeof choice === "string"
        ? { name: choice, message: choice }
        : {
            name: choice.value,
            message: choice.label,
            hint: choice.hint
          }
    )
  });
  return prompt.run();
}

async function askMultiSelect({ message, hint, choices }) {
  ensureInteractive();
  const prompt = new MultiSelect({
    message,
    hint,
    instructions: false,
    prefix: "",
    separator: "",
    choices: choices.map((choice) => ({
      name: choice.value,
      message: choice.label,
      hint: choice.meta,
      enabled: Boolean(choice.selected)
    }))
  });
  return prompt.run();
}

async function waitForEnter(message = "Press Enter to return to menu") {
  ensureInteractive();
  await askLine(`${message}\n`);
}

module.exports = {
  askConfirm,
  askInput,
  askMultiSelect,
  askSecret,
  askSelect,
  ensureInteractive,
  waitForEnter
};
