/**
 * WIN+L 解锁后恢复（不重建窗口，避免闪一下）。
 *
 * Qoder 的桌宠根节点带 opacity 过渡、不销毁窗口；用户实测我们上一版
 * 「解锁必重建」虽然能拖动但会闪一下。改为：探活 renderer → 活着就原地恢复。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-unlock-electron.js
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
    positionFile: path.join(os.tmpdir(), "pet-unlock-test.json"),
  });
  const unlocks = [];
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  c.setEnabled(true);
  await sleep(900);
  const before = c.window;
  assert.ok(before && !before.isDestroyed());

  // 模拟锁屏后各种残留状态
  c.setInteracting(true);
  c.noteHitHeartbeat();
  c.setHitGeometry({ image: { x: 10, y: 10, w: 100, h: 100 }, bubble: null });

  await c.rebuildAfterUnlock();
  await sleep(200);
  const after = c.window;
  assert.ok(after && !after.isDestroyed());
  assert.strictEqual(after, before, "不应重建窗口（重建会闪一下）");
  assert.strictEqual(c.isInteracting(), false, "交互态应清空");
  assert.ok(
    typeof c.getAppliedIgnore() === "boolean",
    "解锁后应重新下发穿透状态（appliedIgnore 非 null）",
  );
  console.log("PET_UNLOCK_OK recovered-in-place");

  const mode = await after.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(mode, "idle", "渲染层仍正常");
  console.log("PET_UNLOCK_OK renderer-alive");

  // 幂等
  await c.rebuildAfterUnlock();
  await sleep(150);
  assert.strictEqual(c.window, after, "再次解锁也不应重建");
  console.log("PET_UNLOCK_OK idempotent");

  // 渲染层已死的极端场景才重建
  after.webContents.forcefullyCrashRenderer();
  await sleep(500);
  await c.rebuildAfterUnlock();
  await sleep(900);
  assert.ok(c.window && !c.window.isDestroyed(), "renderer 死了应重建出可用窗口");
  console.log("PET_UNLOCK_OK dead-renderer-rebuilds");

  c.destroy();
  console.log("PET_UNLOCK_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_UNLOCK_FAILED", error);
  app.exit(1);
});
