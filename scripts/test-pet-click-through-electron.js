/**
 * 穿透回归：透明区必须能点到下面，只有 bbox/气泡区可交互。
 *
 * 用户反馈「透明的地方依然会被拦截，点不到下面」——根因是上一版
 * 渲染层在所有 mousemove 都发 hitHeartbeat，主进程把整窗放开。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-click-through-electron.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
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
  let lastHit = null;   // true=放开 / false=穿透
  ipcMain.on("pet:hit-heartbeat", () => { lastHit = true; });
  ipcMain.on("pet:hit-leave", () => { lastHit = false; });
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:ready", () => {
    win.webContents.send("pet:config", fs.readFileSync(path.join(ASSETS, "manifest.json"), "utf8"), "frames", `${pathToFileURL(ASSETS).href}/`);
    win.webContents.send("pet:state", { mood: "idle", mode: "idle", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null });
  });

  function mouseAt(x, y) {
    return win.webContents.executeJavaScript(`(function(){
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles:true, clientX:${x}, clientY:${y}, screenX:${x + 80}, screenY:${y + 80}
      }));
      return true;
    })()`);
  }

  await win.loadFile(UI);
  win.showInactive();
  await sleep(1000);

  // 几何：idle bbox 大约 x=124..233, y=171..365（窗口 360×380）
  // 宠物身上（中心）
  await mouseAt(180, 260);
  await sleep(200);
  assert.strictEqual(lastHit, true, "光标在宠物 bbox 内应发 hitHeartbeat（放开）");
  console.log("PET_CLICKTHROUGH_OK bbox-hit");

  // 透明区（窗口左上角，远离 bbox 和气泡）
  await mouseAt(8, 8);
  await sleep(200);
  assert.strictEqual(lastHit, false, "透明区应发 hitLeave（穿透），否则会挡住桌面点击");
  console.log("PET_CLICKTHROUGH_OK transparent-area-ignore");

  // 再回到宠物身上
  await mouseAt(180, 260);
  await sleep(200);
  assert.strictEqual(lastHit, true, "回到宠物身上应重新放开");
  console.log("PET_CLICKTHROUGH_OK re-enter");

  win.destroy();
  console.log("PET_CLICKTHROUGH_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_CLICKTHROUGH_FAILED", error);
  app.exit(1);
});
