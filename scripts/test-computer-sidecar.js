#!/usr/bin/env node
"use strict";

/**
 * Protocol smoke test for the bundled computer sidecar.
 * Runs `ping` and `shutdown` over stdio. Screen capture and UIA observation
 * are covered by manual acceptance because they need a live desktop.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const binary = path.join(root, "build-resources", "computer-sidecar", "guada-computer.exe");

test("computer sidecar responds to ping and shutdown", { timeout: 20000 }, async () => {
  if (process.platform !== "win32") {
    return; // Windows-only in this release.
  }
  assert.ok(fs.existsSync(binary), `sidecar binary is missing: ${binary}`);

  const child = spawn(binary, ["--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 0;

  child.stderr.on("data", (chunk) => process.stderr.write(`[sidecar] ${chunk}`));
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const entry = pending.get(String(message.id));
    if (!entry) return;
    pending.delete(String(message.id));
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  function request(method, params = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  try {
    const ping = await request("ping");
    assert.equal(ping.protocol, "1");
    assert.match(String(ping.version), /^\d+\.\d+\.\d+/);
    assert.equal(ping.capabilities.screenshot, true);

    await request("shutdown");
    assert.equal(await waitForExit(child, 5000), true, "sidecar did not exit after shutdown");
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
