/**
 * 决定性判定：形状内的那个 hwnd，到底是不是我们进程的窗口？
 *
 * 用 GetWindowThreadProcessId 拿 pid 与 process.pid 比对。
 *  - 是我们的 → 点击落在我们窗上，问题在渲染层/事件层
 *  - 不是我们的 → 被别的窗口盖住（alwaysOnTop 失效 / 窗口没真正置顶）
 *
 * 用法：node scripts/run-electron.cjs scripts/probe-pet-owner.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probeAt(x, y) {
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
[DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int idx);
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
'
$p = New-Object W.U+POINT
$p.X = ${x}; $p.Y = ${y}
$h = [W.U]::WindowFromPoint($p)
$root = [W.U]::GetAncestor($h, 2)
if ($root -eq [IntPtr]::Zero) { $root = $h }
$procId = 0
[void][W.U]::GetWindowThreadProcessId($root, [ref]$procId)
$ex = [W.U]::GetWindowLongW($root, -20)
"$($h.ToInt64())|$($root.ToInt64())|$procId|$ex"
`;
  const file = path.join(os.tmpdir(), "pet-owner.ps1");
  fs.writeFileSync(file, script, "utf8");
  const out = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
    { encoding: "utf8", timeout: 20000 },
  ).trim();
  const [hwnd, root, pid, ex] = out.split("|");
  const exNum = Number(ex);
  return {
    hwnd,
    root,
    pid,
    exstyle: `0x${(exNum >>> 0).toString(16)}`,
    topmost: Boolean(exNum & 0x8),
    layered: Boolean(exNum & 0x80000),
    noactivate: Boolean(exNum & 0x8000000),
  };
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const c = new PetWindowController({
    petsRoots: [{ dir: path.join(ROOT, "build-resources", "pets"), source: "bundled" }],
    uiHtmlPath: resolvePetUiHtmlPath(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    avatarId: "silver-haired",
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile: path.join(os.tmpdir(), "pet-owner-test.json"),
  });
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  c.setEnabled(true);
  await sleep(1600);

  const win = c.window;
  const [x0, y0] = win.getPosition();
  console.log("我们的 PID:", process.pid, "| 窗口:", x0, y0, "| visible:", win.isVisible());
  console.log("alwaysOnTop:", win.isAlwaysOnTop());

  const petPt = probeAt(x0 + 180, y0 + 269);
  const cornerPt = probeAt(x0 + 20, y0 + 20);
  console.log("宠物中心 →", JSON.stringify(petPt));
  console.log("透明角落 →", JSON.stringify(cornerPt));

  console.log("\n结论：");
  console.log("  宠物区属于我们进程:", Number(petPt.pid) === process.pid ? "是 ✓" : `否（pid ${petPt.pid}）✗`);
  console.log("  透明区穿透:", Number(cornerPt.pid) === process.pid ? "否（仍是我们 ✗）" : "是 ✓");

  c.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("PROBE_FAIL", e); app.exit(1); });
