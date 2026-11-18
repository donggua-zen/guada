/**
 * 滚动稳定性探针：验证有界窗口「卸载为占位」不会让可见内容跳动。
 *
 * node scripts/run-electron.cjs scripts/perf-turn-window-anchor.js <sessionId>
 *
 * 判据：每步滚动停止后，记录视口内第一个回合的 id 与它相对视口顶部的偏移；
 * 下一次卸载发生后，该 id 与偏移应保持不变（差值 ≤ 2px）。
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
const log = (...v) => console.log("[anchor]", ...v);
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
      partition: `anchor-${Date.now()}`,
    },
  });
  const wc = win.webContents;
  await win.loadURL(BASE);
  if (maxMounted) {
    await wc.executeJavaScript(`localStorage.setItem('gd:turn-window-max', '${maxMounted}'); true`);
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

  /** 视口内第一个 [data-turn-id] 的 id 与偏移 */
  const anchorProbe = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      const rootRect = sc.getBoundingClientRect();
      for (const el of sc.querySelectorAll('[data-turn-id]')) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= rootRect.top) continue;
        if (r.top >= rootRect.bottom) break;
        return {
          id: el.dataset.turnId,
          offset: Math.round(r.top - rootRect.top),
          turns: document.querySelectorAll('.turn-wrapper').length,
          placeholders: document.querySelectorAll('.turn-placeholder').length,
          scrollTop: Math.round(sc.scrollTop),
          scrollHeight: sc.scrollHeight,
        };
      }
      return null;
    })()
  `;

  const wheelUp = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      return true;
    })()
  `;

  const rows = [];
  // 先回到顶部：从底部开始向上滚不会产生位移（已在可滚动上限），
  // 卸载也就不会发生，测出来的“零漂移”没有意义。
  await wc.executeJavaScript(wheelUp);
  await wc.executeJavaScript(`
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.scrollTop = 0;
      return sc.scrollTop;
    })()
  `);
  await sleep(1200);

  // 向下浏览若干屏，每步停止后记录锚点；中途会触发卸载（上限较低时）
  for (let i = 0; i < 16; i += 1) {
    await wc.executeJavaScript(wheelUp);
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + sc.clientHeight * 0.75);
        return sc.scrollTop;
      })()
    `);
    // 等滚动停止 + 300ms 空闲规划器 + 锚点恢复
    await sleep(900);
    const before = await wc.executeJavaScript(anchorProbe);
    await sleep(700);
    const after = await wc.executeJavaScript(anchorProbe);
    rows.push({ step: i + 1, before, after, drift: before && after && before.id === after.id ? after.offset - before.offset : null });
  }

  const drifted = rows.filter((r) => r.drift !== null && Math.abs(r.drift) > 2);
  const lost = rows.filter((r) => r.before && r.after && r.before.id !== r.after.id);
  log("步数", rows.length, "位移超差", drifted.length, "锚点丢失", lost.length);
  log(rows.map((r) => ({
    step: r.step,
    id: r.before?.id?.slice(-6),
    off: r.before?.offset,
    afterOff: r.after?.offset,
    drift: r.drift,
    turns: r.after?.turns,
    ph: r.after?.placeholders,
  })));
  if (drifted.length) log("超差明细", drifted);
  if (lost.length) log("丢失明细", lost);

  win.destroy();
  app.exit(drifted.length || lost.length ? 1 : 0);
}).catch((e) => {
  console.error("[anchor] failed", e);
  app.exit(1);
});
