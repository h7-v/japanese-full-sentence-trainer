const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { extractZip } = require("./zip-utils");

const PRESERVED_NAMES = new Set([
  ".env",
  "cache",
  "startup-error.log",
  "updates"
]);

main().catch((error) => {
  try {
    const targetDir = getArg("--target") || process.cwd();
    fs.appendFileSync(
      path.join(targetDir, "update-error.log"),
      `[${new Date().toISOString()}]\n${error?.stack || error?.message || String(error)}\n\n`
    );
  } catch {
    // Keep the original error visible if logging fails.
  }
  console.error(error);
  process.exit(1);
});

async function main() {
  const zipPath = requireArg("--zip");
  const targetDir = path.resolve(requireArg("--target"));
  const restart = requireArg("--restart");
  const waitPid = Number(getArg("--wait-pid") || 0);

  if (waitPid) {
    await waitForProcessExit(waitPid, 30000);
  }

  const updatesDir = path.join(targetDir, "updates");
  const extractDir = path.join(updatesDir, `extract-${Date.now()}`);
  const backupDir = path.join(updatesDir, `backup-${Date.now()}`);

  fs.mkdirSync(updatesDir, { recursive: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  extractZip(zipPath, extractDir);
  const releaseRoot = findReleaseRoot(extractDir);
  if (!releaseRoot) {
    throw new Error("Could not find a release folder in the downloaded update.");
  }

  backupCurrentInstall(targetDir, backupDir);
  copyReleaseOverInstall(releaseRoot, targetDir);
  restoreExecutablePermissions(targetDir, restart);
  restartApp(targetDir, restart);
}

function backupCurrentInstall(targetDir, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  for (const itemName of fs.readdirSync(targetDir)) {
    if (itemName === "updates") continue;
    const source = path.join(targetDir, itemName);
    const target = path.join(backupDir, itemName);
    fs.cpSync(source, target, { recursive: true });
  }
}

function copyReleaseOverInstall(releaseRoot, targetDir) {
  for (const itemName of fs.readdirSync(targetDir)) {
    if (PRESERVED_NAMES.has(itemName)) continue;
    fs.rmSync(path.join(targetDir, itemName), { recursive: true, force: true });
  }

  for (const itemName of fs.readdirSync(releaseRoot)) {
    if (PRESERVED_NAMES.has(itemName)) continue;
    const source = path.join(releaseRoot, itemName);
    const target = path.join(targetDir, itemName);
    fs.cpSync(source, target, { recursive: true });
  }

  const cacheDir = path.join(targetDir, "cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

function findReleaseRoot(extractDir) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  const direct = entries.some((entry) => entry.name === "public" || entry.name === "START-HERE.txt");
  if (direct) return extractDir;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(extractDir, entry.name);
    if (
      fs.existsSync(path.join(candidate, "public")) ||
      fs.existsSync(path.join(candidate, "START-HERE.txt"))
    ) {
      return candidate;
    }
  }
  return null;
}

function restartApp(targetDir, restart) {
  const restartPath = path.join(targetDir, restart);
  const isWindowsCommand = process.platform === "win32" && restart.toLowerCase().endsWith(".cmd");
  const command = isWindowsCommand ? "cmd.exe" : restartPath;
  const args = isWindowsCommand ? ["/c", restartPath] : [];
  const child = spawn(command, args, {
    cwd: targetDir,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function restoreExecutablePermissions(targetDir, restart) {
  if (process.platform === "win32") return;
  const executableNames = [
    restart,
    "Japanese Full Sentence Trainer",
    "Japanese Full Sentence Trainer Updater",
    "japanese-full-sentence-trainer",
    "japanese-full-sentence-trainer-updater"
  ];
  for (const name of executableNames) {
    const executablePath = path.join(targetDir, name);
    if (fs.existsSync(executablePath)) {
      fs.chmodSync(executablePath, 0o755);
    }
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) return;
    await delay(500);
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) {
    throw new Error(`Missing required updater argument: ${name}`);
  }
  return value;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}
