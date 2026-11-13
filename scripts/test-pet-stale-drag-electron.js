/**
 * 熄屏唤醒后桌宠拖不动的**端到端**回归测试。
 *
 * 必现场景：熄屏前 pointerdown 发生过，系统吞掉 pointerup，
 * drag.active 与旧的 pointerCapture 都卡住；唤醒后新的 pointerdown
 * 若不先强制收尾，Chromium 不再投递后续 pointermove → 完全拖不动。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-stale-drag-electron.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "build-resources", "pets", "silver-haired");
const UI = path.join(ROOT, "build-resources", "pet-ui", "pet.html");

app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 380, x: 60, y: 60, transparent: true, frame: false, show: false,
    webPreferences: {
      preload: path.join(ROOT, "electron", "dist", "pet-preload.js"),
      contextIsolation: true, backgroundThrottling: false,
    },
  });

  const moves = [];
  const ends = [];
  ipcMain.on("pet:drag-move", (_e, d) => moves.push(d));
  ipcMain.on("pet:drag-end", () => ends.push(Date.now()));
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:ready", () => {
    win.webContents.send("pet:config", fs.readFileSync(path.join(ASSETS, "manifest.json"), "utf8"), "frames", `${pathToFileURL(ASSETS).href}/`);
    win.webContents.send("pet:state", { mood: "idle", mode: "idle", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null });
  });

  function fire(type, x, y, buttons, pointerId) {
    return win.webContents.executeJavaScript(`(function () {
      document.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
        bubbles: true, cancelable: true, pointerId: ${pointerId}, pointerType: 'mouse',
        button: 0, buttons: ${buttons}, screenX: ${x}, screenY: ${y}, clientX: 10, clientY: 10,
      }));
      return true;
    })()`);
  }

  await win.loadFile(UI);
  win.showInactive();
  await sleep(1000);

  // ① 模拟熄屏前按下但没松手（pointerId=7 一直卡着）
  await fire("pointerdown", 500, 500, 1, 7);
  await sleep(30);
  const staleActive = await win.webContents.executeJavaScript("window.__petPointerDownCount || 0");
  assert.strictEqual(staleActive, 1);
  console.log("STALE_DRAG_OK stale-pointerdown");

  // ② 唤醒后用户再次按下（pointerId 变成 8）—— 关键：不做清理就会卡死
  await fire("pointerdown", 500, 500, 1, 8);
  await fire("pointermove", 530, 520, 1, 8);
  await sleep(80);
  assert.ok(moves.length >= 1, `新的拖拽应发出 pet:drag-move，实际 ${JSON.stringify(moves)}`);
  assert.ok(ends.length >= 1, "重新按下时应先把卡住的主进程交互态收尾（pet:drag-end）");
  console.log("STALE_DRAG_OK fresh-pointerdown-rescues", JSON.stringify({ moves: moves.length, ends: ends.length }));

  // ③ 正常松手后仍能再拖一轮
  await fire("pointerup", 530, 520, 0, 8);
  await sleep(30);
  const before = moves.length;
  await fire("pointerdown", 600, 600, 1, 9);
  await fire("pointermove", 615, 610, 1, 9);
  await sleep(80);
  assert.ok(moves.length > before, "松手后应能再次拖动");
  console.log("STALE_DRAG_OK repeatable");

  win.destroy();
  console.log("STALE_DRAG_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("STALE_DRAG_FAILED", error);
  app.exit(1);
});
