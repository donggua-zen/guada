#!/usr/bin/env node
"use strict";

/**
 * Electron-level integration smoke for the computer sidecar.
 * Run after `pnpm run build:electron-ts`:
 *   npx electron scripts/test-computer-sidecar-electron.js
 */

const { app } = require("electron");
const {
  ComputerSidecarClient,
} = require("../electron/dist/computer-sidecar-client");

app.whenReady().then(async () => {
  const client = new ComputerSidecarClient();
  let exitCode = 1;
  try {
    const status = await client.start();
    console.log("[test] status:", JSON.stringify(status));
    if (!status.available) {
      return;
    }

    const result = await client.test();
    console.log("[test] result:", JSON.stringify(result));
    exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error("[test] failed:", error);
  } finally {
    // Stop the child before exiting the Electron process; otherwise the child
    // can outlive the test and keep the binary locked on Windows.
    await client.stop();
    app.exit(exitCode);
  }
});
