/**
 * 交互态生命周期测试（真实窗口，不注入真实鼠标，避免干扰用户）。
 *
 * 覆盖三个曾经出问题的场景：
 *  ① 按下 → 拖动 → 松手：interacting 应复位
 *  ② 按下 → 没收到任何 pointermove → 松手：仍必须复位（曾因只在 moved 时
 *     发 drag-end 而永久卡住，表现为「窗口钉住 / 拖不动」）
 *  ③ 按住不动超过超时时间：靠 pointer-hold 心跳保住交互态
 *
 * 用法：node scripts/run-electron.cjs scripts/test-pet-interacting-lifecycle.js
 */
const { app, ipcMain, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const assert = require("node:assert");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "build-resources", "pets", "silver-haired");
const UI = path.join(ROOT, "build-resources", "pet-ui", "pet.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 380, x: 300, y: 200,
    transparent: true, frame: false, show: false,
    webPreferences: {
      preload: path.join(ROOT, "electron", "dist", "pet-preload.js"),
      contextIsolation: true, backgroundThrottling: false,
    },
  });
  let interacting = false;
  let interactingSince = 0;
  const dragEnds = [];
  ipcMain.on("pet:ready", () => {
    win.webContents.send("pet:config", fs.readFileSync(path.join(ASSETS, "manifest.json"), "utf8"), "frames", `${pathToFileURL(ASSETS).href}/`);
    win.webContents.send("pet:state", { mood: "idle", mode: "idle", running: 0, unread: 0, title: "", toolLabel: "", sessionId: null });
  });
  ipcMain.on("pet:hit-geometry", () => {});
  ipcMain.on("pet:pointer-down", () => { interacting = true; interactingSince = Date.now(); });
  ipcMain.on("pet:pointer-hold", () => { if (interacting) interactingSince = Date.now(); });
  ipcMain.on("pet:drag-move", () => { interacting = true; interactingSince = Date.now(); });
  ipcMain.on("pet:drag-end", (_e, p) => {
    interacting = false;
    dragEnds.push(p ?? null);
  });

  await win.loadFile(UI);
  win.showInactive();
  await sleep(1000);

  const fire = (type, opts = {}) =>
    win.webContents.executeJavaScript(`(function(){
      document.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, Object.assign({
        bubbles: true, cancelable: true, pointerId: 21, pointerType: 'mouse',
        button: 0, buttons: 1, screenX: 400, screenY: 300, clientX: 180, clientY: 250
      }, ${JSON.stringify(opts)})));
      return true;
    })()`);

  // ① 正常拖动
  await fire("pointerdown");
  await sleep(60);
  assert.strictEqual(interacting, true, "按下后应进入交互态");
  await fire("pointermove", { screenX: 430, screenY: 320 });
  await sleep(60);
  await fire("pointerup", { buttons: 0, screenX: 430, screenY: 320 });
  await sleep(120);
  assert.strictEqual(interacting, false, "松手后应退出交互态");
  assert.deepStrictEqual(dragEnds.at(-1), { moved: true }, "拖过就应上报 moved:true");
  console.log("PET_LIFECYCLE_OK normal-drag");

  // ② 按下后没有任何 pointermove 就松手（曾经会永久卡住）
  const beforeCount = dragEnds.length;
  await fire("pointerdown");
  await sleep(60);
  assert.strictEqual(interacting, true);
  await fire("pointerup", { buttons: 0 });
  await sleep(120);
  assert.strictEqual(
    interacting,
    false,
    "即使没发生拖动，松手也必须通知主进程退出交互态（否则窗口永久钉住）",
  );
  assert.strictEqual(dragEnds.length, beforeCount + 1, "应发出 drag-end");
  assert.deepStrictEqual(dragEnds.at(-1), { moved: false }, "单击应上报 moved:false");
  console.log("PET_LIFECYCLE_OK click-without-move");

  // ③ 按住不动：靠心跳续期
  await fire("pointerdown");
  await sleep(60);
  const t0 = interactingSince;
  await sleep(2600);   // 超过 INTERACT_TIMEOUT_MS(4s) 的一半，靠 1s 心跳续期
  assert.strictEqual(interacting, true, "按住期间应保持交互态");
  assert.ok(interactingSince > t0, "心跳应刷新时间戳，避免超时误伤");
  await fire("pointerup", { buttons: 0 });
  await sleep(120);
  assert.strictEqual(interacting, false);
  console.log("PET_LIFECYCLE_OK hold-keeps-interacting");

  win.destroy();
  console.log("PET_LIFECYCLE_TEST_OK");
  app.exit(0);
}).catch((e) => { console.error("PET_LIFECYCLE_FAILED", e); app.exit(1); });
