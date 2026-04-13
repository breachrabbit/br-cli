const { spawn, spawnSync } = require("child_process");
const { RBError } = require("./errors");

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function runCommand(command, args = [], options = {}) {
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });

  const response = {
    command,
    args,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
    signal: result.signal
  };

  if (result.error) {
    if (options.allowFailure) {
      response.error = result.error;
      return response;
    }

    throw new RBError(
      `Failed to start command: ${formatCommand(command, args)} (${result.error.message})`,
      { code: "COMMAND_START_FAILED" }
    );
  }

  if (response.status !== 0 && !options.allowFailure) {
    const detail = [response.stdout.trim(), response.stderr.trim()].filter(Boolean).join("\n");
    throw new RBError(
      `Command failed: ${formatCommand(command, args)}${detail ? `\n${detail}` : ""}`,
      { code: "COMMAND_FAILED" }
    );
  }

  return response;
}

function runCommandAsync(command, args = [], options = {}) {
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: "pipe"
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.onStdout) {
        options.onStdout(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.onStderr) {
        options.onStderr(text);
      }
    });

    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({
          command,
          args,
          stdout,
          stderr,
          status: 1,
          signal: null,
          error
        });
        return;
      }

      reject(
        new RBError(
          `Failed to start command: ${formatCommand(command, args)} (${error.message})`,
          { code: "COMMAND_START_FAILED" }
        )
      );
    });

    child.on("close", (status, signal) => {
      const response = {
        command,
        args,
        stdout,
        stderr,
        status,
        signal
      };

      if (status !== 0 && !options.allowFailure) {
        const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        reject(
          new RBError(
            `Command failed: ${formatCommand(command, args)}${detail ? `\n${detail}` : ""}`,
            { code: "COMMAND_FAILED" }
          )
        );
        return;
      }

      resolve(response);
    });
  });
}

module.exports = {
  formatCommand,
  runCommand,
  runCommandAsync
};
