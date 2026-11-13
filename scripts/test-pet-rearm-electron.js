/**
 * WIN+L 锁屏解锁：验证「重新武装 forward 转发」这条修复。
 *
 * Petdex/dsh-pet 生态的已知坑：hide→show 会让 setIgnoreMouseEvents(true,
 * {forward:true}) 的 mousemove 转发失效，必须在 show/unlock 时重新下发
 * 并通知渲染层复位 hover 缓存。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-rearm-electron.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const c = new PetWindowController({
    petsRoots: [{ dir: path.join(ROOT, "build-resources", "pets"), source: "bundled" }],
    uiHtmlPath: resolvePetUiHtmlPath(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    avatarId: "silver-haired",
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile: path.join(os.tmpdir(), "pet-rearm-test.json"),
  });
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  c.setEnabled(true);
  await sleep(900);
  const win = c.window;
  assert.ok(win && !win.isDestroyed());
  // 渲染层 onResetHover 会自增 __petResetCount
  await win.webContents.executeJavaScript("window.__petResetCount = 0");

  // 模拟锁屏前处于「可交互态」
  c.setInteracting(true);
  assert.strictEqual(c.getAppliedIgnore(), false);

  // 解锁恢复（原地，不重建）
  await c.rebuildAfterUnlock();
  await sleep(200);
  assert.strictEqual(c.window, win, "不应重建窗口（避免闪一下）");
  assert.strictEqual(c.isInteracting(), false, "交互态应清空");
  const got = await win.webContents.executeJavaScript("window.__petResetCount || 0");
  assert.ok(got >= 1, `渲染层应收到 pet:reset-hover，实际 ${got}`);
  console.log("PET_REARM_OK unlock-rearm", "resetCount=" + got);

  // show 事件也要重新武装
  c.setInteracting(true);
  win.emit("show");
  await sleep(150);
  const got2 = await win.webContents.executeJavaScript("window.__petResetCount || 0");
  assert.ok(got2 > got, `show 应再次重新武装，实际 ${got2}`);
  assert.strictEqual(c.isInteracting(), false);
  console.log("PET_REARM_OK show-rearm", "resetCount=" + got2);

  c.destroy();
  console.log("PET_REARM_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_REARM_FAILED", error);
  app.exit(1);
});
