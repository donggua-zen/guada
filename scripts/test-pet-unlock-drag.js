/**
 * WIN+L 锁屏解锁的真实回归测试（网格真实点击）。
 *
 * 实测结论：hide→show 之后窗口表面失效（所有像素 alpha=0，点击全穿透），
 * setShape / setAlwaysOnTop / setFocusable / setIgnoreMouseEvents 都救不回，
 * 只有「重建窗口」能恢复。因此解锁走 seamlessRebuild（新旧窗重叠，无白帧）。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-unlock-drag.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clickGrid(pts, tag) {
  const body = pts
    .map(
      ([x, y]) => `
[void][W.U]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 55
[W.U]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 45
[W.U]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
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
  const file = path.join(os.tmpdir(), `pet-ul-${tag}.ps1`);
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
    positionFile: path.join(os.tmpdir(), "pet-ul-test.json"),
  });
  let downs = 0;
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  ipcMain.on("pet:debug-pointer", () => { downs += 1; });
  c.setEnabled(true);
  await sleep(1800);

  // 用当前形状做网格（形状随形象/缩放变化，从 debugState 里读不到 rects，
  // 这里覆盖画布中心区域即可：silver-haired 的 bbox 约 146,166 69x206）
  function gridPoints() {
    const win = c.window;
    const [x0, y0] = win.getPosition();
    const pts = [];
    const shape = { x: 146, y: 166, w: 69, h: 206 };
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

  async function measure(label) {
    const before = downs;
    clickGrid(gridPoints(), label);
    await sleep(350);
    return downs - before;
  }

  const m1 = await measure("a");
  console.log("① 锁屏前命中:", m1, "/15");
  assert.ok(m1 > 0, "初始应能点击");

  // 模拟 WIN+L：hide → show（show 会自动触发无缝重建）
  const winBefore = c.window;
  c.hide();
  await sleep(700);
  c.window.showInactive();
  await sleep(2600);  // 等无缝重建完成

  assert.notStrictEqual(c.window, winBefore, "hide→show 后应重建窗口（否则表面失效点不动）");
  console.log("② 已无缝重建:", !winBefore.isDestroyed() ? "旧窗仍在（异常）" : "旧窗已销毁 ✓");

  const m2 = await measure("b");
  console.log("③ 解锁后命中:", m2, "/15");
  assert.ok(m2 > 0, `解锁后必须仍可点击拖动（实际 ${m2}/15）`);

  // 再锁一次，确认稳定（不无限递归重建）
  const winSecond = c.window;
  c.hide();
  await sleep(700);
  c.window.showInactive();
  await sleep(2600);
  const m3 = await measure("c");
  console.log("④ 第二次解锁命中:", m3, "/15", "| 重建是否有限:", c.window !== winSecond ? "是" : "否");
  assert.ok(m3 > 0, "第二次解锁也必须可点");
  assert.notStrictEqual(c.window, winSecond, "第二次也应重建");

  console.log("PET_UNLOCK_DRAG_TEST_OK");
  c.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("PET_UNLOCK_DRAG_FAILED", e); app.exit(1); });
