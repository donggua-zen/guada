/**
 * 复现「pointerdown 到了但 pointermove 全丢」。
 *
 * 关键差异：这个测试走**完整的 main 进程链路**
 *   pointerdown → IPC → setInteracting(true) → tick() → applyShape()
 *   → setIgnoreMouseEvents(false)
 * 而不是像之前那样只测裸窗口。
 *
 * 用真实 SendInput 拖动（manual 脚本，会抢占鼠标）。
 *
 * 用法：node scripts/run-electron.cjs scripts/manual-test-pointermove-loss.js
 */
const { app, ipcMain, screen } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mouse(steps, tag) {
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, System.UIntPtr e);
'
${steps}
`;
  const file = path.join(os.tmpdir(), `pet-pml-${tag}.ps1`);
  fs.writeFileSync(file, script, "utf8");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
    timeout: 60000,
  });
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const c = new PetWindowController({
    petsRoots: [{ dir: path.join(ROOT, "build-resources", "pets"), source: "bundled" }],
    uiHtmlPath: resolvePetUiHtmlPath(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    avatarId: "silver-haired",
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile: path.join(os.tmpdir(), "pet-pml-test.json"),
  });
  let downs = 0;
  const moves = [];
  // 完整链路：与 main.ts 一致
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  ipcMain.on("pet:debug-pointer", () => { downs += 1; });
  ipcMain.on("pet:pointer-down", () => c.setInteracting(true));
  ipcMain.on("pet:pointer-hold", () => c.refreshInteracting());
  ipcMain.on("pet:drag-move", (_e, d) => {
    moves.push(d);
    c.setInteracting(true);
    if (typeof d.sx === "number") c.dragTo(d.sx, d.sy, d.x, d.y);
    else c.moveBy(Number(d.dx) || 0, Number(d.dy) || 0);
  });
  ipcMain.on("pet:drag-end", (_e, p) => {
    c.setInteracting(false);
    c.clearDragOrigin();
    if (p?.moved !== false) c.persistPosition();
  });
  c.setEnabled(true);
  await sleep(1800);

  const win = c.window;
  const [x0, y0] = win.getPosition();
  const cx = Math.round(x0 + 180);
  const cy = Math.round(y0 + 250);

  // 先把窗口置为可交互（等价于「已经放开穿透」的稳态），
  // 排除「穿透态下 forward 转发不到」这个变量，单独验证拖动链路本身。
  c.setInteracting(true);
  await sleep(200);
  console.log("appliedIgnore:", c.getAppliedIgnore(), "(false = 可交互)");

  // 实验开关：NO_IGNORE_SWITCH=1 时，拖动期间不再调用 setIgnoreMouseEvents，
  // 用来判断「每拍下发穿透」是否打断了指针流。
  if (process.env.NO_IGNORE_SWITCH === "1") {
    c.setInteracting = function (v) { this.interacting = v; this.interactingSince = v ? Date.now() : 0; };
    console.log("[实验] 已禁用 setIgnoreMouseEvents 下发");
  }

  // 先移动到宠物上（触发心跳放开穿透），再按下并拖动
  const steps = `
[void][W.U]::SetCursorPos(${cx - 40}, ${cy - 40})
Start-Sleep -Milliseconds 120
[void][W.U]::SetCursorPos(${cx}, ${cy})
Start-Sleep -Milliseconds 250
[W.U]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
${Array.from({ length: 12 }, () => `[W.U]::mouse_event(0x0001, 4, 3, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
`).join("")}[W.U]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
`;
  // 关键：让拖动期间的窗口移动「失效」，看 pointerup 是否还会提前到来。
  // 若不再提前 → 证实是 setPosition 干扰了指针流。
  const origMoveBy = c.moveBy.bind(c);
  let moveByCalls = 0;
  if (process.env.DISABLE_MOVEBY === "1") {
    c.moveBy = () => { moveByCalls += 1; };
  }
  const before = win.getPosition();
  mouse(steps, "a");
  await sleep(600);
  const after = win.getPosition();

  // 读渲染层诊断计数
  const diag = await win.webContents.executeJavaScript(
    "JSON.stringify({move:window.__petMoveCount||0, ignored:window.__petMoveIgnored||0, mismatch:window.__petMoveIdMismatch||0, down:window.__petPointerDownCount||0, endDrag:window.__petEndDragCount||0, ghost:window.__petGhostUp||0, realUp:window.__petRealUp||0, upInfo:window.__petUpInfo||null})",
  );

  console.log("pointerdown:", downs, "| drag-move IPC:", moves.length);
  console.log("渲染层计数:", diag);
  console.log("窗口:", before, "→", after, before[0] !== after[0] || before[1] !== after[1] ? "✓ 移动了" : "✗ 没动");

  c.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("FAIL", e); app.exit(1); });
