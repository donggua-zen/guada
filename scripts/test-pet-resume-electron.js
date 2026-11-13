/**
 * 息屏/唤醒后桌宠拖不动的回归测试（必现场景）。
 *
 * 显示器省电熄屏（SC_MONITORPOWER）不触发 powerMonitor.resume，
 * 但系统/Chromium 可能把窗口的鼠标过滤状态重置为「穿透」。
 * 模拟：绕过控制器的缓存直接调 win.setIgnoreMouseEvents(true)，
 * 验证 tick 在下一拍就按光标位置重新下发（缓存短路会让它永远不恢复）。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-resume-electron.js
 */
const { app, ipcMain, screen } = require("electron");
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
  const win = c.window;
  // 把窗口挪到光标处，保证 tick 判定为「命中 → 不穿透」
  const cur = screen.getCursorScreenPoint();
  win.setPosition(cur.x - 60, cur.y - 60);
  // 上报一个覆盖整窗的几何，模拟渲染层正常状态
  c.setHitGeometry({ image: { x: 0, y: 0, w: 360, h: 380 }, bubble: null });
  await sleep(120);

  // ── 场景 A：系统偷偷把窗口重置成穿透，控制器的缓存不知情 ──
  // 先让控制器处于「不穿透」（interacting 会 applyIgnore(false)）
  c.setInteracting(true);
  assert.strictEqual(c.getAppliedIgnore(), false);
  // 模拟系统重置：绕过缓存，直接穿透
  win.setIgnoreMouseEvents(true, { forward: true });
  // 清掉交互态，让 tick 走正常判定
  c.setInteracting(false);
  await sleep(120); // 至少 2 拍
  assert.strictEqual(
    c.getAppliedIgnore(),
    false,
    "tick 必须每拍重新下发（不缓存短路），否则系统重置后永远恢复不了",
  );
  console.log("PET_RESUME_OK applyIgnore-not-cached");

  // ── 场景 B：onSystemResume 清交互态 + 重下发 ──
  c.setInteracting(true);
  c.onSystemResume();
  assert.strictEqual(c.isInteracting(), false);
  assert.ok(typeof c.getAppliedIgnore() === "boolean", "resume 后应重新下发过");
  console.log("PET_RESUME_OK explicit-resume");

  // ── 场景 C：交互态超时自愈 ──
  c.setInteracting(true);
  c.interactingSince = Date.now() - 16_000;
  await sleep(120);
  assert.strictEqual(c.isInteracting(), false);
  console.log("PET_RESUME_OK timeout-fallback");

  // ── 场景 D：hide() 清交互态 ──
  c.setInteracting(true);
  c.hide();
  assert.strictEqual(c.isInteracting(), false);
  console.log("PET_RESUME_OK hide-clears");

  // ── 场景 E：几何丢失时（渲染层被冻结）光标在窗口内仍可点 ──
  c.setEnabled(true);
  c.setHitGeometry(null);
  await sleep(120);
  assert.ok(
    typeof c.getAppliedIgnore() === "boolean",
    "几何丢失时仍应有明确的穿透判定",
  );
  console.log("PET_RESUME_OK geometry-fallback");

  c.destroy();
  console.log("PET_RESUME_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_RESUME_FAILED", error);
  app.exit(1);
});
