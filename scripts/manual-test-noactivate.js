/**
 * 验证 focusable:true + WS_EX_NOACTIVATE 方案：
 *  ① forward 的 mousemove 能到达渲染层（拖动依赖它）
 *  ② 点击不会抢走前台窗口（不打扰用户打字）
 *  ③ pointerdown 能进来
 *
 * 这是 dsh-pet PR #142 与多篇踩坑文给出的正确组合：
 * focusable:false 在 Electron 内部同时关掉 Chromium 可激活标志，
 * 导致 Windows 返回 MA_NOACTIVATEANDEAT 吃掉 mousedown、并让 forward 失效。
 * 正确做法是 focusable:true + 手动打 WS_EX_NOACTIVATE 扩展样式。
 *
 * 用法：node scripts/run-electron.cjs scripts/manual-test-noactivate.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 给窗口句柄打 WS_EX_NOACTIVATE（0x08000000），返回是否成功 */
function applyNoActivate(hwndDecimal) {
  // 一次性编译 + 复用：Add-Type 每次都要编译 C#，单次调用可能超过 20s
  const script = `
if (-not ('W.N' -as [type])) {
  Add-Type -Namespace W -Name N -MemberDefinition '
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern int SetWindowLongW(IntPtr h, int idx, int val);
  '
}
$h = [IntPtr]::new([Int64]${hwndDecimal})
$GWL_EXSTYLE = -20
$WS_EX_NOACTIVATE = 0x08000000
$ex = [W.N]::GetWindowLongW($h, $GWL_EXSTYLE)
if ($ex -eq 0) { "READ_FAIL"; exit }
[void][W.N]::SetWindowLongW($h, $GWL_EXSTYLE, ($ex -bor $WS_EX_NOACTIVATE))
$check = [W.N]::GetWindowLongW($h, $GWL_EXSTYLE)
if (($check -band $WS_EX_NOACTIVATE) -ne 0) { "OK:$check" } else { "FAIL:$check" }
`;
  const file = path.join(os.tmpdir(), "pet-noactivate.ps1");
  fs.writeFileSync(file, script, "utf8");
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      { encoding: "utf8", timeout: 60000 },
    ).trim();
  } catch (error) {
    return `ERR:${String(error).slice(0, 80)}`;
  }
}

function psMouse(action, x, y, tag) {
  const flags = { down: 0x0002, up: 0x0004 }[action];
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, System.UIntPtr e);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'
[void][W.U]::SetCursorPos(${x}, ${y})
${flags ? `[W.U]::mouse_event(${flags}, 0, 0, 0, [System.UIntPtr]::Zero)` : ""}
[W.U]::GetForegroundWindow().ToInt64()
`;
  const file = path.join(os.tmpdir(), `pet-na-${tag}.ps1`);
  fs.writeFileSync(file, script, "utf8");
  return execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
    { encoding: "utf8", timeout: 20000 },
  ).trim();
}

const X = 600;
const Y = 300;

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 300, height: 300, x: X, y: Y,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: true,   // ← 关键：必须 true，否则 forward 失效
    show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await win.loadURL(
    "data:text/html," + encodeURIComponent(`<body style="margin:0;background:transparent">
      <div style="position:absolute;inset:80px;background:#4a9eff"></div>
      <script>
        window.__moves = 0; window.__downs = 0;
        document.addEventListener('mousemove', function(){ window.__moves++; });
        document.addEventListener('pointerdown', function(){ window.__downs++; });
      </script></body>`),
  );
  win.showInactive();
  await sleep(700);

  // 给窗口打 WS_EX_NOACTIVATE，阻止点击抢焦点
  const native = win.getNativeWindowHandle();
  const hwnd = native.length >= 8
    ? native.readBigUInt64LE(0).toString()
    : String(native.readUInt32LE(0));
  const result = applyNoActivate(hwnd);
  console.log("WS_EX_NOACTIVATE:", result);

  // 设成穿透 + 转发
  win.setIgnoreMouseEvents(true, { forward: true });
  await sleep(300);

  // ① forward 的 mousemove 是否能到
  psMouse("move", X + 500, Y + 500, "a");
  await sleep(150);
  psMouse("move", X + 150, Y + 150, "b");
  await sleep(150);
  psMouse("move", X + 160, Y + 160, "c");
  await sleep(300);
  const moves = await win.webContents.executeJavaScript("window.__moves || 0");
  console.log("① forward mousemove 到达:", moves, moves > 0 ? "✓" : "✗");

  // ② 点一下，看前台窗口是否被抢
  const fgBefore = psMouse("move", X + 150, Y + 150, "d");
  win.setIgnoreMouseEvents(false);
  await sleep(200);
  const fgAfter = psMouse("down", X + 150, Y + 150, "e");
  psMouse("up", X + 150, Y + 150, "f");
  await sleep(300);
  const downs = await win.webContents.executeJavaScript("window.__downs || 0");
  console.log("② pointerdown 到达:", downs, downs > 0 ? "✓" : "✗");
  console.log("③ 点击前后前台窗口:", fgBefore, "→", fgAfter,
    fgBefore === fgAfter ? "✓ 未被抢走" : "✗ 被抢走");

  win.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("FAIL", e); app.exit(1); });
