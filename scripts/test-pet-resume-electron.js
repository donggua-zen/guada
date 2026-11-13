/**
 * 息屏/唤醒后桌宠拖不动的回归测试。
 *
 * 原因：系统睡眠时吞掉 pointerup → 渲染层发不出 pet:drag-end →
 * 主进程 interacting 永远是 true，tick() 一直跳过命中判定；
 * 且 Chromium 可能重置鼠标过滤状态但 appliedIgnore 缓存没作废，不再下发。
 *
 * 用法：node scripts/test-pet-resume-electron.js
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
    positionFile: path.join(os.tmpdir(), "pet-resume-test.json"),
  });
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", () => {});
  c.setEnabled(true);
  await sleep(900);

  // 造一个「卡住的拖动态」
  c.setInteracting(true);
  assert.strictEqual(c.isInteracting(), true);
  console.log("已进入卡住的交互态");

  // ── 场景 A：onSystemResume 立即恢复 ──
  c.onSystemResume();
  assert.strictEqual(c.isInteracting(), false, "resume 应清掉交互态");
  // resume 内部先作废缓存，再 tick 重算并重新下发，所以这里应是一个具体的布尔值
  assert.ok(
    typeof c.getAppliedIgnore() === "boolean",
    "resume 后应重新下发过一次 setIgnoreMouseEvents（appliedIgnore 非 null）",
  );
  await sleep(120);
  console.log("PET_RESUME_OK explicit-resume");

  // ── 场景 B：不调 resume，靠超时自愈 ──
  c.setInteracting(true);
  // 把 interactingSince 往前拨 16s（模拟睡眠期间时钟继续走）
  c.interactingSince = Date.now() - 16_000;
  await sleep(120); // 等一次 40ms tick
  assert.strictEqual(c.isInteracting(), false, "tick 应超时清掉交互态");
  console.log("PET_RESUME_OK timeout-fallback");

  // ── 场景 C：隐藏时清交互态 ──
  c.setInteracting(true);
  c.hide();
  assert.strictEqual(c.isInteracting(), false, "hide 应清掉交互态");
  console.log("PET_RESUME_OK hide-clears");

  c.destroy();
  console.log("PET_RESUME_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_RESUME_FAILED", error);
  app.exit(1);
});
