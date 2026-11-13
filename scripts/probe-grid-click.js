/**
 * 在 hide→show 之后，用网格点击判定哪些点能命中。
 *
 * 假设：layered 窗口按住像素 alpha 做命中测试 —— 透明像素点击会穿过，
 * 即使它在 setShape 的 region 内。若网格结果显示「有的点能过、有的不能」，
 * 就证实了这一条。
 *
 * 用法：node scripts/run-electron.cjs scripts/probe-grid-click.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clickScript(pts, tag) {
  const body = pts
    .map(
      ([x, y], i) => `
[void][W.U]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 60
[W.U]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[W.U]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 90
Write-Output "P${i}"
`,
    )
    .join("");
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, System.UIntPtr e);
'
${body}
`;
  const file = path.join(os.tmpdir(), `pet-grid-${tag}.ps1`);
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
    positionFile: path.join(os.tmpdir(), "pet-grid-test.json"),
  });
  let downs = 0;
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  ipcMain.on("pet:debug-pointer", () => { downs += 1; });
  c.setEnabled(true);
  await sleep(1600);

  const win = c.window;
  // 形状是 146,166 69x206：在它内部取 3x5 网格
  const shape = { x: 146, y: 166, w: 69, h: 206 };
  function grid() {
    const [x0, y0] = win.getPosition();
    const pts = [];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        pts.push([
          Math.round(x0 + shape.x + (shape.w * (col + 0.5)) / 3),
          Math.round(y0 + shape.y + (shape.h * (row + 0.5)) / 5),
        ]);
      }
    }
    return pts;
  }

  async function runGrid(label) {
    const pts = grid();
    const before = downs;
    clickScript(pts, label);
    await sleep(400);
    const hit = downs - before;
    console.log(`${label}: 15 点中命中 ${hit} 个`);
    return hit;
  }

  await runGrid("g1");
  c.hide();
  await sleep(600);
  win.showInactive();
  await sleep(1000);
  const after = await runGrid("g2");
  console.log("hide→show 后命中数:", after, after > 0 ? "→ 仍能命中（说明是像素 alpha 而非窗口状态）" : "→ 完全不命中");

  if (after === 0) {
    // 再确认一次：这个点上 WindowFromPoint 是谁
    const pts = grid();
    const [x, y] = pts[7];
    const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
'
$p = New-Object W.U+POINT; $p.X = ${x}; $p.Y = ${y}
$h = [W.U]::WindowFromPoint($p); $procId = 0
[void][W.U]::GetWindowThreadProcessId($h, [ref]$procId)
"$($h.ToInt64())|$procId"
`;
    const f = path.join(os.tmpdir(), "pet-grid-who.ps1");
    fs.writeFileSync(f, script, "utf8");
    const who = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f], {
      encoding: "utf8", timeout: 20000,
    }).trim();
    console.log(`  点(${x},${y}) 归属 ${who} | 我们 pid ${process.pid}`);
    console.log("  isVisible:", win.isVisible(), "| bounds:", JSON.stringify(win.getBounds()));
  }

  c.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("PROBE_FAIL", e); app.exit(1); });
