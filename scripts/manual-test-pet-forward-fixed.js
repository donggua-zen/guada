/**
 * 验证修复：focusable:true + WS_EX_NOACTIVATE 之后，
 * ① forward 的 mousemove 能到渲染层（→ 命中心跳恢复 → 拖得动）
 * ② 点击不抢前台焦点
 *
 * 用真实 PetWindowController（不是裸窗口），走完整建窗路径。
 * 会真实移动光标（manual 脚本）。
 *
 * 用法：node scripts/run-electron.cjs scripts/manual-test-pet-forward-fixed.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(lines, tag) {
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, System.UIntPtr e);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'
${lines}
[W.U]::GetForegroundWindow().ToInt64()
`;
  const file = path.join(os.tmpdir(), `pet-fxf-${tag}.ps1`);
  fs.writeFileSync(file, script, "utf8");
  return execFileSync(
    "powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
    { encoding: "utf8", timeout: 30000 },
  ).trim();
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const c = new PetWindowController({
    petsRoots: [{ dir: path.join(ROOT, "build-resources", "pets"), source: "bundled" }],
    uiHtmlPath: resolvePetUiHtmlPath(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    avatarId: "silver-haired",
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile: path.join(os.tmpdir(), "pet-fxf-test.json"),
  });
  let heartbeats = 0;
  let downs = 0;
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => { heartbeats += 1; c.noteHitHeartbeat(); });
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  ipcMain.on("pet:pointer-down", () => c.setInteracting(true));
  ipcMain.on("pet:drag-move", () => {});
  ipcMain.on("pet:drag-end", () => c.setInteracting(false));
  ipcMain.on("pet:debug-pointer", () => { downs += 1; });
  c.setEnabled(true);
  await sleep(2200);   // 等 PowerShell 打完 WS_EX_NOACTIVATE

  const win = c.window;
  const [x0, y0] = win.getPosition();
  const cx = Math.round(x0 + 180);
  const cy = Math.round(y0 + 250);

  console.log("窗口:", x0, y0, "| debugState:", JSON.stringify(c.debugState()).slice(0, 220));

  // ① forward mousemove → 心跳
  ps(`[void][W.U]::SetCursorPos(${cx + 300}, ${cy + 300})
Start-Sleep -Milliseconds 150
[void][W.U]::SetCursorPos(${cx}, ${cy})
Start-Sleep -Milliseconds 200`, "a");
  const hb1 = heartbeats;
  ps(`[void][W.U]::SetCursorPos(${cx + 3}, ${cy + 2})
Start-Sleep -Milliseconds 120
[void][W.U]::SetCursorPos(${cx + 6}, ${cy + 4})
Start-Sleep -Milliseconds 200`, "b");
  // 心跳是异步 IPC，等一拍
  await sleep(400);
  console.log("① 命中心跳次数:", heartbeats, heartbeats > 0 ? "✓ forward 生效" : "✗ forward 仍失效");

  // ② 点击是否抢焦点
  const fgBefore = ps(`[void][W.U]::SetCursorPos(${cx}, ${cy})`, "c");
  await sleep(200);
  const fgAfter = ps(`[W.U]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[W.U]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)`, "d");
  await sleep(400);
  console.log("② pointerdown:", downs, "| 前台:", fgBefore, "→", fgAfter,
    fgBefore === fgAfter ? "✓ 未抢焦点" : "✗ 抢了焦点");

  console.log("\n最后状态:", JSON.stringify(c.debugState()).slice(0, 240));
  c.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("FAIL", e); app.exit(1); });
