const output = require("./output");

class Spinner {
  constructor(label) {
    this.label = label;
    this.timer = null;
    this.frame = 0;
    this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.enabled = Boolean(process.stdout.isTTY);
  }

  start() {
    if (!this.enabled) {
      output.info(this.label);
      return;
    }

    this.timer = setInterval(() => {
      const frame = this.frames[this.frame % this.frames.length];
      this.frame += 1;
      process.stdout.write(`\r${frame} ${this.label}`);
    }, 80);
  }

  stop(finalLabel) {
    if (!this.enabled) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    process.stdout.write(`\r${finalLabel}\n`);
  }

  succeed(message) {
    this.stop(`✔ ${message || this.label}`);
  }

  fail(message) {
    this.stop(`✖ ${message || this.label}`);
  }
}

function withSpinner(label, fn) {
  const spinner = new Spinner(label);
  spinner.start();

  return Promise.resolve()
    .then(fn)
    .then((result) => {
      spinner.succeed(label);
      return result;
    })
    .catch((err) => {
      spinner.fail(label);
      throw err;
    });
}

module.exports = {
  Spinner,
  withSpinner
};
