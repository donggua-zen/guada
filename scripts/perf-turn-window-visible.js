/**
 * 视口内容检查：滚动到某处后，视口中心究竟是真实回合还是骨架占位。
 * node scripts/run-electron.cjs scripts/perf-turn-window-visible.js <sessionId>
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
const log = (...v) => console.log("[visible]", ...v);
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
      partition: `visible-${Date.now()}`,
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

  // 视口中心与上下 1/4 处的元素类型
  const visibleProbe = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      const r = sc.getBoundingClientRect();
      const at = (frac) => {
        const y = r.top + r.height * frac;
        const el = document.elementFromPoint(r.left + r.width / 2, y);
        const holder = el && el.closest('[data-turn-id]');
        return {
          frac,
          kind: holder ? (holder.classList.contains('turn-placeholder') ? 'placeholder' : 'turn') : 'none',
          id: holder ? holder.dataset.turnId.slice(-6) : null,
        };
      };
      return {
        scrollTop: Math.round(sc.scrollTop),
        turns: document.querySelectorAll('.turn-wrapper').length,
        ph: document.querySelectorAll('.turn-placeholder').length,
        probes: [at(0.15), at(0.5), at(0.85)],
      };
    })()
  `;

  const wheelUp = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      return true;
    })()
  `;

  await wc.executeJavaScript(wheelUp);
  await wc.executeJavaScript("document.querySelector('.chat-scroll-container').scrollTop = 0; true");
  await sleep(1500);
  log("顶部", await wc.executeJavaScript(visibleProbe));

  for (let i = 0; i < 10; i += 1) {
    await wc.executeJavaScript(wheelUp);
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + sc.clientHeight * 0.8);
        return sc.scrollTop;
      })()
    `);
    await sleep(1500);
    log(`step ${i + 1}`, await wc.executeJavaScript(visibleProbe));
  }

  win.destroy();
  app.exit(0);
}).catch((e) => {
  console.error("[visible] failed", e);
  app.exit(1);
});
