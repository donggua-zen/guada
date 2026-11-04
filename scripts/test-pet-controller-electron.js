/**
 * PetWindowController 冒烟测试：验证真实控制器（而非裸 BrowserWindow）
 *
 * 覆盖：
 * 1. ensureWindow 用真实素材目录建窗（resolvePetAssetDir 的 dev 分支）
 * 2. pushConfig/pushState/pushSettings 能驱动渲染层（idle → walk → run → yawn）
 * 3. setEnabled(true/false) 的显隐、位置落盘
 * 4. 四种模式的截图非空且透明区域占比合理
 *
 * 用法：electron scripts/test-pet-controller-electron.js
 */
const { app, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");
const {
  PetWindowController,
  resolvePetsRootDir,
  PET_AVATAR_DEFAULT,
  PET_WINDOW_WIDTH,
} = require(path.join(ROOT, "electron", "dist", "pet-window.js"));
const OUT_DIR = path.join(os.tmpdir(), "pet-controller-smoke");

app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 临时形象根目录：放两份素材（默认 + 一个假形象），用来验证「切换形象」。
  // 真实仓库里只有一个形象，没法直接测这条路径。
  const petsRoot = path.join(OUT_DIR, "pets");
  fs.rmSync(petsRoot, { recursive: true, force: true });
  fs.mkdirSync(petsRoot, { recursive: true });
  const realAvatarDir = path.join(
    resolvePetsRootDir(true, path.join(ROOT, "electron", "dist"), process.resourcesPath),
    PET_AVATAR_DEFAULT,
  );
  fs.cpSync(realAvatarDir, path.join(petsRoot, PET_AVATAR_DEFAULT), { recursive: true });
  fs.cpSync(realAvatarDir, path.join(petsRoot, "alt-avatar"), { recursive: true });

  const positionFile = path.join(OUT_DIR, "pet-window.json");
  const controller = new PetWindowController({
    petsRootDir: petsRoot,
    avatarId: PET_AVATAR_DEFAULT,
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile,
  });

  // 控制器内部通过 ipcMain.on 之外的方式收 ready；这里手动桥接
  let readyCount = 0;
  /** 最近一次上报的命中几何（用于断言不同动画的紧包围盒宽度不同） */
  let lastGeometry = null;
  ipcMain.on("pet:ready", () => {
    readyCount += 1;
    controller.onRendererReady();
  });
  ipcMain.on("pet:hit-geometry", (_e, geometry) => {
    if (geometry && typeof geometry === "object") {
      lastGeometry = geometry;
      controller.setHitGeometry(geometry);
    }
  });

  controller.setOpacity(100);
  controller.setEnabled(true);

  const win = controller.window;
  assert.ok(win && !win.isDestroyed(), "setEnabled(true) 应创建窗口");
  assert.ok(win.isVisible(), "setEnabled(true) 后窗口应可见");
  console.log("PET_CTRL_OK window-created", JSON.stringify(win.getBounds()));

  // 等首帧 + idle 动画起步
  await sleep(1200);
  assert.ok(readyCount >= 1, "渲染层应发出 pet:ready");
  console.log("PET_CTRL_OK renderer-ready");

  const modes = ["idle", "walk", "run", "yawn"];
  /** 各模式上报的命中矩形宽度（验证紧包围盒随动画变化，而不是四段并集） */
  const hitWidths = {};
  for (const mode of modes) {
    controller.pushState({
      mode,
      running: mode === "run" ? 2 : mode === "walk" ? 1 : 0,
      unread: 0,
      title: "桌面宠物联调",
      toolLabel: mode === "walk" ? "edit" : "read_file",
      sessionId: "smoke",
    });
    await sleep(700);

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    let opaque = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      if (bitmap[i + 3] > 16) opaque += 1;
    }
    const ratio = opaque / (width * height);

    assert.ok(png.length > 2000, `${mode}: 截图应有内容`);
    assert.ok(ratio > 0.05 && ratio < 0.85, `${mode}: 透明占比异常 ${(ratio * 100).toFixed(1)}%`);
    fs.writeFileSync(path.join(OUT_DIR, `pet-${mode}.png`), png);

    const domMode = await win.webContents.executeJavaScript(
      "document.getElementById('pet').dataset.mode",
    );
    assert.ok(lastGeometry, `${mode}: 应上报命中几何`);
    hitWidths[mode] = lastGeometry.image.w;
    console.log(
      `PET_CTRL_OK ${mode} domMode=${domMode} hitW=${lastGeometry.image.w} opaque=${(ratio * 100).toFixed(1)}%`,
    );
  }

  // 紧包围盒：run（手臂张开）必须明显宽于 idle（贴身站立）。
  // 若仍用四段并集，这里两者会相等——正是「透明区域挡住桌面」的根因。
  assert.ok(
    hitWidths.run > hitWidths.idle + 30,
    `run 命中宽度应显著大于 idle（run=${hitWidths.run} idle=${hitWidths.idle}），否则说明用的是并集包围盒`,
  );
  console.log("PET_CTRL_OK hit-width-per-animation", JSON.stringify(hitWidths));

  // 长空闲哈欠：单次播完回 idle；状态重复推 yawn 不应重播
  // yawn 37 帧 @8fps ≈ 4.6s，留 6s 余量
  controller.pushState({
    mode: "yawn", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null,
  });
  await sleep(6000);
  let domMode = await win.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(domMode, "idle", `哈欠播完应回 idle，实际 ${domMode}`);
  console.log("PET_CTRL_OK yawn-finished-back-to-idle");

  // 重复推 yawn（模拟 2s 轮询）→ 不应重播
  controller.pushState({
    mode: "yawn", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null,
  });
  await sleep(600);
  domMode = await win.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(domMode, "idle", `重复 yawn 不应重播，实际 ${domMode}`);
  console.log("PET_CTRL_OK yawn-not-replayed");

  // 来了任务再回到长空闲 → 允许再打一次
  controller.pushState({
    mode: "walk", running: 1, unread: 0, title: "有任务了", toolLabel: "edit", sessionId: "s",
  });
  await sleep(400);
  controller.pushState({
    mode: "yawn", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null,
  });
  await sleep(600);
  domMode = await win.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(domMode, "yawn", `任务过后应可再打一次哈欠，实际 ${domMode}`);
  console.log("PET_CTRL_OK yawn-allowed-again-after-task");

  // 移动 + 落盘（默认落在右下角，向右下会被夹回去 → 向左上移动）
  const before = win.getPosition();
  controller.moveBy(-30, -20);
  controller.persistPosition();
  const after = win.getPosition();
  assert.ok(after[0] !== before[0] || after[1] !== before[1], "moveBy 应改变窗口位置");
  const saved = JSON.parse(fs.readFileSync(positionFile, "utf8"));
  assert.strictEqual(saved.x, after[0], "落盘 x 应与窗口一致");
  assert.strictEqual(saved.y, after[1], "落盘 y 应与窗口一致");
  assert.ok(saved.box && saved.box.w > 0 && saved.box.h > 0, "应同时落盘立绘矩形");
  console.log("PET_CTRL_OK move+persist", JSON.stringify({ x: saved.x, y: saved.y, box: saved.box }));

  // ── 贴边：窗口可以溢出屏幕，只要立绘不出屏 ────────────────
  // 回归点：早先按「整个窗口」夹取，280px 窗口里有 100px 是透明边，
  // 宠物永远离屏幕右缘 ~100px，拖到边上会弹回来。
  const { screen } = require("electron");
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(area.x + area.width - 40, win.getPosition()[1]);
  controller.persistPosition();
  await sleep(150);
  const [edgeX] = win.getPosition();
  const box = lastGeometry.image;
  assert.ok(
    edgeX + PET_WINDOW_WIDTH > area.x + area.width,
    `贴右边缘时窗口应溢出屏幕（x=${edgeX}，屏右=${area.x + area.width}）`,
  );
  assert.ok(
    edgeX + box.x + box.w <= area.x + area.width + 1,
    "立绘右边缘不应超出屏幕",
  );
  const savedEdge = JSON.parse(fs.readFileSync(positionFile, "utf8"));
  assert.strictEqual(savedEdge.x, edgeX, "贴边位置应落盘");
  console.log(
    `PET_CTRL_OK edge-tuck windowRight=${edgeX + PET_WINDOW_WIDTH} screenRight=${area.x + area.width}`,
  );

  // 重启恢复：新控制器必须按落盘位置还原贴边，而不是被整窗夹回屏幕内
  const restarted = new PetWindowController({
    petsRootDir: petsRoot,
    avatarId: PET_AVATAR_DEFAULT,
    preloadPath: path.join(ROOT, "electron", "dist", "pet-preload.js"),
    positionFile,
  });
  restarted.setEnabled(true);
  await sleep(500);
  assert.strictEqual(
    restarted.window.getPosition()[0],
    edgeX,
    "重启后应恢复贴边位置（落盘要带立绘矩形）",
  );
  console.log("PET_CTRL_OK restore-edge-tuck", edgeX);
  restarted.destroy();

  // 关闭开关 → 隐藏且停表
  controller.setEnabled(false);
  await sleep(120);
  assert.strictEqual(win.isVisible(), false, "关闭后窗口应隐藏");
  console.log("PET_CTRL_OK disabled");

  // 再次开启 → 秒开（复用实例）
  controller.setEnabled(true);
  await sleep(300);
  assert.strictEqual(win.isVisible(), true, "重新开启应立刻可见");
  console.log("PET_CTRL_OK re-enabled");

  // ── 切换形象 ──────────────────────────────────────────────
  const winBefore = controller.window;
  controller.setAvatar(PET_AVATAR_DEFAULT);
  assert.strictEqual(controller.window, winBefore, "同形象不应重建窗口");

  controller.setAvatar("alt-avatar");
  await sleep(900);
  assert.strictEqual(controller.getAvatarId(), "alt-avatar", "形象 id 应更新");
  const winAfter = controller.window;
  assert.ok(winAfter && !winAfter.isDestroyed(), "切换形象后应重建窗口");
  assert.notStrictEqual(winAfter, winBefore, "切换形象应换一个窗口实例");
  assert.strictEqual(winAfter.isVisible(), true, "切换后应保持可见（沿用开关状态）");
  const altMode = await winAfter.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.ok(altMode, `新形象应正常渲染动画，实际 mode=${altMode}`);
  console.log("PET_CTRL_OK avatar-switch", controller.getAvatarId());

  // 非法 id（路径穿越）→ 回落默认形象，不崩
  controller.setAvatar("../../evil");
  await sleep(700);
  assert.strictEqual(
    controller.getAvatarId(),
    PET_AVATAR_DEFAULT,
    "非法形象 id 应回落默认形象",
  );
  console.log("PET_CTRL_OK avatar-invalid-fallback");

  controller.destroy();
  console.log("PET_CONTROLLER_TEST_OK");
  app.exit(0);
}).catch((error) => {
  console.error("PET_CONTROLLER_TEST_FAILED", error);
  app.exit(1);
});
