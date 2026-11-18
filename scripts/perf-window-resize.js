/**
 * 窗口「最大化 → 还原」性能测量（诊断脚本，不进入产品构建）。
 *
 * 目的：用真实前端 + 真实后端 + 真实 Electron 窗口录制一次原生窗口尺寸变化，
 * 采集页面侧帧间隔 / 长任务 / 降级类时序，以及 Chromium trace 的
 * Layout / UpdateLayoutTree / PrePaint / Paint / Raster 耗时占比。
 *
 * 用法：
 *   node scripts/run-electron.cjs --timeout=180000 scripts/perf-window-resize.js <sessionId> [--all-turns] [--iterations=3]
 *
 * 产物：tmp/perf-window-resize-<时间戳>.json（trace 原始文件同名 .trace.json）
 */
"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = process.env.GUADA_PERF_BASE || "http://localhost:5173";
const args = process.argv.slice(2);
const sessionId = args.find((a) => !a.startsWith("--"));
const iterationsArg = args.find((a) => a.startsWith("--iterations="));
const iterations = iterationsArg ? Number(iterationsArg.split("=")[1]) : 3;
const allTurns = args.includes("--all-turns");
const prearm = args.includes("--prearm");
const noCv = args.includes("--no-cv");
const noTrace = args.includes("--no-trace");
/** 滚动穿透：逐段上滚再回底，让长会话真实经历「挂载 → 滚远 → 卸载」 */
const scrollSweep = args.includes("--sweep");
const widthArg = args.find(a => a.startsWith("--width="));
const windowWidth = widthArg ? Number(widthArg.split("=")[1]) : 1280;

const outDir = path.resolve(__dirname, "..", "tmp");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = path.join(outDir, `perf-window-resize-${stamp}.json`);
const tracePath = path.join(outDir, `perf-window-resize-${stamp}.trace.json`);

if (!sessionId) {
  console.error("[perf] 用法: node scripts/run-electron.cjs scripts/perf-window-resize.js <sessionId> [--all-turns]");
  process.exit(2);
}

const log = (...parts) => console.log("[perf]", ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面侧测量器：rAF 帧间隔 + longtask + html class/resize 时序。 */
const INSTRUMENT = `
(() => {
  if (window.__rzStop) { try { window.__rzStop(); } catch (e) {} }
  const rec = { tasks: [], frames: [], marks: [] };
  window.__rz = rec;
  const t0 = performance.now();
  window.__rzT0 = t0;
  const elapsed = () => performance.now() - window.__rzT0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.entryType === 'longtask') {
        rec.tasks.push({ at: Math.round(e.startTime - window.__rzT0), dur: Math.round(e.duration) });
      }
    }
  });
  obs.observe({ entryTypes: ['longtask'] });
  let raf = null;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    rec.frames.push({ at: Math.round(now - window.__rzT0), dt: Math.round((now - last) * 10) / 10 });
    last = now;
    if (rec.frames.length > 6000) rec.frames.shift();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const cls = new MutationObserver(() => {
    rec.marks.push({
      at: Math.round(performance.now() - window.__rzT0),
      cls: document.documentElement.className,
      w: innerWidth,
      h: innerHeight,
    });
  });
  cls.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const onResize = () => {
    rec.marks.push({ at: Math.round(performance.now() - window.__rzT0), event: 'resize', w: innerWidth, h: innerHeight });
  };
  const onError = (e) => {
    rec.marks.push({ at: Math.round(performance.now() - window.__rzT0), event: 'error', message: String(e.message) });
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('error', onError);
  window.__rzStop = () => {
    obs.disconnect();
    cls.disconnect();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('error', onError);
    if (raf !== null) cancelAnimationFrame(raf);
  };
  return { ok: true, w: innerWidth, h: innerHeight };
})();
`;

const RESET_COUNTERS = `
(() => {
  if (!window.__rz) return false;
  window.__rz.tasks.length = 0;
  window.__rz.frames.length = 0;
  window.__rz.marks.length = 0;
  window.__rzT0 = performance.now();
  return true;
})();
`;

const READ_STATS = `
(() => {
  const r = window.__rz;
  if (!r) return null;
  const f = r.frames.map((x) => x.dt).filter((x) => x > 0);
  const sorted = [...f].sort((a, b) => a - b);
  const q = (p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10 : null);
  const root = document.querySelector('[data-turn-id]')?.parentElement;
  return {
    visibility: document.visibilityState,
    dimensions: { width: innerWidth, height: innerHeight },
    worstFrames: [...r.frames].sort((a,b) => b.dt-a.dt).slice(0,12),
    turns: document.querySelectorAll('.turn-wrapper').length,
    placeholders: document.querySelectorAll('.turn-placeholder').length,
    nodes: document.getElementsByTagName('*').length,
    scrollHeight: root ? root.scrollHeight : null,
    frames: r.frames.length,
    p50: q(50),
    p95: q(95),
    max: q(100),
    over33: f.filter((x) => x > 33.4).length,
    over50: f.filter((x) => x > 50).length,
    longTasks: r.tasks.length,
    longTaskMs: r.tasks.reduce((s, x) => s + x.dur, 0),
    tasks: r.tasks.slice(0, 20),
    marks: r.marks.slice(0, 40),
  };
})();
`;

async function waitForTurns(wc, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await wc.executeJavaScript(
      "document.querySelectorAll('.turn-wrapper,.turn-placeholder').length",
    );
    if (count > 0) return count;
    await sleep(400);
  }
  throw new Error("等待回合列表超时");
}

/** 展开过程组：让折叠的思考/工具正文真正参与布局（默认折叠态被 cv/不渲染掩盖成本）。 */
const EXPAND_GROUPS = `
(() => {
  const headers = Array.from(document.querySelectorAll('.process-group__header'));
  let clicked = 0;
  for (const h of headers) { h.click(); clicked += 1; }
  return clicked;
})();
`;

function summarizeTrace(events) {
  const buckets = new Map();
  const add = (name, ts, dur) => {
    if (!Number.isFinite(dur)) return;
    let b = buckets.get(name);
    if (!b) { b = { count: 0, totalMs: 0, maxMs: 0 }; buckets.set(name, b); }
    b.count += 1;
    b.totalMs += dur / 1000;
    b.maxMs = Math.max(b.maxMs, dur / 1000);
  };
  for (const e of events) {
    if (e.ph !== "X" && e.ph !== "B") continue;
    const name = e.name;
    if (
      name === "Layout" || name === "UpdateLayoutTree" || name === "PrePaint" ||
      name === "Paint" || name === "RasterTask" || name === "Layerize" ||
      name === "CompositeLayers" || name === "RecalculateStyles" ||
      name === "FunctionCall" || name === "TimerFire" ||
      name === "EventDispatch" || name === "RunTask" || name === "HitTest" ||
      name === "Commit" || name === "Frame" || name === "ParseHTML" ||
      name === "V8.Execute" || name === "MinorGC" || name === "MajorGC"
    ) {
      add(name, e.ts, e.dur);
    }
  }
  const out = {};
  for (const [name, b] of buckets) {
    out[name] = {
      count: b.count,
      totalMs: Math.round(b.totalMs * 100) / 100,
      maxMs: Math.round(b.maxMs * 100) / 100,
    };
  }
  return out;
}

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.setPath("userData", path.join(outDir, "perf-window-profile"));
fs.mkdirSync(outDir, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: windowWidth,
    height: 760,
    show: true,
    backgroundColor: "#ffffff",
    // 每次测量使用独立内存会话，不继承或覆盖现有窗口的 storage。
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `perf-resize-${Date.now()}` },
  });

  const wc = win.webContents;
  const errors = [];
  wc.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message.slice(0, 300));
  });

  const url = `${BASE_URL}/chat/${sessionId}`;
  log("加载", url);
  await win.loadURL(BASE_URL);
  await wc.executeJavaScript(`localStorage.setItem('gd:lazy-turns', '${allTurns ? '0' : '1'}'); localStorage.setItem('gd:turn-cv', '${noCv ? '0' : '1'}'); true`);
  await win.loadURL(url);
  await waitForTurns(wc);
  const loaded = await wc.executeJavaScript(
    "({ turns: document.querySelectorAll('.turn-wrapper').length, placeholders: document.querySelectorAll('.turn-placeholder').length })",
  );
  log("载入完成", loaded, "allTurns=", allTurns);
  await sleep(800);
  log("windowState", { visible: win.isVisible(), minimized: win.isMinimized(), bounds: win.getBounds() });

  // 滚动穿透：真实经历长会话的「浏览历史」过程。有界窗口只在滚动停止 300ms 后
  // 才规划卸载，因此每段之间留出停顿；同时采样已挂载数，观察峰值是否被压住。
  if (scrollSweep) {
    const steps = Number(process.env.GUADA_PERF_SWEEP_STEPS || 14);
    const before = await wc.executeJavaScript(
      "({ turns: document.querySelectorAll('.turn-wrapper').length, placeholders: document.querySelectorAll('.turn-placeholder').length })",
    );
    const samples = [];
    // 先回到顶部，再逐段向下，模拟用户从最早消息浏览到最新消息
    await wc.executeJavaScript(`
      (() => {
        const scroller = document.querySelector('.chat-scroll-container');
        if (!scroller) return null;
        scroller.scrollTop = 0;
        return scroller.scrollTop;
      })()
    `);
    await sleep(500);
    for (let i = 0; i < steps; i += 1) {
      // 先声明「用户上滚」意图：否则跟随态会在内容增高时立刻贴回底部，
      // 浏览历史的挂载/卸载根本不会发生（测量看到的永远是尾部窗口）。
      await wc.executeJavaScript(`
        (() => {
          const scroller = document.querySelector('.chat-scroll-container');
          if (!scroller) return null;
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
          scroller.scrollTop = Math.min(
            scroller.scrollHeight,
            scroller.scrollTop + scroller.clientHeight * 0.8,
          );
          return scroller.scrollTop;
        })()
      `);
      await sleep(480);
      samples.push(await wc.executeJavaScript(`
        (() => ({
          turns: document.querySelectorAll('.turn-wrapper').length,
          placeholders: document.querySelectorAll('.turn-placeholder').length,
          nodes: document.getElementsByTagName('*').length,
        }))()
      `));
    }
    await sleep(900);
    const after = await wc.executeJavaScript(
      "({ turns: document.querySelectorAll('.turn-wrapper').length, placeholders: document.querySelectorAll('.turn-placeholder').length })",
    );
    log("滚动穿透", {
      before,
      after,
      peakTurns: Math.max(...samples.map((s) => s.turns), 0),
      peakNodes: Math.max(...samples.map((s) => s.nodes), 0),
      samples,
    });
  }

  // 可选：展开全部分组，让折叠内容进入布局
  if (process.env.GUADA_PERF_EXPAND === "1") {
    const clicked = await wc.executeJavaScript(EXPAND_GROUPS);
    log("展开分组", clicked);
    await sleep(800);
  }

  // 调试器强制前台渲染生命周期，防止自动化进程窗口被遮挡后不产生帧。
  wc.debugger.attach("1.3");
  await wc.debugger.sendCommand("Page.enable");
  await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  await wc.debugger.sendCommand("Page.setWebLifecycleState", { state: "active" });
  await wc.executeJavaScript(INSTRUMENT);
  await sleep(700);

  // ── trace 录制 ──
  let tracing = false;
  try {
    if (noTrace) throw new Error('disabled for untraced baseline');
    await wc.debugger.sendCommand("Tracing.start", {
      transferMode: "ReportEvents",
      traceConfig: {
        includedCategories: [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-devtools.timeline.frame",
          "toplevel",
          "blink",
          "cc",
          "gpu",
          "viz",
          "v8",
          "skia",
        ],
      },
    });
    tracing = true;
    log("trace 已开始");
  } catch (error) {
    log("trace 启动失败（继续做页面侧测量）:", error.message);
  }

  const rounds = [];
  for (let i = 0; i < iterations; i += 1) {
    await wc.executeJavaScript(INSTRUMENT);
    if (prearm) await wc.executeJavaScript("(async () => { const m = await import('/src/composables/useResizeActivity.ts'); window.__resizeModule = m; window.__resizeRelease = m.beginResizeActivity(); m.markResizeMoved(); return true; })()");
    await wc.executeJavaScript(
      "(() => { window.__rz.marks.push({ at: 0, event: 'phase', phase: 'maximize' }); return true; })()",
    );
    win.maximize();
    if (prearm) { await sleep(120); await wc.executeJavaScript('window.__resizeRelease(); true'); }
    await sleep(1600);
    if (prearm) await wc.executeJavaScript('window.__resizeRelease = window.__resizeModule.beginResizeActivity(); window.__resizeModule.markResizeMoved(); true');
    await wc.executeJavaScript(
      "(() => { window.__rz.marks.push({ at: Math.round(performance.now() - window.__rzT0), event: 'phase', phase: 'restore' }); return true; })()",
    );
    win.unmaximize();
    if (prearm) { await sleep(120); await wc.executeJavaScript('window.__resizeRelease(); true'); }
    await sleep(2000);
    const stats = await wc.executeJavaScript(READ_STATS);
    rounds.push({ round: i + 1, ...stats });
    log(`第 ${i + 1} 轮`, {
      turns: stats?.turns,
      placeholders: stats?.placeholders,
      p95: stats?.p95,
      max: stats?.max,
      longTasks: stats?.longTasks,
      longTaskMs: stats?.longTaskMs,
    });
  }

  let traceSummary = null;
  if (tracing) {
    const chunks = [];
    let resolveComplete;
    const ended = new Promise((resolve) => { resolveComplete = resolve; });
    const onData = (_event, method, params) => {
      if (method === "Tracing.dataCollected" && Array.isArray(params.value)) {
        for (const event of params.value) chunks.push(event);
      }
      if (method === "Tracing.tracingComplete") resolveComplete(params);
    };
    wc.debugger.on("message", onData);
    await wc.debugger.sendCommand("Tracing.end");
    const done = await Promise.race([ended, sleep(20000).then(() => null)]);
    if (!done) log("等待 tracingComplete 超时");
    wc.debugger.removeListener("message", onData);
    // 若事件没有随 dataCollected 到达，退化为读取 stream（本机通常走 ReportEvents）
    traceSummary = { events: chunks.length, buckets: chunks.length ? summarizeTrace(chunks) : null };
    if (chunks.length) {
      fs.writeFileSync(tracePath, JSON.stringify({ traceEvents: chunks }));
      log("trace 已保存", tracePath);
    }
    try { wc.debugger.detach(); } catch { /* ignore */ }
  }

  const finalDom = await wc.executeJavaScript(
    "({ turns: document.querySelectorAll('.turn-wrapper').length, placeholders: document.querySelectorAll('.turn-placeholder').length, nodes: document.getElementsByTagName('*').length })",
  );

  const report = {
    at: new Date().toISOString(),
    url,
    allTurns, prearm, noCv, noTrace, sweep: scrollSweep,
    expanded: process.env.GUADA_PERF_EXPAND === "1",
    viewport: { width: windowWidth, height: 760 },
    finalDom,
    rounds,
    trace: traceSummary,
    consoleErrors: errors.slice(0, 20),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  log("报告已保存", jsonPath);
  console.log(JSON.stringify({
    ok: true,
    report: jsonPath,
    rounds: rounds.map((r) => ({
      turns: r.turns,
      placeholders: r.placeholders,
      p50: r.p50,
      p95: r.p95,
      max: r.max,
      over33: r.over33,
      longTasks: r.longTasks,
      longTaskMs: r.longTaskMs,
    })),
    traceBuckets: traceSummary?.buckets,
  }, null, 2));

  win.destroy();
  app.exit(0);
}).catch((error) => {
  console.error("[perf] 失败:", error && error.stack ? error.stack : error);
  app.exit(1);
});
