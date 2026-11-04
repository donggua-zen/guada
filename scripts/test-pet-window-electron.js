/**
 * 桌宠窗口冒烟测试（独立 Electron 进程，不启动后端/主窗口）
 *
 * 验证四件事：
 * 1. pet.html 能被 loadFile 加载（file:// 下 sprites.json 由主进程读盘下发）
 * 2. 渲染层收到的配置能驱动 idle 动画（截图非空且透明区域占比合理）
 * 3. 命中几何上报链路（pet:hit-geometry）能走通，且紧包围盒显著窄于图片
 * 4. 穿透开关（setIgnoreMouseEvents）被正确调用
 *
 * 用法：electron scripts/test-pet-window-electron.js
 */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");
const ASSET_DIR = path.join(ROOT, "build-resources", "pets", "silver-haired");
const PRELOAD = path.join(ROOT, "electron", "dist", "pet-preload.js");
const { PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT } = require(
  path.join(ROOT, "electron", "dist", "pet-window.js"),
);
const OUT_DIR = path.join(os.tmpdir(), "pet-smoke");

const IGNORE_CALLS = [];
let hitGeometry = null;
let rendererReady = false;
/** 拖动链路收到的 IPC（用于断言「拖的是窗口」而不是原生拖图片） */
const DRAG_EVENTS = [];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    x: 40,
    y: 40,
    transparent: true,
    frame: false,
    show: false,
    focusable: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 记录穿透调用（Electron 内部无公开读回接口，只能包裹监听）
  const originalSetIgnore = win.setIgnoreMouseEvents.bind(win);
  win.setIgnoreMouseEvents = (ignore, opts) => {
    IGNORE_CALLS.push({ ignore, forward: Boolean(opts && opts.forward) });
    return originalSetIgnore(ignore, opts);
  };

  ipcMain.on("pet:ready", () => {
    rendererReady = true;
    win.webContents.send("pet:config", fs.readFileSync(path.join(ASSET_DIR, "sprites.json"), "utf8"));
    win.webContents.send("pet:settings", { opacity: 100 });
    win.webContents.send("pet:state", {
      mode: "walk",
      running: 1,
      unread: 0,
      title: "重构登录模块",
      toolLabel: "edit",
      sessionId: "smoke-session",
    });
  });

  ipcMain.on("pet:hit-geometry", (_e, geometry) => {
    hitGeometry = geometry;
  });

  ipcMain.on("pet:drag-move", (_e, delta) => {
    DRAG_EVENTS.push({ type: "move", ...delta });
  });
  ipcMain.on("pet:drag-end", () => {
    DRAG_EVENTS.push({ type: "end" });
  });

  await win.loadFile(path.join(ASSET_DIR, "pet.html"));
  win.showInactive();
  win.setIgnoreMouseEvents(true, { forward: true });

  // 等首帧 + 图片解码 + 至少一轮动画推进
  await new Promise((r) => setTimeout(r, 1500));

  assert.ok(rendererReady, "渲染层应发出 pet:ready");
  console.log("PET_E2E_OK renderer-ready");

  // 命中几何：图片紧包围盒 + 气泡矩形，都在窗口内
  assert.ok(hitGeometry && hitGeometry.image, "应收到 pet:hit-geometry");
  assert.ok(
    hitGeometry.image.w > 0 && hitGeometry.image.h > 0,
    `图片矩形应有效: ${JSON.stringify(hitGeometry.image)}`,
  );
  assert.ok(
    hitGeometry.image.x >= 0 && hitGeometry.image.y >= 0,
    `图片矩形应在窗口内: ${JSON.stringify(hitGeometry.image)}`,
  );
  assert.ok(hitGeometry.bubble, "有任务时气泡矩形应存在");
  console.log("PET_E2E_OK hit-geometry", JSON.stringify(hitGeometry));

  // 紧包围盒必须比整张图片窄：立绘四周是透明的，用整图矩形会挡住桌面点击
  const imgRect = await win.webContents.executeJavaScript(
    "JSON.stringify(document.getElementById('pet').getBoundingClientRect())",
  );
  const imgBox = JSON.parse(imgRect);
  assert.ok(
    hitGeometry.image.w < imgBox.width - 20,
    `命中矩形应显著窄于图片宽度（${hitGeometry.image.w} vs ${imgBox.width}），否则透明区会挡桌面`,
  );
  console.log(
    `PET_E2E_OK bbox-tighter width ${hitGeometry.image.w} < image ${Math.round(imgBox.width)}`,
  );

  // 截图：透明底 + 有实际像素（动画在跑）
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  assert.ok(png.length > 2000, `截图应有内容，实际 ${png.length} bytes`);
  fs.writeFileSync(path.join(OUT_DIR, "pet-walk.png"), png);

  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA
  let opaque = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i + 3] > 16) opaque += 1;
  }
  const ratio = opaque / (width * height);
  assert.ok(ratio > 0.02, `应有可见像素（透明底未铺满），实际占比 ${(ratio * 100).toFixed(1)}%`);
  assert.ok(ratio < 0.75, `不应整窗不透明，实际占比 ${(ratio * 100).toFixed(1)}%`);
  console.log(`PET_E2E_OK capture ${width}x${height} opaque=${(ratio * 100).toFixed(1)}%`);

  // 命中区对齐校验：可见像素必须全部落在「宠物矩形 ∪ 气泡矩形」内。
  // 矩形算偏（错位/少算一块）会立刻表现为外面漏出可见像素。
  //
  // 两点校准：
  // 1. 阈值取 alpha > 128 而非 > 16 —— .stage 上的 drop-shadow 会向外晕开
  //    一圈半透明像素（alpha ≤ ~76），那是美术效果，不属于「漏判」；
  // 2. 不要求矩形内填充率高：人形立绘的包围盒天然只有约 40% 有像素。
  const rects = [hitGeometry.image];
  if (hitGeometry.bubble) rects.push(hitGeometry.bubble);
  let insideOpaque = 0;
  let insideTotal = 0;
  let outsideOpaque = 0;
  let outsideTotal = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = bitmap[(y * width + x) * 4 + 3];
      const inRect = rects.some(
        (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
      );
      if (inRect) {
        insideTotal += 1;
        if (alpha > 128) insideOpaque += 1;
      } else {
        outsideTotal += 1;
        if (alpha > 128) outsideOpaque += 1;
      }
    }
  }
  const insideRatio = insideOpaque / insideTotal;
  const outsideRatio = outsideOpaque / outsideTotal;
  assert.ok(
    insideRatio > 0.2,
    `命中区应覆盖立绘主体，实际填充率 ${(insideRatio * 100).toFixed(1)}%`,
  );
  assert.strictEqual(
    outsideOpaque,
    0,
    `命中区外不应有实心像素（矩形算偏了），实际 ${outsideOpaque} px`,
  );
  console.log(
    `PET_E2E_OK hit-region-alignment inside=${(insideRatio * 100).toFixed(1)}% outsideSolid=${outsideOpaque}px`,
  );

  // ── 气泡让路：窗口贴边时气泡横向偏移，而不是把窗口推回屏幕 ──
  // 模拟「窗口右侧有 90px 在屏幕外」：可见区间 = [0, 190]
  win.webContents.send("pet:clip", { left: 0, right: 190 });
  await new Promise((r) => setTimeout(r, 200));
  const clippedBubble = JSON.parse(
    await win.webContents.executeJavaScript(
      "JSON.stringify(document.getElementById('bubble').getBoundingClientRect())",
    ),
  );
  assert.ok(
    clippedBubble.right <= 191,
    `气泡右边缘应落在可见区内（right=${clippedBubble.right}）`,
  );
  assert.ok(clippedBubble.left >= -1, `气泡左边缘不应出屏（left=${clippedBubble.left}）`);
  assert.ok(
    clippedBubble.width <= 191,
    `气泡应收窄到可见宽度内（w=${clippedBubble.width}）`,
  );
  const bubbleStyleLeft = await win.webContents.executeJavaScript(
    "document.getElementById('bubble').style.left",
  );
  assert.ok(
    bubbleStyleLeft.startsWith("-"),
    `气泡应向左偏移（left=${bubbleStyleLeft}）`,
  );
  console.log(
    "PET_E2E_OK bubble-shift",
    JSON.stringify({ left: clippedBubble.left, right: clippedBubble.right, width: clippedBubble.width, styleLeft: bubbleStyleLeft }),
  );

  // 复位成全可见，后续断言按居中气泡计算
  win.webContents.send("pet:clip", { left: 0, right: PET_WINDOW_WIDTH });
  await new Promise((r) => setTimeout(r, 150));

  // ── 拖拽链路：必须是「移动窗口」，不是原生拖图片 ──────────
  // 回归点：<img> 默认 draggable=true，拖动会走 HTML5 DnD 拖出「图片幽灵」，
  // 窗口纹丝不动。这里断言三件事：img 不可拖、dragstart 被拦、指针拖动发 IPC。
  const dragProbe = await win.webContents.executeJavaScript(`(function () {
    var img = document.getElementById('pet');
    var dragStart = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    img.dispatchEvent(dragStart);
    var style = getComputedStyle(img);
    return {
      draggable: img.draggable,
      userDrag: style.webkitUserDrag || style.userDrag || '',
      dragStartPrevented: dragStart.defaultPrevented,
    };
  })()`);
  assert.strictEqual(dragProbe.draggable, false, "<img> 必须 draggable=false");
  assert.strictEqual(dragProbe.dragStartPrevented, true, "dragstart 必须被 preventDefault");
  assert.ok(
    dragProbe.userDrag === "none" || dragProbe.userDrag === "",
    `图片应禁用 user-drag，实际 ${dragProbe.userDrag}`,
  );
  console.log("PET_E2E_OK native-drag-disabled", JSON.stringify(dragProbe));

  // 合成一次指针拖动：down → move(+30,+20) → up
  // 中途读一次光标形态，验证拖动中切到 grabbing
  const cursorProbe = await win.webContents.executeJavaScript(`(function () {
    function fire(type, x, y, buttons) {
      document.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true,
        pointerId: 1, pointerType: 'mouse',
        button: 0, buttons: buttons,
        screenX: x, screenY: y, clientX: 10, clientY: 10,
      }));
    }
    var stage = document.querySelector('.stage');
    var bubble = document.getElementById('bubble');
    var idle = {
      stage: getComputedStyle(stage).cursor,
      bubble: getComputedStyle(bubble).cursor,
    };
    var bubbleShownBefore = bubble.classList.contains('show');
    fire('pointerdown', 500, 500, 1);
    fire('pointermove', 530, 520, 1);
    var dragging = getComputedStyle(stage).cursor;
    var bubbleShownDuringDrag = bubble.classList.contains('show');
    fire('pointerup', 530, 520, 0);
    var afterUp = getComputedStyle(stage).cursor;
    var bubbleShownAfterUp = bubble.classList.contains('show');
    return {
      idle: idle,
      dragging: dragging,
      afterUp: afterUp,
      bubbleShownBefore: bubbleShownBefore,
      bubbleShownDuringDrag: bubbleShownDuringDrag,
      bubbleShownAfterUp: bubbleShownAfterUp,
    };
  })()`);
  await new Promise((r) => setTimeout(r, 150));

  assert.strictEqual(cursorProbe.idle.stage, "pointer", `宠物区应显示指点手，实际 ${cursorProbe.idle.stage}`);
  assert.strictEqual(cursorProbe.idle.bubble, "pointer", `气泡应显示可点手型，实际 ${cursorProbe.idle.bubble}`);
  assert.strictEqual(cursorProbe.dragging, "grabbing", `拖动中应为 grabbing，实际 ${cursorProbe.dragging}`);
  assert.strictEqual(cursorProbe.afterUp, "pointer", `松手后应恢复 pointer，实际 ${cursorProbe.afterUp}`);
  // 拖动时收起气泡，松手恢复
  assert.strictEqual(cursorProbe.bubbleShownBefore, true, "拖动前气泡应可见");
  assert.strictEqual(cursorProbe.bubbleShownDuringDrag, false, "拖动中气泡应隐藏");
  assert.strictEqual(cursorProbe.bubbleShownAfterUp, true, "松手后气泡应恢复");
  console.log("PET_E2E_OK cursor-states", JSON.stringify(cursorProbe));

  const moves = DRAG_EVENTS.filter((e) => e.type === "move");
  assert.ok(moves.length >= 1, `指针拖动应发出 pet:drag-move，实际 ${JSON.stringify(DRAG_EVENTS)}`);
  assert.strictEqual(moves[0].dx, 30, `水平位移应为 30，实际 ${moves[0].dx}`);
  assert.strictEqual(moves[0].dy, 20, `垂直位移应为 20，实际 ${moves[0].dy}`);
  assert.ok(
    DRAG_EVENTS.some((e) => e.type === "end"),
    "松手应发出 pet:drag-end（否则主进程会卡在交互态、不再穿透）",
  );
  console.log("PET_E2E_OK drag-moves-window", JSON.stringify(DRAG_EVENTS));

  // 穿透：初始 forward 穿透至少调用过一次
  assert.ok(
    IGNORE_CALLS.some((c) => c.ignore === true && c.forward === true),
    "应调用 setIgnoreMouseEvents(true, { forward: true })",
  );
  console.log("PET_E2E_OK ignore-mouse-events", JSON.stringify(IGNORE_CALLS.slice(0, 3)));

  console.log("PET_SMOKE_TEST_OK");
  console.log("SCREENSHOT:", path.join(OUT_DIR, "pet-walk.png"));
  app.exit(0);
}).catch((error) => {
  console.error("PET_SMOKE_TEST_FAILED", error);
  app.exit(1);
});
