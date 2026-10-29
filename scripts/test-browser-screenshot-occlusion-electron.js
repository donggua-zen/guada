const { app, BrowserWindow, webContents } = require("electron");
const os = require("node:os");
const path = require("node:path");

app.setPath(
  "userData",
  path.join(os.tmpdir(), `guada-screenshot-occlusion-${process.pid}`),
);

const {
  BrowserAutomationService,
} = require("../electron/dist/browser-automation-service.js");
const {
  acquireTransparentPresentation,
} = require("../electron/dist/transparent-presentation.js");

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

function assertShot(shot, label) {
  assert(shot && shot.ok === true, `${label}: screenshot not ok`);
  assert(
    typeof shot.data === "string" && shot.data.length > 100,
    `${label}: screenshot data missing`,
  );
  const buffer = Buffer.from(shot.data, "base64");
  assert(buffer.length >= 24, `${label}: screenshot buffer too small`);
  assert(
    buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0,
    `${label}: screenshot dimensions invalid`,
  );
  assert(shot.width > 0 && shot.height > 0, `${label}: reported size invalid`);
  console.log(`SCREENSHOT_OK ${label} ${shot.width}x${shot.height}`);
}

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    skipTaskbar: true,
    // 前台场景需要真实可见的合成表面：测试窗保持置顶，避免被终端遮挡。
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  await win.loadFile(
    path.join(__dirname, "fixtures", "webview-hit-test-host.html"),
  );

  const guestId = await waitFor(
    () =>
      win.webContents.executeJavaScript(
        "document.getElementById('wv').getWebContentsId?.() || 0",
      ),
    8000,
    "webview attach",
  );
  const guest = webContents.fromId(guestId);
  assert(guest && !guest.isDestroyed(), "guest webContents missing");
  await waitFor(() => guest.getURL().startsWith("file:"), 8000, "guest load");
  await new Promise((resolve) => setTimeout(resolve, 300));

  const state = { tabVisible: true, hostForeground: true };
  const info = {
    windowId: "win_shot",
    title: "Webview Hit Test Host",
    url: guest.getURL(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    isActive: true,
    isMainApp: false,
    isVisible: true,
    metadata: { createdBy: "shot-test" },
  };

  const manager = {
    getWindowList: () => [info],
    getWebContents: () => guest,
    getWebviewWebContents: async () => guest,
    isWindowVisible: () => state.tabVisible,
    setWebviewRenderable: (_windowId, renderable) => {
      void win.webContents
        .executeJavaScript(`window.__setRenderable(${renderable})`)
        .catch(() => {});
    },
    isHostForeground: () => state.hostForeground,
    getHostWebContents: () => (win.isDestroyed() ? null : win.webContents),
    acquireScreenshotPresentation: () =>
      acquireTransparentPresentation(win, { hideTaskbar: false }),
  };

  const service = new BrowserAutomationService();
  service.initializeWindowManager(manager);
  await service.tabsManage("select", "shot-test", 0);

  // 1) 前台可见标签：capturePage 快路径
  state.tabVisible = true;
  state.hostForeground = true;
  win.show();
  win.focus();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assertShot(await service.screenshot("shot-test"), "foreground");

  // 2) 后台标签：renderable + 取帧泵 + CDP
  state.tabVisible = false;
  state.hostForeground = true;
  assertShot(await service.screenshot("shot-test"), "background-tab");
  assert(
    (await win.webContents.executeJavaScript(
      "document.getElementById('wrapper').classList.contains('renderable')",
    )) === false,
    "background-tab: renderable surface should be released",
  );

  // 3) 前台但被遮挡（hostForeground=false）：仍走后台取帧路径
  state.tabVisible = true;
  state.hostForeground = false;
  assertShot(await service.screenshot("shot-test"), "occluded");

  // 3b) 真实遮挡：再开一个置顶不透明窗口盖住测试窗
  const cover = new BrowserWindow({
    ...win.getBounds(),
    show: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await cover.loadURL("data:text/html,<body style='margin:0;background:#111'></body>");
  win.blur();
  await new Promise((resolve) => setTimeout(resolve, 400));
  state.tabVisible = true;
  state.hostForeground = false;
  assertShot(await service.screenshot("shot-test"), "covered");
  cover.destroy();
  win.show();
  win.focus();
  win.moveTop();
  await new Promise((resolve) => setTimeout(resolve, 150));

  // 4) 关闭到托盘：透明 presentation + 取帧泵，结束后窗口恢复隐藏、透明度恢复
  state.tabVisible = false;
  state.hostForeground = false;
  win.hide();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assertShot(await service.screenshot("shot-test"), "hidden-tray");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert(win.isVisible() === false, "hidden-tray: window should be hidden again");
  assert(
    Math.abs(win.getOpacity() - 1) < 0.001,
    `hidden-tray: opacity should be restored, got ${win.getOpacity()}`,
  );

  // 5) manager 级 presentation 引用计数：并发截图不能互相 hide / 覆盖 opacity
  const { BrowserWebviewManager } = require("../electron/dist/browser-tab-manager.js");
  const fakeWindow = {
    isDestroyed: () => false,
    isVisible: () => fakeVisible,
    isMinimized: () => false,
    isFocused: () => false,
    getOpacity: () => fakeOpacity,
    setOpacity: (value) => {
      fakeOpacity = value;
    },
    showInactive: () => {
      fakeVisible = true;
    },
    hide: () => {
      fakeVisible = false;
    },
    setSkipTaskbar: () => {},
    on: () => {},
    removeListener: () => {},
    webContents: {
      id: 1,
      isDestroyed: () => false,
      send: () => {},
      on: () => {},
    },
  };
  let fakeVisible = false;
  let fakeOpacity = 1;
  const managerRef = new BrowserWebviewManager();
  managerRef.attachMainWindow(fakeWindow);
  const leaseA = managerRef.acquireScreenshotPresentation();
  const leaseB = managerRef.acquireScreenshotPresentation();
  assert(leaseA && leaseB, "manager presentation should be available for hidden window");
  assert(fakeVisible === true && fakeOpacity === 0, "presentation should show transparently");
  leaseA.release();
  assert(fakeVisible === true, "first release must keep presentation for the second lease");
  leaseB.release();
  assert(fakeVisible === false, "last release should hide the window");
  assert(Math.abs(fakeOpacity - 1) < 0.001, "last release should restore opacity");
  console.log("SCREENSHOT_OK presentation refcount");

  win.destroy();
  console.log("BROWSER_SCREENSHOT_OCCLUSION_TEST_OK");
  app.exit(0);
}

main().catch((error) => {
  console.error("BROWSER_SCREENSHOT_OCCLUSION_TEST_FAILED", error);
  app.exit(1);
});
