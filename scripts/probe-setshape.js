/**
 * 验证 Electron setShape(rects) 在 Windows 透明置顶窗上的行为。
 *
 * 如果可行，就把「setIgnoreMouseEvents + forward 转发」整套换掉：
 * 窗口形状之外不属于该窗口，鼠标事件直接落到下层，不存在锁屏后
 * forward 失效的问题（这也是 Qoder 不用 setIgnoreMouseEvents 的原因）。
 *
 * 用法：node scripts/run-electron.cjs scripts/probe-setshape.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400, height: 400, x: 100, y: 100,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, show: false,
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL(
    "data:text/html," +
      encodeURIComponent(`<body style="margin:0;background:transparent">
        <div style="position:absolute;left:100px;top:100px;width:200px;height:200px;
                    background:rgba(64,158,255,0.85);border-radius:12px"></div>
      </body>`),
  );
  win.showInactive();
  await new Promise((r) => setTimeout(r, 500));

  console.log("setShape 是否存在:", typeof win.setShape);

  // 把窗口形状裁成一个 200×200 的方块（覆盖蓝块），其余部分不属于该窗口
  try {
    win.setShape([{ x: 100, y: 100, width: 200, height: 200 }]);
    console.log("setShape 调用成功");
  } catch (error) {
    console.log("setShape 调用失败:", error.message);
    app.exit(1);
    return;
  }

  await new Promise((r) => setTimeout(r, 500));
  const bounds = win.getBounds();
  console.log("窗口 bounds:", JSON.stringify(bounds));
  console.log("期望：屏幕上只剩 200×200 的蓝块，四周完全透明且点击可穿透到桌面");

  // 截图留证（capturePage 只反映页面内容，看不到形状裁剪；
  // 所以再用 desktopCapturer 抓全屏看实际效果）
  const { desktopCapturer, screen } = require("electron");
  try {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: display.size.width, height: display.size.height },
    });
    const fs = require("node:fs");
    const os = require("node:os");
    if (sources[0]) {
      fs.writeFileSync(
        path.join(os.tmpdir(), "setshape-demo.png"),
        sources[0].thumbnail.toPNG(),
      );
      console.log("全屏截图已保存: setshape-demo.png");
    }
  } catch (error) {
    console.log("截图失败（不影响结论）:", error.message);
  }

  // 再测一次动态更新（模拟动画 bbox 变化）
  try {
    win.setShape([{ x: 60, y: 60, width: 280, height: 280 }]);
    console.log("动态更新 setShape 成功");
  } catch (error) {
    console.log("动态更新失败:", error.message);
  }

  await new Promise((r) => setTimeout(r, 800));
  win.destroy();
  console.log("PROBE_SETSHAPE_DONE");
  app.exit(0);
});
