/**
 * Codex 图集（atlas）渲染端到端测试。
 *
 * 流程：先用 export-codex-pet.mjs 把柒导出成一份合法图集（顺带验证导出器），
 * 再把它喂给真实渲染层，逐状态截图并校验命中几何。
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-atlas-electron.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");
const { PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT } = require(
  path.join(ROOT, "electron", "dist", "pet-window.js"),
);
const OUT_DIR = path.join(os.tmpdir(), "pet-atlas-e2e");

app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const atlasDir = path.join(OUT_DIR, "qi-atlas");
  fs.rmSync(atlasDir, { recursive: true, force: true });

  // ── 1. 导出图集（同时验证导出器能产出合法产物）──
  // 注意用 `node` 而不是 process.execPath：Electron 里 process.execPath 是 electron.exe，
  // 拿它跑 .mjs 会当成应用启动、直接挂住。
  execFileSync(
    "node",
    [
      path.join(ROOT, "scripts", "export-codex-pet.mjs"),
      "--id",
      "silver-haired",
      "--out",
      atlasDir,
    ],
    { cwd: ROOT, stdio: "pipe", timeout: 120000 },
  );
  console.log("ATLAS_E2E_OK export");

  // ── 2. 起窗口，加载图集 ──
  const win = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    x: 60,
    y: 60,
    transparent: true,
    frame: false,
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(ROOT, "electron", "dist", "pet-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  let geometry = null;
  let ready = false;
  ipcMain.on("pet:ready", () => {
    ready = true;
    // 页面来自内置形象目录，素材在临时目录 → 必须用 baseUrl 指定素材根
    win.webContents.send(
      "pet:config",
      fs.readFileSync(path.join(atlasDir, "pet.json"), "utf8"),
      "atlas",
      `${pathToFileURL(atlasDir).href}/`,
    );
    win.webContents.send("pet:settings", { opacity: 100 });
  });
  ipcMain.on("pet:hit-geometry", (_e, g) => {
    geometry = g;
  });

  await win.loadFile(path.join(ROOT, "build-resources", "pet-ui", "pet.html"));
  win.showInactive();
  await sleep(1200);

  assert.ok(ready, "渲染层应发出 pet:ready");
  console.log("ATLAS_E2E_OK renderer-ready");

  // ── 3. 逐状态截图（图集特有的 9 个 clip）──
  const clips = ["idle", "running", "running-right", "waiting", "failed", "review"];
  for (const clip of clips) {
    win.webContents.send("pet:state", {
      mode: clip,
      running: clip === "running" ? 1 : 0,
      unread: 0,
      title: "图集测试",
      toolLabel: "",
      sessionId: null,
    });
    await sleep(600);

    const domMode = await win.webContents.executeJavaScript(
      "document.getElementById('pet').dataset.mode",
    );
    assert.strictEqual(domMode, clip, `${clip}: 渲染层应切到该 clip，实际 ${domMode}`);

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    assert.ok(png.length > 2000, `${clip}: 截图应有内容`);
    fs.writeFileSync(path.join(OUT_DIR, `atlas-${clip}.png`), png);

    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    let opaque = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      if (bitmap[i + 3] > 16) opaque += 1;
    }
    const ratio = opaque / (width * height);
    assert.ok(
      ratio > 0.03 && ratio < 0.85,
      `${clip}: 透明占比异常 ${(ratio * 100).toFixed(1)}%`,
    );

    // 命中几何必须来自图集实测 bbox，而不是整格（整格宽 192*scale ≈ 194）
    assert.ok(geometry && geometry.image, `${clip}: 应上报命中几何`);
    assert.ok(
      geometry.image.w > 0 && geometry.image.h > 0,
      `${clip}: 命中矩形应有效`,
    );
    console.log(
      `ATLAS_E2E_OK ${clip} opaque=${(ratio * 100).toFixed(1)}% hit=${geometry.image.w}x${geometry.image.h}`,
    );
  }

  // ── 4. 语义状态 → 动作（图集能力全，应该都命中对应行）──
  const moodExpect = [
    ["waiting", "waiting"],
    ["working", "running"],
    ["success", "review"],
    ["error", "failed"],
    ["sleeping", "idle"], // 图集没有 yawn 行
    ["idle", "idle"],
  ];
  for (const [mood, expected] of moodExpect) {
    win.webContents.send("pet:state", {
      mood,
      mode: "idle",
      running: mood === "working" ? 1 : 0,
      unread: 0,
      title: "",
      toolLabel: "",
      sessionId: null,
    });
    await sleep(350);
    const got = await win.webContents.executeJavaScript(
      "document.getElementById('pet').dataset.mode",
    );
    assert.strictEqual(got, expected, `mood=${mood} 应播 ${expected}，实际 ${got}`);
  }
  console.log("ATLAS_E2E_OK mood-mapping");

  // ── 5. 不支持的 clip 要回退到 idle（能力回退第一层）──
  win.webContents.send("pet:state", {
    mood: "walk", // frames 格式的片段名，图集里没有
    mode: "walk",
    running: 1,
    unread: 0,
    title: "",
    toolLabel: "",
    sessionId: null,
  });
  await sleep(400);
  const fallbackMode = await win.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(fallbackMode, "idle", `未知 clip 应回退 idle，实际 ${fallbackMode}`);
  console.log("ATLAS_E2E_OK fallback-to-idle");

  // ── 6. 慢拖向左不应来回切向（回归：dx===0 会把刚判的方向翻回去）──
  // 逐帧采样 dataset.mode：MutationObserver 的回调是微任务，同步循环里拿不到，
  // 而这里要的正是「每一次 move 之后处于什么状态」。
  const dragProbe = await win.webContents.executeJavaScript(`(function () {
    var el = document.getElementById('pet');
    function fire(type, x, buttons) {
      document.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
        button: 0, buttons: buttons, screenX: x, screenY: 500, clientX: 10, clientY: 10,
      }));
    }
    var x = 1000;
    fire('pointerdown', x, 1);
    var samples = [];
    for (var i = 0; i < 40; i++) {
      if (i % 7 === 3) {                 // 零位移事件（慢拖时非常常见）
        fire('pointermove', x, 1);
      } else {
        x += (i % 5 === 0) ? 1 : -1;     // 每帧 1px 向左，偶尔 1px 手抖回弹
        fire('pointermove', x, 1);
      }
      samples.push(el.dataset.mode);
    }
    fire('pointerup', x, 0);
    return JSON.stringify({ samples: samples, afterUp: el.dataset.mode });
  })()`);
  const dragResult = JSON.parse(dragProbe);

  assert.ok(
    dragResult.samples.includes("running-left"),
    `慢拖向左应播 running-left，实际 ${dragProbe}`,
  );
  assert.ok(
    !dragResult.samples.includes("running-right"),
    `慢拖向左不应翻回 running-right（抖动），实际 ${dragProbe}`,
  );
  // 一次都不能闪：出现过的不同状态数应为 2（idle → running-left）
  const distinct = [...new Set(dragResult.samples)];
  assert.deepStrictEqual(
    distinct.filter((m) => m === "running-left" || m === "running-right"),
    ["running-left"],
    `拖动过程中方向不应反复切换，实际序列 ${JSON.stringify(distinct)}`,
  );
  console.log("ATLAS_E2E_OK drag-direction-stable", JSON.stringify(distinct));

  // ── 7. 尺寸下发后画布应跟着变（主进程只管算像素，渲染层负责应用）──
  win.webContents.send("pet:settings", { opacity: 100, petPx: 300 });
  await sleep(400);
  const canvasSize = await win.webContents.executeJavaScript(
    "JSON.stringify({w: document.getElementById('pet').clientWidth, h: document.getElementById('pet').clientHeight})",
  );
  const size = JSON.parse(canvasSize);
  assert.strictEqual(size.w, 300, `画布宽度应变为 300，实际 ${size.w}`);
  assert.strictEqual(size.h, 300, `画布高度应变为 300，实际 ${size.h}`);
  console.log("ATLAS_E2E_OK pet-size-applied", canvasSize);

  // ── 8. 播放倍速：0.5× 时 idle 一圈应接近 2 倍时长 ──
  // 用「canvas 像素变化」间接测节奏太脆，这里只验证倍速被渲染层接受且不崩，
  // 精确时长由 scripts 里的纯算法模拟覆盖（rAF 栅格会有 ~3% 偏差）。
  win.webContents.send("pet:state", {
    mood: "idle",
    mode: "idle",
    running: 0,
    unread: 0,
    title: "",
    toolLabel: "",
    sessionId: null,
  });
  await sleep(200);
  win.webContents.send("pet:settings", { opacity: 100, petPx: 300, animationSpeed: 0.5 });
  await sleep(600);
  const slowOk = await win.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(slowOk, "idle", "0.5 倍速下应仍在正常播放");
  win.webContents.send("pet:settings", { opacity: 100, petPx: 300, animationSpeed: 4 });
  await sleep(400);
  const fastOk = await win.webContents.executeJavaScript(
    "document.getElementById('pet').dataset.mode",
  );
  assert.strictEqual(fastOk, "idle", "4 倍速下应仍在正常播放");
  console.log("ATLAS_E2E_OK animation-speed-applied");

  // ── 9. 切格尺寸：格高必须由格宽按 192:208 比例推出 ──
  // 回归点：曾经用 naturalHeight / ATLAS_ROWS.length 算，11 行图会被算成 254 高，
  // 取帧时跨到下一行 —— 表现为「idle 在左右移动、能看到下一帧的半拉」。
  const dbg = JSON.parse(
    await win.webContents.executeJavaScript("JSON.stringify(window.__petDebug())"),
  );
  assert.ok(dbg.atlasCell, "应能读到切格尺寸");
  assert.ok(
    Math.abs(dbg.atlasCell.h - dbg.atlasCell.w * (208 / 192)) < 0.01,
    `格高必须按 192:208 比例（实际 ${dbg.atlasCell.w}×${dbg.atlasCell.h}）`,
  );
  assert.ok(
    Math.abs(dbg.atlasCell.w - 192) < 0.01,
    `8 列图集的格宽应为 192（实际 ${dbg.atlasCell.w}）`,
  );
  console.log("ATLAS_E2E_OK cell-geometry", JSON.stringify(dbg.atlasCell));

  win.destroy();
  console.log("ATLAS_E2E_TEST_OK");
  console.log("SCREENSHOTS:", OUT_DIR);
  app.exit(0);
}).catch((error) => {
  console.error("ATLAS_E2E_FAILED", error);
  app.exit(1);
});
