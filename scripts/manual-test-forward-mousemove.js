/**
 * 验证 forward:true 转发的 mousemove 能否到达渲染层 —— 分 focusable 两种。
 *
 * 若 focusable:false 时收不到，就解释了：
 *   heartbeatAgeMs = -1（心跳从未上报）
 *   → 光标进入宠物时无法靠心跳放开穿透
 *   → 只能靠主进程算 bbox，geometry 稍有偏差就一直穿透 → 拖不动
 *
 * 真实移动光标（SetCursorPos），不按下，不干扰用户太多。
 * 用法：node scripts/run-electron.cjs scripts/manual-test-forward-mousemove.js
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
  const file = path.join(os.tmpdir(), `pet-fwd-${tag}.ps1`);
  fs.writeFileSync(file, script, "utf8");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
    timeout: 20000,
  });
}

const X = 600;
const Y = 300;

async function trial(focusable, tag) {
  const win = new BrowserWindow({
    width: 300, height: 300, x: X, y: Y,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable, show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await win.loadURL(
    "data:text/html," + encodeURIComponent(`<body style="margin:0;background:transparent">
      <div style="position:absolute;inset:80px;background:#4a9eff"></div>
      <script>
        window.__moves = 0;
        document.addEventListener('mousemove', function(){ window.__moves++; });
      </script></body>`),
  );
  win.showInactive();
  await sleep(700);
  // 关键：设成穿透 + 转发
  win.setIgnoreMouseEvents(true, { forward: true });
  await sleep(300);

  // 光标先移开，再移到窗口中心（产生真实 mousemove）
  moveTo(X + 500, Y + 500, tag + "a");
  await sleep(200);
  moveTo(X + 150, Y + 150, tag + "b");
  await sleep(200);
  moveTo(X + 160, Y + 160, tag + "c");
  await sleep(400);

  const moves = await win.webContents.executeJavaScript("window.__moves || 0");
  win.destroy();
  await sleep(250);
  return moves;
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const off = await trial(false, "off");
  console.log(`focusable=false + forward:true → 渲染层收到 mousemove: ${off}`);

  const on = await trial(true, "on");
  console.log(`focusable=true  + forward:true → 渲染层收到 mousemove: ${on}`);

  console.log("\n结论：");
  console.log("  focusable=false 下 forward 是否可用:", off > 0 ? "可用" : "不可用 ✗");
  console.log("  focusable=true  下 forward 是否可用:", on > 0 ? "可用" : "不可用");
  await sleep(300);
  app.exit(0);
}).catch((e) => { console.error("FAIL", e); app.exit(1); });
