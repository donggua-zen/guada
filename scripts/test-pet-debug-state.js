/**
 * 验证右键调试菜单依赖的两个出口：
 *  - window.__petDrag（拖动状态）
 *  - window.__petGetMode()（当前动作）
 *  - 各项诊断计数（down/move/ignored/mismatch/endDrag/ghostUp/realUp）
 *
 * 这样用户复现后点「调试：抓取渲染层状态」就能拿到确切数据。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-debug-state.js
 */
const { app, ipcMain, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "build-resources", "pets", "silver-haired");
const UI = path.join(ROOT, "build-resources", "pet-ui", "pet.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 380, x: 300, y: 200, show: false,
    webPreferences: {
      preload: path.join(ROOT, "electron", "dist", "pet-preload.js"),
      contextIsolation: true, backgroundThrottling: false,
    },
  });
  ipcMain.on("pet:ready", () => {
    win.webContents.send("pet:config", fs.readFileSync(path.join(ASSETS, "manifest.json"), "utf8"), "frames", `${pathToFileURL(ASSETS).href}/`);
    win.webContents.send("pet:state", { mood: "idle", mode: "idle", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null });
  });
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:pointer-down", () => {});
  ipcMain.on("pet:pointer-hold", () => {});
  ipcMain.on("pet:drag-move", () => {});
  ipcMain.on("pet:drag-end", () => {});

  await win.loadFile(UI);
  win.showInactive();
  await sleep(1000);

  const diag = await win.webContents.executeJavaScript(
    `(function(){
      var d = window.__petDrag || {};
      return JSON.stringify({
        dragActive: d.active,
        dragMoved: d.moved,
        pointerId: d.pointerId,
        downCount: window.__petPointerDownCount || 0,
        moveCount: window.__petMoveCount || 0,
        moveIgnored: window.__petMoveIgnored || 0,
        idMismatch: window.__petMoveIdMismatch || 0,
        endDrag: window.__petEndDragCount || 0,
        ghostUp: window.__petGhostUp || 0,
        realUp: window.__petRealUp || 0,
        mode: window.__petGetMode ? window.__petGetMode() : null,
      });
    })()`,
  );
  const state = JSON.parse(diag);
  assert.strictEqual(typeof state.dragActive, "boolean", "__petDrag.active 应可读");
  assert.strictEqual(state.mode, "idle", "__petGetMode 应返回当前动作");
  assert.ok(Number.isFinite(state.downCount), "downCount 应为数字");
  console.log("PET_DEBUG_STATE_OK", diag);

  // 模拟一次按下，确认计数与 drag 状态同步
  await win.webContents.executeJavaScript(`(function(){
    document.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles:true, cancelable:true, pointerId:3, pointerType:'mouse',
      button:0, buttons:1, screenX:400, screenY:300, clientX:180, clientY:250
    }));
    return true;
  })()`);
  await sleep(120);
  const after = JSON.parse(
    await win.webContents.executeJavaScript(
      "JSON.stringify({active: window.__petDrag.active, down: window.__petPointerDownCount})",
    ),
  );
  assert.strictEqual(after.active, true, "按下后 __petDrag.active 应为 true");
  assert.ok(after.down >= 1, "downCount 应递增");
  console.log("PET_DEBUG_STATE_OK after-pointerdown", JSON.stringify(after));

  win.destroy();
  console.log("PET_DEBUG_STATE_TEST_OK");
  app.exit(0);
}).catch((e) => { console.error("PET_DEBUG_STATE_FAILED", e); app.exit(1); });
