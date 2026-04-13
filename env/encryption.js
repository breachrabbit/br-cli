const fs = require("fs");
const path = require("path");
const os = require("os");
const { runCommand } = require("../core/process");

function resolvePassphrase(encryptionConfig) {
  if (!encryptionConfig || !encryptionConfig.enabled) {
    return null;
  }

  if (!encryptionConfig.passphraseCommand) {
    return null;
  }

  const shell = process.env.SHELL || "/bin/zsh";
  const result = runCommand(shell, ["-lc", encryptionConfig.passphraseCommand], {
    allowFailure: true
  });

  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value || null;
}

function encryptFile(inputPath, outputPath, encryptionConfig) {
  const passphrase = resolvePassphrase(encryptionConfig);
  if (!passphrase) {
    return null;
  }

  runCommand(
    "openssl",
    [
      "enc",
      "-aes-256-cbc",
      "-pbkdf2",
      "-salt",
      "-in",
      inputPath,
      "-out",
      outputPath,
      "-pass",
      "env:RB_ENV_PASSPHRASE"
    ],
    { env: { RB_ENV_PASSPHRASE: passphrase } }
  );

  return outputPath;
}

function decryptFile(inputPath, encryptionConfig) {
  const passphrase = resolvePassphrase(encryptionConfig);
  if (!passphrase) {
    return null;
  }

  const outputPath = path.join(os.tmpdir(), `${path.basename(inputPath)}.tar.gz`);
  runCommand(
    "openssl",
    [
      "enc",
      "-d",
      "-aes-256-cbc",
      "-pbkdf2",
      "-in",
      inputPath,
      "-out",
      outputPath,
      "-pass",
      "env:RB_ENV_PASSPHRASE"
    ],
    { env: { RB_ENV_PASSPHRASE: passphrase } }
  );

  return outputPath;
}

module.exports = {
  decryptFile,
  encryptFile,
  resolvePassphrase
};
