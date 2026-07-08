const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createZipFromDirectory } = require("./zip-utils");
const { VERSION_PATTERN, readAppVersion } = require("./version");

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const PUBLIC_DIR = path.join(ROOT, "public");
const MIN_BUILD_NODE_MAJOR = 22;
const RELEASE_NAME_PREFIX = "japanese-fst-";

const currentNodeMajor = Number(process.versions.node.split(".")[0]);
if (currentNodeMajor < MIN_BUILD_NODE_MAJOR) {
  console.error(`Building releases requires Node.js ${MIN_BUILD_NODE_MAJOR} or newer.`);
  console.error(`You are currently using Node.js ${process.versions.node}.`);
  console.error("");
  console.error("Install/use a newer Node version, then run this command again.");
  console.error("For example, with nvm:");
  console.error("");
  console.error("  nvm install 22");
  console.error("  nvm use 22");
  console.error("  npm install");
  console.error("  npm run package:win-x64 -- 0.2.2");
  process.exit(1);
}

const TARGETS = {
  "macos-arm64": {
    pkgTarget: "node22-macos-arm64",
    executableName: "Japanese Full Sentence Trainer",
    updaterName: "Japanese Full Sentence Trainer Updater"
  },
  "macos-x64": {
    pkgTarget: "node22-macos-x64",
    executableName: "Japanese Full Sentence Trainer",
    updaterName: "Japanese Full Sentence Trainer Updater"
  },
  "win-x64": {
    pkgTarget: "node22-win-x64",
    executableName: "Japanese Full Sentence Trainer.exe",
    updaterName: "Japanese Full Sentence Trainer Updater.exe"
  },
  "linux-x64": {
    pkgTarget: "node22-linux-x64",
    executableName: "japanese-full-sentence-trainer",
    updaterName: "japanese-full-sentence-trainer-updater"
  }
};

const requestedTarget = process.argv[2];
const releaseVersion = process.argv[3];
if (!requestedTarget || (!TARGETS[requestedTarget] && requestedTarget !== "all")) {
  console.error(`Usage: node scripts/package-release.js ${Object.keys(TARGETS).join("|")}|all x.x.x`);
  console.error("");
  console.error("Example:");
  console.error("  npm run package:win-x64 -- 0.2.2");
  process.exit(1);
}

if (!VERSION_PATTERN.test(releaseVersion || "")) {
  console.error("A release version is required and must use x.x.x format.");
  console.error("");
  console.error("Example:");
  console.error("  npm run package:all -- 0.2.2");
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const appVersion = readAppVersion();
if (releaseVersion !== appVersion) {
  console.error(`Release version ${releaseVersion} does not match version.json version ${appVersion}.`);
  console.error("");
  console.error(`Use ${appVersion}, or update version.json before building.`);
  process.exit(1);
}

if (packageJson.version !== appVersion) {
  console.error(`package.json version ${packageJson.version} does not match version.json version ${appVersion}.`);
  console.error("");
  console.error("Run npm run version:set -- x.x.x to sync versioned files.");
  process.exit(1);
}

const targets = requestedTarget === "all"
  ? Object.keys(TARGETS)
  : [requestedTarget];

for (const targetName of targets) {
  buildRelease(targetName, TARGETS[targetName], releaseVersion);
}

function buildRelease(targetName, target, version) {
  const releaseName = `${RELEASE_NAME_PREFIX}v${version}-${targetName}`;
  const releaseDir = path.join(DIST_DIR, releaseName);
  const executablePath = path.join(releaseDir, target.executableName);
  const updaterPath = path.join(releaseDir, target.updaterName);
  const zipPath = path.join(DIST_DIR, `${releaseName}.zip`);

  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  runPkg(".", target.pkgTarget, executablePath);
  runPkg("scripts/updater.js", target.pkgTarget, updaterPath);
  copyReleaseFiles(releaseDir);
  if (targetName.startsWith("win-")) {
    writeWindowsLauncher(releaseDir, target.executableName);
  }
  writeReleaseNotes(releaseDir, target.executableName, target.updaterName, targetName, version);

  if (process.platform !== "win32") {
    fs.chmodSync(executablePath, 0o755);
    fs.chmodSync(updaterPath, 0o755);
  }

  createZipFromDirectory(releaseDir, zipPath);
  console.log(`Built ${releaseName}: ${releaseDir}`);
  console.log(`Zipped ${releaseName}: ${zipPath}`);
}

function runPkg(input, pkgTarget, executablePath) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const localPkg = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "pkg.cmd" : "pkg");
  const hasLocalPkg = fs.existsSync(localPkg);
  const command = hasLocalPkg ? localPkg : npx;
  const args = [
    input,
    "--target",
    pkgTarget,
    "--public",
    "--public-packages",
    "*",
    "--no-bytecode",
    "--output",
    executablePath
  ];
  const result = spawnSync(command, hasLocalPkg ? args : ["--yes", "@yao-pkg/pkg", ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`
    },
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function copyReleaseFiles(releaseDir) {
  fs.cpSync(PUBLIC_DIR, path.join(releaseDir, "public"), {
    recursive: true,
    filter: (source) => path.basename(source) !== ".DS_Store"
  });
  fs.mkdirSync(path.join(releaseDir, "cache"), { recursive: true });

  copyIfExists(".env.example", releaseDir);
  copyIfExists("README.md", releaseDir);
  copyIfExists("bunpro-trainer-commands.md", releaseDir);
}

function copyIfExists(fileName, releaseDir) {
  const source = path.join(ROOT, fileName);
  if (!fs.existsSync(source)) return;
  fs.copyFileSync(source, path.join(releaseDir, fileName));
}

function writeWindowsLauncher(releaseDir, executableName) {
  const launcher = [
    "@echo off",
    "cd /d \"%~dp0\"",
    `\"${executableName}\"`,
    "set EXIT_CODE=%ERRORLEVEL%",
    "if not \"%EXIT_CODE%\"==\"0\" (",
    "  echo.",
    "  echo Japanese Full Sentence Trainer exited with code %EXIT_CODE%.",
    "  if exist startup-error.log (",
    "    echo.",
    "    echo startup-error.log:",
    "    type startup-error.log",
    "  )",
    "  echo.",
    "  pause",
    ")"
  ].join("\r\n");

  fs.writeFileSync(path.join(releaseDir, "Start Japanese Full Sentence Trainer.cmd"), `${launcher}\r\n`);
}

function writeReleaseNotes(releaseDir, executableName, updaterName, targetName, version) {
  const windowsNote = targetName.startsWith("win-")
    ? [
        "On Windows, you can double-click Start Japanese Full Sentence Trainer.cmd instead of the exe.",
        "That launcher keeps the window open if startup fails and shows startup-error.log."
      ]
    : [];
  const note = [
    "Japanese Full Sentence Trainer",
    `Version ${version}`,
    "",
    "Double-click the app executable to start the local trainer.",
    "It will open your default browser automatically.",
    "",
    `Executable: ${executableName}`,
    `Updater: ${updaterName}`,
    "Settings file: .env",
    "Example settings: .env.example",
    "Local import cache: cache/",
    "Downloaded updates and backups: updates/",
    "Startup error log: startup-error.log",
    "",
    "Before using a hosted LLM provider, check its current age, audience, region, billing, privacy, and data-use terms.",
    "",
    ...windowsNote,
    ...(windowsNote.length ? [""] : []),
    "Keep this folder together. The executable expects public/, cache/, and the updater to stay next to it.",
    "You can edit .env manually, or save keys and settings from Sources & Settings in the browser UI.",
    "Automatic updates preserve .env, cache/, and update backups in updates/.",
    "",
    "To stop the app, close the terminal or command window that opened with the executable."
  ].join("\n");

  fs.writeFileSync(path.join(releaseDir, "START-HERE.txt"), `${note}\n`);
}
