/**
 * 真实输入端到端：用 Windows SendInput 物理点击/拖动桌宠，验证
 *  ① pointerdown 能进渲染层   ② 窗口真的跟着移动
 *
 * 这是唯一可信的验证方式 —— 合成事件绕过 OS 命中测试，测不出
 * focusable:false / WS_EX_NOACTIVATE 吃 mousedown 这类问题。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-real-drag.js
 */
const { app, ipcMain, screen } = require("electron");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { PetWindowController, resolvePetUiHtmlPath } = require("../electron/dist/pet-window.js");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 用 SendInput 做真实鼠标按下/移动/抬起（写 .ps1 再执行：inline -Command 会静默失败） */
function sendMouse(action, x, y) {
  const flags = {
    down: 0x0002,     // LEFTDOWN
    up: 0x0004,       // LEFTUP
    move: 0x0001,     // MOVE
  }[action];
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, System.UIntPtr e);
'
[void][W.U]::SetCursorPos(${x}, ${y})
${flags ? `[W.U]::mouse_event(${flags}, 0, 0, 0, [System.UIntPtr]::Zero)` : ""}
`;
  const file = path.join(os.tmpdir(), "pet-mouse.ps1");
  require("node:fs").writeFileSync(file, script, "utf8");
  execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
    { timeout: 20000 },
  );
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const c = new PetWindowController({
    petsRoots: [{ dir: path.join(ROOT, "build-resources", "pets"), source: "bundled" }],
    uiHtmlPath: resolvePetUiHtmlPath(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    avatarId: "silver-haired",
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile: path.join(os.tmpdir(), "pet-realdrag-test.json"),
  });
  let pointerDowns = 0;
  const dragMoves = [];
  ipcMain.on("pet:ready", () => c.onRendererReady());
  ipcMain.on("pet:hit-geometry", (_e, g) => c.setHitGeometry(g));
  ipcMain.on("pet:hit-heartbeat", () => c.noteHitHeartbeat());
  ipcMain.on("pet:hit-leave", () => c.clearHitHeartbeat());
  ipcMain.on("pet:debug-pointer", () => { pointerDowns += 1; });
  // 真实主进程行为：收到 drag-move 就 setInteracting + moveBy
  ipcMain.on("pet:drag-move", (_e, d) => {
    dragMoves.push(d);
    c.setInteracting(true);
    c.moveBy(Number(d.dx) || 0, Number(d.dy) || 0);
  });
  ipcMain.on("pet:drag-end", () => c.setInteracting(false));
  c.setEnabled(true);
  await sleep(1500);

  const win = c.window;
  assert.ok(win && !win.isDestroyed());
  const [x0, y0] = win.getPosition();

  // 宠物中心（窗口内约 180, 240）
  const petCenter = { x: x0 + 180, y: y0 + 240 };
  const before = win.getPosition();
  console.log("窗口起始位置:", before, "| 点击目标:", petCenter);

  // 真实按下 → 移动 → 抬起
  sendMouse("move", petCenter.x, petCenter.y);
  await sleep(120);
  sendMouse("down", petCenter.x, petCenter.y);
  await sleep(120);
  for (let i = 1; i <= 5; i += 1) {
    sendMouse("move", petCenter.x + i * 12, petCenter.y + i * 8);
    await sleep(60);
  }
  sendMouse("up", petCenter.x + 60, petCenter.y + 40);
  await sleep(300);

  const after = win.getPosition();
  console.log("pointerdown 到达渲染层:", pointerDowns, "次");
  console.log("drag-move IPC:", dragMoves.length, "次");
  console.log("窗口最终位置:", after);

  assert.ok(pointerDowns >= 1, `真实点击必须能进渲染层（实际 ${pointerDowns}）`);
  assert.ok(dragMoves.length >= 1, `真实拖动必须产生 drag-move（实际 ${dragMoves.length}）`);
  assert.notDeepStrictEqual(after, before, "窗口必须真的移动");
  console.log("PET_REALDRAG_OK basic-drag");

  // ── 决定性实验：setShape 裁剪之后，真实点击还能不能进来？ ──
  // 这正是「锁屏解锁后拖不动」的核心怀疑点：unlock 会重算形状。
  c.setInteracting(false);
  await sleep(200);
  const posBeforeShape = win.getPosition();
  const centerAfter = {
    x: posBeforeShape[0] + 180,
    y: posBeforeShape[1] + 240,
  };
  const downsBefore = pointerDowns;
  const movesBefore = dragMoves.length;

  sendMouse("move", centerAfter.x, centerAfter.y);
  await sleep(120);
  sendMouse("down", centerAfter.x, centerAfter.y);
  await sleep(120);
  for (let i = 1; i <= 4; i += 1) {
    sendMouse("move", centerAfter.x + i * 10, centerAfter.y + i * 6);
    await sleep(60);
  }
  sendMouse("up", centerAfter.x + 40, centerAfter.y + 24);
  await sleep(300);

  console.log(
    "形状生效后：新增 pointerdown",
    pointerDowns - downsBefore,
    "| 新增 drag-move",
    dragMoves.length - movesBefore,
  );
  assert.ok(
    pointerDowns > downsBefore,
    "setShape 裁剪后，形状内的真实点击必须仍能进渲染层",
  );
  assert.ok(
    dragMoves.length > movesBefore,
    "setShape 裁剪后，拖动必须仍能产生 drag-move",
  );
  console.log("PET_REALDRAG_OK drag-after-setshape");

  // ── 模拟锁屏解锁：rearmInput 之后仍要能拖 ──
  c.onSystemResume();
  await sleep(200);
  const posBeforeResume = win.getPosition();
  const downsBeforeResume = pointerDowns;
  sendMouse("move", posBeforeResume[0] + 180, posBeforeResume[1] + 240);
  await sleep(120);
  sendMouse("down", posBeforeResume[0] + 180, posBeforeResume[1] + 240);
  await sleep(120);
  for (let i = 1; i <= 4; i += 1) {
    sendMouse("move", posBeforeResume[0] + 180 + i * 10, posBeforeResume[1] + 240 + i * 6);
    await sleep(60);
  }
  sendMouse("up", posBeforeResume[0] + 220, posBeforeResume[1] + 264);
  await sleep(300);
  console.log("解锁恢复后：新增 pointerdown", pointerDowns - downsBeforeResume);
  assert.ok(pointerDowns > downsBeforeResume, "解锁恢复后仍必须能点击拖动");
  console.log("PET_REALDRAG_OK drag-after-resume");

  console.log("PET_REALDRAG_TEST_OK");

  c.destroy();
  app.exit(0);
}).catch((error) => {
  console.error("PET_REALDRAG_FAILED", error);
  try { app.exit(1); } catch { /* ignore */ }
});
