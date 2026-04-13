const chalk = require("chalk").default;

function logoText() {
  return [
    chalk.green(" ____    ____      _          _               "),
    chalk.green("| __ )  |  _ \\    | |    __ _| |__   ___     "),
    chalk.green("|  _ \\  | |_) |   | |   / _` | '_ \\ / __|    "),
    chalk.green("| |_) | |  _ <    | |__| (_| | |_) |\\__ \\    "),
    chalk.green("|____/  |_| \\_\\   |_____\\__,_|_.__/ |___/.   ")
  ].join("\n");
}

function clearScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
  }
}

function printBrand(_title = "BR Labs", subtitle = "Backup & recovery CLI for Breach Rabbit environments") {
  process.stdout.write("\n");
  process.stdout.write(`${logoText()}\n`);
  process.stdout.write("\n");
  process.stdout.write(chalk.blue("https://github.com/breachrabbit/br-cli\n"));
  if (subtitle) {
    process.stdout.write(chalk.green(`${subtitle}\n`));
  }
  process.stdout.write("\n");
}

function printSection(title) {
  process.stdout.write(chalk.bold.white(`${title}\n`));
}

module.exports = {
  clearScreen,
  logoText,
  printBrand,
  printSection
};
