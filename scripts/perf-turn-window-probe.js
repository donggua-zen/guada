/**
 * 只读探针：验证有界窗口在真实 Electron 窗口里的挂载/卸载行为。
 * node scripts/run-electron.cjs scripts/perf-turn-window-probe.js <sessionId>
 */
"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const BASE = process.env.GUADA_PERF_BASE || "http://localhost:5173";
const sessionId = process.argv[2];
const outDir = path.resolve(__dirname, "..", "tmp");
app.setPath("userData", path.join(outDir, "perf-window-profile"));
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...v) => console.log("[probe]", ...v);

/** 可选：覆盖已挂载上限，用于验证回收路径（默认 24，本会话峰值到不了） */
const maxMounted = process.env.GUADA_PERF_MAX_MOUNTED || "";

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: `probe-${Date.now()}`,
    },
  });
  const wc = win.webContents;
  await win.loadURL(BASE);
  if (maxMounted) {
    await wc.executeJavaScript(`localStorage.setItem('gd:turn-window-max', '${maxMounted}'); true`);
  } else {
    await wc.executeJavaScript("localStorage.removeItem('gd:turn-window-max'); true");
  }
  await win.loadURL(`${BASE}/chat/${sessionId}`);
  for (let i = 0; i < 60; i += 1) {
    const n = await wc.executeJavaScript("document.querySelectorAll('.turn-wrapper').length");
    if (n > 0) break;
    await sleep(300);
  }
  wc.debugger.attach("1.3");
  await wc.debugger.sendCommand("Page.enable");
  await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  await wc.debugger.sendCommand("Page.setWebLifecycleState", { state: "active" });
  await sleep(1200);

  const snap = () => wc.executeJavaScript(`
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      return {
        st: Math.round(sc.scrollTop),
        sh: sc.scrollHeight,
        ch: sc.clientHeight,
        turns: document.querySelectorAll('.turn-wrapper').length,
        ph: document.querySelectorAll('.turn-placeholder').length,
        nodes: document.getElementsByTagName('*').length,
      };
    })()
  `);

  log("初始", await snap());

  // 安装滚动事件计数
  await wc.executeJavaScript(`
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      window.__probeScroll = 0;
      sc.addEventListener('scroll', () => { window.__probeScroll += 1; }, { passive: true });
      return true;
    })()
  `);

  // 回到顶部
  await wc.executeJavaScript("document.querySelector('.chat-scroll-container').scrollTop = 0; true");
  await sleep(900);
  log("置顶", await snap());

  // 先声明「用户上滚」意图：否则跟随态会在内容增高时立刻把位置贴回底部，
  // 测量看到的永远是最后 N 个回合，浏览历史的挂载/卸载根本不会发生。
  const releaseFollow = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      return true;
    })()
  `;

  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    await wc.executeJavaScript(releaseFollow);
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + sc.clientHeight * 0.8);
        return sc.scrollTop;
      })()
    `);
    await sleep(600);
    samples.push(await snap());
  }
  const scrollEvents = await wc.executeJavaScript("window.__probeScroll");
  log("scroll 事件数", scrollEvents);
  log("采样", samples);

  // ── 反向验证：一路滚到底（内容会随挂载增高，需持续追到底），远处已挂载回合应被卸载 ──
  for (let i = 0; i < 60; i += 1) {
    await wc.executeJavaScript(releaseFollow);
    const done = await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        const atBottom = sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 4;
        sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + sc.clientHeight * 0.9);
        return atBottom && document.querySelectorAll('.turn-placeholder').length === 0;
      })()
    `);
    await sleep(420);
    if (done) break;
  }
  // 停留足够长时间，让 300ms 的空闲规划器跑一次
  await sleep(1800);
  const atBottom = await snap();
  log("滚到底并停留", atBottom);

  // ── 反向：从底部再滚回顶部。此时尾部已挂载，头部逐段挂载 → 总数应超过上限，
  // 远处的回合必须被回收成占位（验证有界性，而不是无限累积） ──
  const backSamples = [];
  for (let i = 0; i < 24; i += 1) {
    await wc.executeJavaScript(releaseFollow);
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.max(0, sc.scrollTop - sc.clientHeight * 0.8);
        return sc.scrollTop;
      })()
    `);
    await sleep(520);
    backSamples.push(await snap());
  }
  await sleep(1600);
  const atTop = await snap();
  log("回顶部后", atTop);
  log("回程采样", backSamples.map((s) => ({ st: s.st, turns: s.turns, ph: s.ph, nodes: s.nodes })));

  const peak = samples.concat(backSamples, [atBottom, atTop]).reduce((m, s) => Math.max(m, s.turns), 0);
  log("浏览全程挂载峰值", peak, "最终", atTop.turns);

  win.destroy();
  app.exit(0);
}).catch((e) => {
  console.error("[probe] failed", e);
  app.exit(1);
});
