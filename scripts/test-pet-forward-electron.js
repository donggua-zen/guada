/**
 * 端到端：窗口穿透时 forward 的 mousemove 能到渲染层，
 * 且渲染层会据此发 pet:hit-heartbeat 让主进程放开穿透。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-forward-electron.js
 */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "build-resources", "pets", "silver-haired");
const UI = path.join(ROOT, "build-resources", "pet-ui", "pet.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 380, x: 80, y: 80, transparent: true, frame: false, show: false,
    webPreferences: {
      preload: path.join(ROOT, "electron", "dist", "pet-preload.js"),
      contextIsolation: true, backgroundThrottling: false,
    },
  });
  let heartbeats = 0;
  ipcMain.on("pet:hit-heartbeat", () => { heartbeats += 1; });
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:ready", () => {
    win.webContents.send("pet:config", fs.readFileSync(path.join(ASSETS, "manifest.json"), "utf8"), "frames", `${pathToFileURL(ASSETS).href}/`);
    win.webContents.send("pet:state", { mood: "idle", mode: "idle", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null });
  });

  await win.loadFile(UI);
  win.showInactive();
  await sleep(900);

  // 强制穿透（模拟熄屏后主进程判 miss）
  win.setIgnoreMouseEvents(true, { forward: true });
  await sleep(100);
  // 用 CDP 派发真实 mousemove 到窗口中心
  await win.webContents.executeJavaScript(`(function(){
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles:true, clientX: 100, clientY: 100, screenX: 180, screenY: 180
    }));
    return true;
  })()`);
  await sleep(150);
  assert.ok(heartbeats >= 1, `渲染层应发出命中心跳，实际 ${heartbeats}`);
  console.log("PET_FORWARD_OK mousemove-triggers-heartbeat", heartbeats);

  win.destroy();
  console.log("PET_FORWARD_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_FORWARD_FAILED", error);
  app.exit(1);
});
