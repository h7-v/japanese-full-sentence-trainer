const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VERSION_FILE = path.join(ROOT, "version.json");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function readAppVersion() {
  const payload = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
  const version = String(payload.version || "").trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error("version.json must contain a version using x.x.x format.");
  }
  return version;
}

module.exports = {
  VERSION_FILE,
  VERSION_PATTERN,
  readAppVersion
};
