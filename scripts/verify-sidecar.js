#!/usr/bin/env node
"use strict";

/**
 * Verify that the bundled computer sidecar matches sidecar.lock.json.
 * Checks existence, sha256, executable bit, and --version output.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const lockPath = path.join(root, "sidecar.lock.json");
const platformKey = `${process.platform}-${process.arch}`;

if (!fs.existsSync(lockPath)) {
  console.error("[verify:sidecar] sidecar.lock.json is missing");
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const entry = lock.binaries?.[platformKey];
if (!entry) {
  console.log(`[verify:sidecar] no binary pinned for ${platformKey}; skipping`);
  process.exit(0);
}

const binaryPath = path.join(root, entry.path);
if (!fs.existsSync(binaryPath)) {
  console.error(`[verify:sidecar] binary is missing: ${entry.path}`);
  process.exit(1);
}

if (process.platform !== "win32") {
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch {
    console.error(`[verify:sidecar] binary is not executable: ${entry.path}`);
    process.exit(1);
  }
}

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(binaryPath)).digest("hex");
if (sha256 !== entry.sha256) {
  console.error(
    `[verify:sidecar] sha256 mismatch for ${entry.path}\n  expected ${entry.sha256}\n  actual   ${sha256}`
  );
  process.exit(1);
}

let version;
try {
  version = execFileSync(binaryPath, ["--version"], { encoding: "utf8" }).trim();
} catch (error) {
  console.error(`[verify:sidecar] failed to run ${entry.path} --version: ${error.message}`);
  process.exit(1);
}

const expectedVersion = String(lock.tag || "").replace(/^v/, "");
if (expectedVersion && version !== expectedVersion) {
  console.error(
    `[verify:sidecar] version mismatch: lock=${expectedVersion} binary=${version}`
  );
  process.exit(1);
}

console.log(`[verify:sidecar] ok ${platformKey} version=${version} sha256=${sha256}`);
