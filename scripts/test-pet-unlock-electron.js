/**
 * WIN+L 解锁后重建桌宠窗口的回归测试。
 *
 * 用户实测：正常待机时 WIN+L 锁屏 → 解锁 → 宠物必现拖不动。
 * 日志确认 Windows 锁屏不触发 powerMonitor.resume，且修补任何状态都无效，
 * 所以改用「解锁时重建窗口」这个确定性解法。
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

  // 解锁 → 重建
  c.rebuildAfterUnlock();
  await sleep(900);
  const after = c.window;
  assert.ok(after && !after.isDestroyed(), "解锁后应有可用窗口");
  assert.notStrictEqual(after, before, "应重建为新窗口实例");
  assert.strictEqual(before.isDestroyed(), true, "旧窗口应已销毁");
  assert.strictEqual(c.isInteracting(), false, "交互态应清空");
  assert.strictEqual(c.getAppliedIgnore() === null || typeof c.getAppliedIgnore() === "boolean", true);
  console.log("PET_UNLOCK_OK rebuilt");

  // 重建后仍可正常收到渲染层 ready / 状态
  const mode = await after.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(mode, "idle", "重建后应正常加载并播放");
  console.log("PET_UNLOCK_OK renderer-alive");

  // 再重建一次（幂等）
  c.rebuildAfterUnlock();
  await sleep(700);
  assert.ok(c.window && !c.window.isDestroyed());
  console.log("PET_UNLOCK_OK idempotent");

  c.destroy();
  console.log("PET_UNLOCK_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_UNLOCK_FAILED", error);
  app.exit(1);
});
