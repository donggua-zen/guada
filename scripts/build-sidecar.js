#!/usr/bin/env node
"use strict";

/**
 * Build the local computer sidecar and copy the release binary into
 * build-resources/computer-sidecar. The sidecar source lives in the
 * guada-computer repository next to the main project.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sidecarRoot = path.join(root, "guada-computer");
const outputDir = path.join(root, "build-resources", "computer-sidecar");
const lockPath = path.join(root, "sidecar.lock.json");

if (!fs.existsSync(sidecarRoot)) {
  console.error(
    `[build:sidecar] ${sidecarRoot} does not exist. Clone the guada-computer repository first.`
  );
  process.exit(1);
}

const binaryName = process.platform === "win32" ? "guada-computer.exe" : "guada-computer";
const releasePath = path.join(sidecarRoot, "target", "release", binaryName);

if (process.platform === "win32") {
  execFileSync("cmd.exe", ["/d", "/s", "/c", "build.bat", "build", "--release"], {
    cwd: sidecarRoot,
    stdio: "inherit",
  });
} else {
  execFileSync("cargo", ["build", "--release"], {
    cwd: sidecarRoot,
    stdio: "inherit",
  });
}

if (!fs.existsSync(releasePath)) {
  console.error(`[build:sidecar] expected binary not found: ${releasePath}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
const targetPath = path.join(outputDir, binaryName);
fs.copyFileSync(releasePath, targetPath);
if (process.platform !== "win32") {
  fs.chmodSync(targetPath, 0o755);
}

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
const versionOutput = execFileSync(targetPath, ["--version"], { encoding: "utf8" }).trim();
const platformKey = `${process.platform}-${process.arch}`;

let lock = {};
if (fs.existsSync(lockPath)) {
  lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
}
lock.repo = lock.repo || "";
lock.tag = `v${versionOutput}`;
lock.commit = lock.commit || "";
lock.protocol = lock.protocol || "1";
lock.binaries = lock.binaries || {};
const relativePath = path.relative(root, targetPath).split(path.sep).join("/");
lock.binaries[platformKey] = { path: relativePath, sha256 };
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

console.log(`[build:sidecar] ${platformKey} -> ${relativePath}`);
console.log(`[build:sidecar] version=${versionOutput} sha256=${sha256}`);
