/**
 * 用 Windows 的 WindowFromPoint 验证 setShape 区域外是否真的"不属于该窗口"。
 *
 * 这是判断穿透的权威方法：给系统一个屏幕坐标，
 * 它返回该点会命中的窗口句柄。如果返回我们窗口 → 会拦截；
 * 返回其它窗口/桌面 → 已穿透。
 *
 * 用法：node scripts/run-electron.cjs scripts/probe-setshape-hit.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

app.disableHardwareAcceleration();

/** 用 PowerShell 调 user32.WindowFromPoint，返回该点的窗口标题 + 类名 */
function windowAtPoint(x, y) {
  const ps = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
'
$p = New-Object W.U+POINT
$p.X = ${x}; $p.Y = ${y}
$h = [W.U]::WindowFromPoint($p)
$t = New-Object System.Text.StringBuilder 256
$c = New-Object System.Text.StringBuilder 256
[void][W.U]::GetWindowTextW($h, $t, 256)
[void][W.U]::GetClassNameW($h, $c, 256)
"$($h.ToInt64())|$($t.ToString())|$($c.ToString())"
`;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      timeout: 15000,
    }).trim();
    const [hwnd, title, cls] = out.split("|");
    return { hwnd, title, cls };
  } catch (error) {
    return { error: String(error).slice(0, 120) };
  }
}

app.whenReady().then(async () => {
  const WIN_X = 300;
  const WIN_Y = 200;
  const win = new BrowserWindow({
    width: 400, height: 400, x: WIN_X, y: WIN_Y,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, show: false, title: "PET_SHAPE_PROBE",
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL(
    "data:text/html," + encodeURIComponent(`<body style="margin:0;background:transparent">
      <div style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#4a9eff"></div>
    </body>`),
  );
  win.showInactive();
  await new Promise((r) => setTimeout(r, 800));

  const native = win.getNativeWindowHandle();
  const ourHwnd = native.length >= 8
    ? native.readBigUInt64LE(0).toString()
    : native.readUInt32LE(0).toString();
  console.log("桌宠窗口 HWND:", ourHwnd);

  const inside = { x: WIN_X + 200, y: WIN_Y + 200 };   // 形状内（蓝块中心）
  const outside = { x: WIN_X + 30, y: WIN_Y + 30 };    // 形状外（左上透明区）

  console.log("\n--- 未调用 setShape（整窗都可命中）---");
  console.log("  形状内:", JSON.stringify(windowAtPoint(inside.x, inside.y)));
  console.log("  形状外:", JSON.stringify(windowAtPoint(outside.x, outside.y)));

  win.setShape([{ x: 100, y: 100, width: 200, height: 200 }]);
  await new Promise((r) => setTimeout(r, 800));

  console.log("\n--- 调用 setShape 后 ---");
  const inAfter = windowAtPoint(inside.x, inside.y);
  const outAfter = windowAtPoint(outside.x, outside.y);
  console.log("  形状内:", JSON.stringify(inAfter));
  console.log("  形状外:", JSON.stringify(outAfter));

  const inHit = String(inAfter.hwnd) === String(outAfter.hwnd);
  // 形状内/外指向同一个 hwnd → 说明 setShape 没起作用；
  // 指向不同 → 形状外已经落到别的窗口（穿透成功）。
  // 注意：不能用 getNativeWindowHandle() 比较，Electron 给的是内层 Chromium 子窗，
  // 而 WindowFromPoint 拿到的是顶层宿主窗，两者本来就不相等。
  const beforeSame = String(windowAtPoint(inside.x, inside.y).hwnd) === String(windowAtPoint(outside.x, outside.y).hwnd);
  console.log("\n结论：");
  console.log("  调用 setShape 前，形状内外同属一个窗口:", beforeSame ? "是（整窗可命中，符合预期）" : "否");
  console.log("  调用 setShape 后，形状内外同属一个窗口:", inHit ? "是（未生效 ✗）" : "否（形状外已穿透 ✓）");
  console.log(
    !inHit
      ? "SETSHAPE_VERDICT_OK setShape 天然实现穿透，无需 setIgnoreMouseEvents"
      : "SETSHAPE_VERDICT_FAIL",
  );

  win.destroy();
  app.exit(0);
});
