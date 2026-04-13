const https = require("https");
const path = require("path");
const { ensureDir, pathExists, readJson, writeJson } = require("./fs-utils");
const { STATE_DIR } = require("../config/constants");
const output = require("../ui/output");

const packageJson = require("../package.json");

const UPDATE_CHECK_PATH = path.join(STATE_DIR, "update-check.json");
const UPDATE_URL = "https://raw.githubusercontent.com/breachrabbit/br-cli/main/package.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function compareVersions(left, right) {
  const leftParts = String(left).split(".").map((part) => Number(part) || 0);
  const rightParts = String(right).split(".").map((part) => Number(part) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function readCache() {
  if (!pathExists(UPDATE_CHECK_PATH)) {
    return null;
  }
  return readJson(UPDATE_CHECK_PATH, null);
}

function writeCache(payload) {
  ensureDir(STATE_DIR);
  writeJson(UPDATE_CHECK_PATH, payload);
}

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      UPDATE_URL,
      {
        headers: {
          "User-Agent": "br-cli"
        },
        timeout: 2500
      },
      (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });

        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Update check failed with status ${response.statusCode}`));
            return;
          }

          try {
            const parsed = JSON.parse(body);
            resolve(parsed.version);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Update check timed out"));
    });

    request.on("error", reject);
  });
}

async function getUpdateInfo(options = {}) {
  const currentVersion = packageJson.version;
  const cached = readCache();
  const now = Date.now();

  if (!options.force && cached && cached.checkedAt && now - cached.checkedAt < CACHE_TTL_MS) {
    return {
      currentVersion,
      latestVersion: cached.latestVersion,
      updateAvailable: compareVersions(currentVersion, cached.latestVersion) < 0
    };
  }

  try {
    const latestVersion = await fetchLatestVersion();
    writeCache({
      checkedAt: now,
      latestVersion
    });
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0
    };
  } catch (error) {
    output.debug(`Update check skipped: ${error.message}`);
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false
    };
  }
}

async function getUpdateNotice() {
  const info = await getUpdateInfo();
  if (!info.updateAvailable) {
    return "";
  }

  return `Update available: ${info.currentVersion} → ${info.latestVersion}\nRun: br update`;
}

async function printUpdateStatus() {
  const info = await getUpdateInfo({ force: true });

  output.header("update");
  output.printKeyValue("Current", info.currentVersion);
  output.printKeyValue("Latest", info.latestVersion);

  if (info.updateAvailable) {
    output.warn("A newer version is available.");
    output.print("Run the installer again to update:");
    output.print("curl -fsSL https://raw.githubusercontent.com/breachrabbit/br-cli/main/installer/install.sh | bash");
    return;
  }

  output.success("You are already using the latest version.");
}

module.exports = {
  getUpdateInfo,
  getUpdateNotice,
  printUpdateStatus
};
