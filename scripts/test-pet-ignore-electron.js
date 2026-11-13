/**
 * 主进程侧穿透回归：hitLeave 必须立刻回穿透，不能等 TTL 到期。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-ignore-electron.js
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
    positionFile: path.join(os.tmpdir(), "pet-ignore-test.json"),
  });
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  c.setEnabled(true);
  await sleep(900);

  // 造一个「光标不在任何可交互区」的几何
  c.setHitGeometry({ image: { x: -9999, y: -9999, w: 1, h: 1 }, bubble: null });
  await sleep(100);

  // 穿透统一走 setIgnoreMouseEvents（setShape 会破坏 transparent 窗口的 alpha，
  // 工作状态 bbox 较大时露出不透明背景，已弃用）。
  assert.strictEqual(c.getAppliedIgnore(), true, "无命中时应穿透");
  console.log("PET_IGNORE_OK miss-keeps-ignore");

  c.noteHitHeartbeat();
  assert.strictEqual(c.getAppliedIgnore(), false, "心跳应立刻放开");
  console.log("PET_IGNORE_OK heartbeat-opens");
  c.clearHitHeartbeat();
  assert.strictEqual(
    c.getAppliedIgnore(),
    true,
    "hitLeave 必须立刻回穿透（否则透明区会挡住桌面点击）",
  );
  console.log("PET_IGNORE_OK leave-closes-immediately");

  c.destroy();
  console.log("PET_IGNORE_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_IGNORE_FAILED", error);
  app.exit(1);
});
