const fs = require("fs");
const path = require("path");
const { VERSION_PATTERN, readAppVersion } = require("./version");

const ROOT = path.resolve(__dirname, "..");
const nextVersion = String(process.argv[2] || "").trim();

if (!VERSION_PATTERN.test(nextVersion)) {
  console.error("Usage: npm run version:set -- x.x.x");
  process.exit(1);
}

const previousVersion = readAppVersion();

writeJson("version.json", { version: nextVersion });

const packageJson = readJson("package.json");
packageJson.version = nextVersion;
writeJson("package.json", packageJson);

const packageLock = readJson("package-lock.json");
packageLock.version = nextVersion;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = nextVersion;
}
writeJson("package-lock.json", packageLock);

replaceReadmeVersion(previousVersion, nextVersion);

console.log(`Updated project version from ${previousVersion} to ${nextVersion}.`);

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, fileName), "utf8"));
}

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(ROOT, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function replaceReadmeVersion(previous, next) {
  const legacyPlaceholder = "__LEGACY_CACHE_APP_VERSION__";
  const filePath = path.join(ROOT, "README.md");
  const original = fs.readFileSync(filePath, "utf8");
  const protectedText = original.replace(/app version 0\.2\.2/g, `app version ${legacyPlaceholder}`);
  const updated = protectedText
    .split(previous).join(next)
    .replace(new RegExp(legacyPlaceholder, "g"), "0.2.2");
  fs.writeFileSync(filePath, updated);
}
