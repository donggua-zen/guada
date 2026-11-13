/**
 * 桌宠穿透方案验证：setShape（Windows SetWindowRgn）替代 setIgnoreMouseEvents。
 *
 * 判定方法：用 user32.WindowFromPoint 问系统「这个屏幕坐标会命中哪个窗口」。
 * 形状内应是桌宠窗口，形状外应是别的窗口（穿透成功）。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-shape-pass.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 用 PowerShell 调 WindowFromPoint，返回命中的窗口句柄 */
function hwndAt(x, y) {
  const ps = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
'
$p = New-Object W.U+POINT
$p.X = ${x}; $p.Y = ${y}
[W.U]::WindowFromPoint($p).ToInt64()
`;
  return execFileSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    timeout: 15000,
  }).trim();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const c = new PetWindowController({
    petsRoots: [{ dir: path.join(ROOT, "build-resources", "pets"), source: "bundled" }],
    uiHtmlPath: resolvePetUiHtmlPath(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    avatarId: "silver-haired",
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile: path.join(os.tmpdir(), "pet-shape-test.json"),
  });
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  c.setEnabled(true);
  await sleep(1200);

  const win = c.window;
  assert.ok(win && !win.isDestroyed(), "应创建出窗口");
  const [wx, wy] = win.getPosition();

  // 让渲染层上报真实几何（它会自己算 bbox 并发 pet:hit-geometry）
  // 这里直接构造一个居中矩形，避免依赖动画时序
  c.setHitGeometry({ image: { x: 120, y: 150, w: 120, h: 180 }, bubble: null });
  await sleep(150);

  const inside = { x: wx + 180, y: wy + 240 };   // 矩形中心
  const outside = { x: wx + 6, y: wy + 6 };      // 左上角透明区

  const insideHwnd = hwndAt(inside.x, inside.y);
  const outsideHwnd = hwndAt(outside.x, outside.y);

  console.log("窗口位置:", wx, wy);
  console.log("形状内 hwnd:", insideHwnd);
  console.log("形状外 hwnd:", outsideHwnd);

  assert.notStrictEqual(
    insideHwnd,
    outsideHwnd,
    "形状内与形状外必须命中不同窗口（否则透明区仍会拦住桌面点击）",
  );
  console.log("PET_SHAPE_OK transparent-area-passes-through");

  // 交互中（拖动）形状应为整窗，保证拖出 bbox 仍属于本窗
  c.setInteracting(true);
  await sleep(120);
  const wideHwnd = hwndAt(outside.x, outside.y);
  assert.strictEqual(
    wideHwnd,
    insideHwnd,
    "拖动中整窗应为同一窗口（否则拖出包围盒会丢事件）",
  );
  console.log("PET_SHAPE_OK dragging-full-window");

  // 松手恢复裁剪
  c.setInteracting(false);
  await sleep(120);
  const backHwnd = hwndAt(outside.x, outside.y);
  assert.notStrictEqual(backHwnd, insideHwnd, "松手后应恢复为裁剪形状");
  console.log("PET_SHAPE_OK restored-after-drag");

  c.destroy();
  console.log("PET_SHAPE_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_SHAPE_FAILED", error);
  app.exit(1);
});
