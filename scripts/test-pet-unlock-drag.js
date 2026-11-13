/**
 * WIN+L 锁屏解锁后能否拖动（真实 SendInput，判定窗口是否真的移动）。
 *
 * 背景（实测结论）：
 * - hide→show 之后窗口表面会失效（所有像素 alpha 归零、点击全穿透），
 *   只能重建窗口；重建会闪一下，所以用 seamlessRebuild（新旧窗重叠）。
 * - 穿透用 setIgnoreMouseEvents（不用 setShape：它会让 transparent 窗口的
 *   region 内非宠物像素变成不透明，工作状态 bbox 较大时露出灰色底）。
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

/** 一次完整拖动：移到宠物 → 按下 → 分步移动 → 抬起 */
function dragScript(from, to, tag) {
  const steps = 6;
  let body = `
[void][W.U]::SetCursorPos(${from.x - 40}, ${from.y - 40})
Start-Sleep -Milliseconds 120
[void][W.U]::SetCursorPos(${from.x}, ${from.y})
Start-Sleep -Milliseconds 250
[W.U]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
`;
  for (let i = 1; i <= steps; i += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
    body += `[void][W.U]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 70
`;
  }
  body += `[W.U]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
`;
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, System.UIntPtr e);
'
${body}
`;
  const file = path.join(os.tmpdir(), `pet-ud-${tag}.ps1`);
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
    positionFile: path.join(os.tmpdir(), "pet-ud-test.json"),
  });
  const moves = [];
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  ipcMain.on("pet:drag-move", (_e, d) => {
    moves.push(d);
    c.setInteracting(true);
    c.moveBy(Number(d.dx) || 0, Number(d.dy) || 0);
  });
  ipcMain.on("pet:drag-end", () => {
    c.setInteracting(false);
    c.persistPosition();
  });
  c.setEnabled(true);
  await sleep(1800);

  /** 从当前窗口位置算宠物中心（silver-haired bbox 约 146,166 69x206） */
  function petCenter() {
    const win = c.window;
    const [x0, y0] = win.getPosition();
    return { x: Math.round(x0 + 146 + 34), y: Math.round(y0 + 166 + 100) };
  }

  async function tryDrag(tag) {
    const win = c.window;
    const before = win.getPosition();
    const from = petCenter();
    const to = { x: from.x + 70, y: from.y + 50 };
    const movesBefore = moves.length;
    dragScript(from, to, tag);
    await sleep(500);
    const after = win.getPosition();
    const moved = after[0] !== before[0] || after[1] !== before[1];
    return { moved, moves: moves.length - movesBefore, before, after };
  }

  const r1 = await tryDrag("a");
  console.log("① 锁屏前拖动:", JSON.stringify(r1));
  assert.ok(r1.moved, "锁屏前应能拖动");

  // 模拟 WIN+L：hide → show（show 会自动无缝重建）
  const winBefore = c.window;
  c.hide();
  await sleep(700);
  c.window.showInactive();
  await sleep(2600);
  assert.notStrictEqual(c.window, winBefore, "hide→show 后应重建窗口");

  const r2 = await tryDrag("b");
  console.log("② 解锁后拖动:", JSON.stringify(r2));
  assert.ok(r2.moved, "解锁后必须仍能拖动");

  // 再来一轮，确认稳定
  const winSecond = c.window;
  c.hide();
  await sleep(700);
  c.window.showInactive();
  await sleep(2600);
  const r3 = await tryDrag("c");
  console.log("③ 第二次解锁拖动:", JSON.stringify(r3));
  assert.ok(r3.moved, "第二次解锁也必须能拖动");
  assert.notStrictEqual(c.window, winSecond, "第二次也应重建");

  console.log("PET_UNLOCK_DRAG_TEST_OK");
  c.destroy();
  await sleep(200);
  app.exit(0);
}).catch((e) => { console.error("PET_UNLOCK_DRAG_FAILED", e); app.exit(1); });
