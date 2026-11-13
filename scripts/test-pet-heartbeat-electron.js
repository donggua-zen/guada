/**
 * 熄屏/亮屏后桌宠拖不动的恢复通道测试。
 *
 * 场景（用户实际路径）：**正常待机时**显示器省电熄屏，再亮屏。此时没有任何
 * 拖拽，interacting 一直是 false，也不触发 powerMonitor.resume。
 * 但主进程 screen.getCursorScreenPoint() / 窗口 bounds 在显示拓扑变化后可能
 * 失真，精确 bbox 判定连续判 miss → 窗口保持穿透 →
 * Windows 的 forward:true **不转发 mousedown** → pointerdown 永远进不来 → 拖不动。
 *
 * 恢复通道：forward 会转发 mousemove，渲染层收到就发 pet:hit-heartbeat，
 * 主进程据此放开穿透（不依赖坐标）。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-heartbeat-electron.js
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
    positionFile: path.join(os.tmpdir(), "pet-heartbeat-test.json"),
  });
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  c.setEnabled(true);
  await sleep(900);

  // 让主进程认为光标 miss（模拟熄屏后坐标失真）：伪造一个明显命不中的几何
  c.setHitGeometry({ image: { x: -9999, y: -9999, w: 1, h: 1 }, bubble: null });
  await sleep(100);
  if (process.platform === "win32") {
    // win32 走 setShape：穿透由窗口 region 决定，不再依赖心跳开关。
    // 形状外的穿透由 test-pet-shape-pass.js（WindowFromPoint）验证。
    console.log("PET_HEARTBEAT_OK win32-uses-setshape（跳过旧语义断言）");
    c.destroy();
    console.log("PET_HEARTBEAT_TEST_OK");
    app.exit(0);
    return;
  }
  // 此时没有心跳 → 应保持穿透
  assert.strictEqual(c.getAppliedIgnore(), true, "无心跳且 bbox miss 时应穿透");
  console.log("PET_HEARTBEAT_OK miss-keeps-ignore");

  // 模拟渲染层收到 forward 的 mousemove → 发心跳
  c.noteHitHeartbeat();
  assert.strictEqual(c.getAppliedIgnore(), false, "心跳应立刻放开穿透，让 pointerdown 能进来");
  console.log("PET_HEARTBEAT_OK heartbeat-opens");

  // 心跳 600ms 内持续有效（模拟每 120ms 一次的 mousemove）
  await sleep(250);
  assert.strictEqual(c.getAppliedIgnore(), false, "心跳有效期内不应回退到穿透");
  console.log("PET_HEARTBEAT_OK heartbeat-ttl");

  // 心跳过期 + 光标离开 → 回穿透
  c.hitHeartbeatAt = Date.now() - 1000;
  await sleep(100);
  assert.strictEqual(c.getAppliedIgnore(), true, "心跳过期后应回穿透");
  console.log("PET_HEARTBEAT_OK heartbeat-expiry");

  c.destroy();
  console.log("PET_HEARTBEAT_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_HEARTBEAT_FAILED", error);
  app.exit(1);
});
