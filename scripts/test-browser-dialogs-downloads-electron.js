const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

app.setPath("userData", path.join(os.tmpdir(), `guada-dialogs-test-${process.pid}`));

const downloadsDir = path.join(os.tmpdir(), `guada-downloads-test-${process.pid}`);
fs.mkdirSync(downloadsDir, { recursive: true });
// 下载自动落盘目录改到临时目录，避免污染真实 Downloads
app.setPath("downloads", downloadsDir);

const {
  BrowserAutomationService,
} = require("../electron/dist/browser-automation-service.js");
const { BrowserDialogTracker } = require("../electron/dist/browser-dialogs.js");
const { BrowserDownloadTracker } = require("../electron/dist/browser-downloads.js");
const { installWindowOpenHandler } = require("../electron/dist/browser-popups.js");
const {
  applyBrowserPermissionPolicy,
} = require("../electron/dist/browser-permission-policy.js");

const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures", "browser-dialogs-downloads.html"),
  "utf8",
);

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url && req.url.includes(".txt")) {
        res.writeHead(200, {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="guada-dialog-download-test.txt"',
        });
        res.end("guada download fixture content");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixture);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  await app.whenReady();
  const { server, url } = await startServer();
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(url);
  await new Promise((r) => setTimeout(r, 400));

  const info = {
    windowId: "win_test",
    title: "Dialog Download Fixture",
    url,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    isActive: true,
    isMainApp: false,
    isVisible: true,
    metadata: { createdBy: "dialog-test" },
  };
  const createdTabs = [];
  const manager = {
    getWindowList: () => [...createdTabs, info],
    getWebContents: () => win.webContents,
    getWebviewWebContents: async () => win.webContents,
    isWindowVisible: () => true,
    setWebviewRenderable: () => {},
    // 让 BrowserAutomationService 注入 window.open 的开新标签回调
    onOpenInNewTab: null,
  };
  const service = new BrowserAutomationService();
  service.initializeWindowManager(manager);
  await service.tabsManage("select", "dialog-test", 0);

  // 测试窗口不是 <webview>，没有 did-attach-webview：手动挂上 tracker
  // （生产路径在 BrowserWebviewManager.handleWebviewAttach 中自动执行）。
  const tracker = new BrowserDialogTracker((windowId, type, message) => {
    console.log(`[dialog-event] ${windowId} ${type}: ${message}`);
  });
  await tracker.setup(win.webContents, "win_test");
  manager.dialogs = tracker;
  manager.getPendingDialog = (windowId) => tracker.get(windowId);
  manager.handleDialog = (windowId, accept, promptText) => tracker.handle(windowId, accept, promptText);
  manager.dismissPendingDialogs = (windowId) => tracker.dismissAll(windowId);

  const downloadsTracker = new BrowserDownloadTracker();
  downloadsTracker.setup(win.webContents, "win_test");
  manager.waitForDownload = (windowId, timeoutMs) => downloadsTracker.wait(windowId, timeoutMs);
  manager.listDownloads = (windowId, limit) => downloadsTracker.list(windowId, limit);

  // window.open 路由：由 service 的 onOpenInNewTab 回调负责开新标签
  installWindowOpenHandler(win.webContents, "win_test", {
    onOpenInNewTab: (url, originWindowId) => {
      manager.onOpenInNewTab?.(url, originWindowId);
    },
  });

  const call = (method, params = {}) =>
    service.handleToolCall({ id: "0", method, params: { created_by: "dialog-test", ...params } });
  const pageRun = (code) => win.webContents.executeJavaScript(code, false);

  // ── 1) confirm: get → handle(true) ──
  await call("browser_locator", { action: "click", descriptor: { kind: "selector", selector: "#confirm-btn" } });
  const confirmDialog = await waitFor(
    async () => (await call("browser_dialog", { action: "get" })).dialog,
    4000,
    "confirm dialog opening",
  );
  assert(confirmDialog && confirmDialog.type === "confirm", `expected confirm dialog, got ${JSON.stringify(confirmDialog)}`);
  assert(confirmDialog.message === "Delete item?", "confirm message mismatch");
  await call("browser_dialog", { action: "handle", accept: true });
  const logAfterConfirm = await pageRun("window.__log");
  assert(
    logAfterConfirm.includes("confirm:true"),
    `confirm accept not delivered: ${JSON.stringify(logAfterConfirm)}`,
  );
  console.log("DIALOG_OK confirm accept");

  // ── 2) alert 残留时动作 NOT_ACTIONABLE，handle 后恢复 ──
  await waitFor(
    async () => ((await call("browser_dialog", { action: "get" })).dialog) === null,
    4000,
    "confirm dialog close",
  );
  await call("browser_locator", { action: "click", descriptor: { kind: "selector", selector: "#alert-btn" } });
  await waitFor(
    async () => (await call("browser_dialog", { action: "get" })).dialog,
    4000,
    "alert dialog opening",
  );
  let blocked = null;
  try {
    await call("browser_locator", { action: "click", descriptor: { kind: "selector", selector: "#confirm-btn" } });
  } catch (error) {
    blocked = error;
  }
  assert(blocked && blocked.code === "NOT_ACTIONABLE", `expected NOT_ACTIONABLE, got ${blocked && blocked.code}`);
  assert(blocked.details && blocked.details.dialog, "NOT_ACTIONABLE details.dialog missing");
  assert(
    String(blocked.message).includes("tab.handleDialog"),
    `error should mention tab.handleDialog: ${blocked.message}`,
  );
  await call("browser_dialog", { action: "handle", accept: false });
  const logAfterAlert = await pageRun("window.__log");
  assert(logAfterAlert.includes("alert-closed"), `alert did not close: ${JSON.stringify(logAfterAlert)}`);
  console.log("DIALOG_OK action guard + dismiss");

  // ── 4) 下载：waitForDownload → completed + 文件存在 ──
  await call("browser_locator", { action: "click", descriptor: { kind: "selector", selector: "#download-link" } });
  const download = await call("browser_download", { action: "wait", timeout: 10000 });
  assert(download.ok && download.download, `download wait failed: ${JSON.stringify(download)}`);
  assert(download.download.state === "completed", `download state ${download.download.state}`);
  assert(download.download.path && fs.existsSync(download.download.path), "download file missing on disk");
  const listed = await call("browser_download", { action: "list" });
  assert(
    Array.isArray(listed.downloads) && listed.downloads.some((d) => d.id === download.download.id),
    "download list missing record",
  );
  console.log(`DOWNLOAD_OK ${download.download.filename} -> ${download.download.path}`);

  // ── 5) window.open → 开新标签回调（fake manager 不支持真建标签：只断言回调被调用且 deny） ──
  let popupUrl = null;
  service.createWindow = async (targetUrl) => {
    popupUrl = targetUrl;
    return `win_popup_${createdTabs.length + 1}`;
  };
  await pageRun(`window.open("${url}?popup=1", "_blank")`);
  await waitFor(() => popupUrl, 4000, "popup routing");
  assert(popupUrl.includes("popup=1"), `popup url mismatch: ${popupUrl}`);
  console.log("POPUP_OK routed to createWindow");

  // 权限 fail-closed：通知权限被拒绝（不依赖真实摄像头等硬件）
  applyBrowserPermissionPolicy(win.webContents.session, "test");
  const notificationPermission = await pageRun(
    `Notification.requestPermission().then((value) => value).catch((error) => error.name)`,
  );
  assert(
    notificationPermission === "denied",
    `notifications should be denied, got ${notificationPermission}`,
  );
  console.log("PERMISSION_OK notifications denied");

  win.destroy();
  server.close();
  fs.rmSync(downloadsDir, { recursive: true, force: true });
  console.log("BROWSER_DIALOGS_DOWNLOADS_TEST_OK");
  app.exit(0);
}

main().catch((error) => {
  console.error("BROWSER_DIALOGS_DOWNLOADS_TEST_FAILED", error);
  app.exit(1);
});
