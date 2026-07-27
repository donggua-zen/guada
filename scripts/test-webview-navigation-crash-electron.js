const { app, BrowserWindow, ipcMain } = require("electron");
const os = require("node:os");
const path = require("node:path");

const scenario = process.argv[2];
const targetUrl = process.argv[3];
const variant = process.env.WEBVIEW_TEST_VARIANT || process.argv[4] || "full";
process.stderr.write(`FIXTURE_BOOT ${JSON.stringify({ scenario, targetUrl, variant, pid: process.pid })}\n`);
const supportedScenarios = new Set(["connection-refused", "chrome-error"]);

if (!supportedScenarios.has(scenario) || !targetUrl) {
  console.error("Usage: electron test-webview-navigation-crash-electron.js <connection-refused|chrome-error> <url>");
  process.exit(2);
}

app.setPath("userData", path.join(os.tmpdir(), `guada-webview-crash-${scenario}-${process.pid}`));

let mainWindow;
let manager;
let finishing = false;
let abnormalProcessExit = false;
let hardTimer;
const events = [];

function record(type, details = {}) {
  const event = { type, at: Date.now(), ...details };
  events.push(event);
  console.log("WEBVIEW_CRASH_EVENT=" + JSON.stringify(event));
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

async function finish(code, reason) {
  if (finishing) return;
  finishing = true;
  clearTimeout(hardTimer);
  record("fixture-finish", { code, reason, abnormalProcessExit, eventCount: events.length });
  try {
    await manager?.closeAllWindows();
  } catch (error) {
    record("fixture-cleanup-error", serializeError(error));
  }
  setTimeout(() => app.exit(code), 100);
}

process.on("uncaughtException", (error) => {
  record("uncaught-exception", serializeError(error));
  finish(1, "uncaught-exception");
});
process.on("unhandledRejection", (reason) => {
  record("unhandled-rejection", serializeError(reason));
  finish(1, "unhandled-rejection");
});

app.on("child-process-gone", (_event, details) => {
  const abnormalReasons = new Set(["abnormal-exit", "killed", "crashed", "oom", "launch-failed", "integrity-failure"]);
  if (abnormalReasons.has(details.reason)) abnormalProcessExit = true;
  record("child-process-gone", details);
  if (abnormalProcessExit) finish(1, "child-process-gone");
});
app.on("before-quit", () => record("before-quit"));
app.on("will-quit", () => record("will-quit"));

async function run() {
  console.error("FIXTURE_RUN_START");
  const { BrowserWebviewManager } = require("../electron/dist/browser-tab-manager.js");
  console.error("FIXTURE_MANAGER_LOADED");
  const { BrowserAutomationService } = require("../electron/dist/browser-automation-service.js");
  console.error("FIXTURE_SERVICE_LOADED");

  record("fixture-start", {
    scenario,
    targetUrl,
    variant,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  });

  ipcMain.handle("browser:get-user-scripts", () => ({ success: true, scripts: [] }));
  ipcMain.handle("browser:save-to-file", () => ({ success: false, error: "disabled in test" }));
  ipcMain.handle("browser:read-from-file", () => ({ success: false, error: "disabled in test" }));
  ipcMain.handle("browser:get-cookies", async (event, filter) => ({
    success: true,
    cookies: await event.sender.session.cookies.get(filter || {}),
  }));
  ipcMain.handle("browser:set-cookie", async (event, cookie) => {
    await event.sender.session.cookies.set(cookie);
    return { success: true };
  });
  ipcMain.handle("browser:remove-cookie", async (event, data) => {
    await event.sender.session.cookies.remove(data.url, data.name);
    return { success: true };
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "test-webview-host-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    const expectedCleanExit = finishing && details.reason === "clean-exit";
    if (!expectedCleanExit) abnormalProcessExit = true;
    record("host-render-process-gone", { ...details, expectedCleanExit });
    if (!expectedCleanExit) finish(1, "host-render-process-gone");
  });
  mainWindow.on("closed", () => {
    record("main-window-closed", { finishing });
    if (!finishing) finish(1, "main-window-closed-unexpectedly");
  });

  manager = new BrowserWebviewManager();
  if (variant === "no-preload") {
    manager.getBrowserPreloadUrl = () => "";
  }
  if (variant === "no-antidetect") {
    manager.injectAntiDetectionScript = () => {};
  }
  manager.attachMainWindow(mainWindow);
  mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
    record("fixture-observed-attach", { webContentsId: guest.id });
    if (variant === "no-console-listener") {
      guest.removeAllListeners("console-message");
    }
    guest.on("did-start-loading", () => record("fixture-observed-start", { url: guest.getURL() }));
    guest.on("did-stop-loading", () => record("fixture-observed-stop", { url: guest.getURL() }));
    guest.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      record("fixture-observed-failure", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
        currentUrl: guest.getURL(),
      });
    });
    guest.on("render-process-gone", (_goneEvent, details) => {
      const expectedCleanExit = finishing && details.reason === "clean-exit";
      if (!expectedCleanExit) abnormalProcessExit = true;
      record("fixture-guest-render-process-gone", { ...details, expectedCleanExit });
      if (!expectedCleanExit) finish(1, "guest-render-process-gone");
    });
  });

  await mainWindow.loadURL("data:text/html;charset=utf-8,<html><body></body></html>");

  const service = new BrowserAutomationService();
  service.initializeWindowManager(manager);
  let navigationError;
  try {
    await service.createWindow(targetUrl, { createdBy: "crash-test" });
  } catch (error) {
    navigationError = serializeError(error);
    record("automation-navigation-rejected", navigationError);
  }

  const windows = manager.getWindowList();
  record("post-navigation-state", {
    navigationError,
    mainWindowDestroyed: mainWindow.isDestroyed(),
    mainRendererDestroyed: mainWindow.webContents.isDestroyed(),
    windows,
  });

  hardTimer = setTimeout(() => finish(4, "fixture-timeout"), 15000);
  setTimeout(() => finish(abnormalProcessExit ? 1 : 0, "observation-complete"), 4000);
}

app.whenReady().then(run).catch((error) => {
  record("fixture-error", serializeError(error));
  finish(1, "fixture-error");
});
