/**
 * 验证 forward:true 转发到渲染层的 mousemove，其 clientX/clientY
 * 到底是「窗口内坐标」还是「屏幕坐标」。
 *
 * 若是屏幕坐标，reportHitAt 用 clientX/clientY 与窗口内 bbox 比较就永远 miss
 * → 永远不放开穿透 → pointerdown 进不来 → 拖不动（且 moveIgnored 一直涨）。
 *
 * 用法：node scripts/run-electron.cjs scripts/manual-test-forward-coords.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function moveTo(x, y, tag) {
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
'
[void][W.U]::SetCursorPos(${x}, ${y})
`;
  const file = path.join(os.tmpdir(), `pet-coord-${tag}.ps1`);
  fs.writeFileSync(file, script, "utf8");
  execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
    { timeout: 20000 },
  );
}

const X = 700;
const Y = 350;

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 380, x: X, y: Y,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: true, show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await win.loadURL(
    "data:text/html," + encodeURIComponent(`<body style="margin:0;background:transparent">
      <div style="position:absolute;left:125px;top:165px;width:108px;height:203px;background:#4a9eff"></div>
      <script>
        window.__last = null; window.__count = 0;
        document.addEventListener('mousemove', function (e) {
          window.__count++;
          window.__last = {
            clientX: Math.round(e.clientX), clientY: Math.round(e.clientY),
            screenX: Math.round(e.screenX), screenY: Math.round(e.screenY),
            offsetX: Math.round(e.offsetX), offsetY: Math.round(e.offsetY),
          };
        });
      </script></body>`),
  );
  win.showInactive();
  await sleep(700);
  // 先把光标移远，再设穿透，再进入窗口（顺序与之前成功的测试一致）
  moveTo(X + 500, Y + 500, "pre");
  await sleep(200);
  win.setIgnoreMouseEvents(true, { forward: true });
  await sleep(400);

  // 把光标移到窗口内「蓝块中心」：窗口坐标 (179, 266) → 屏幕 (X+179, Y+266)
  const targetScreen = { x: X + 179, y: Y + 266 };
  moveTo(targetScreen.x - 100, targetScreen.y - 100, "a");
  await sleep(150);
  moveTo(targetScreen.x, targetScreen.y, "b");
  await sleep(150);
  moveTo(targetScreen.x + 2, targetScreen.y + 2, "c");
  await sleep(400);

  const res = await win.webContents.executeJavaScript(
    "JSON.stringify({count: window.__count, last: window.__last})",
  );
  console.log("窗口位置:", X, Y);
  console.log("目标屏幕坐标:", targetScreen.x, targetScreen.y, "→ 期望 clientX/Y ≈ 179, 266");
  console.log("渲染层收到:", res);

  const d = JSON.parse(res);
  if (d.last) {
    const isClient = Math.abs(d.last.clientX - 179) < 5 && Math.abs(d.last.clientY - 266) < 5;
    const isScreen = Math.abs(d.last.clientX - targetScreen.x) < 5;
    console.log("\n结论：clientX/clientY",
      isClient ? "是窗口内坐标 ✓（reportHitAt 逻辑正确）" :
      isScreen ? "是屏幕坐标 ✗（这就是 miss 的原因！）" :
      `两者都不是（client=${d.last.clientX},${d.last.clientY}）`);
  } else {
    console.log("\n没有收到任何 mousemove");
  }

  win.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("FAIL", e); app.exit(1); });
