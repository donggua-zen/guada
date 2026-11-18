/**
 * 折叠组延迟挂载探针（真实 Electron 窗口）。
 *
 * node scripts/run-electron.cjs scripts/perf-collapsed-groups.js <sessionId> [--off]
 *   --off  关闭延迟挂载（localStorage['gd:lazy-groups']='0'），做 A/B 对照
 *
 * 验证两件事：
 * 1) 收起态的分组不再挂载子树（DOM 节点数下降）；
 * 2) 用户展开过的分组/工具行，在回合被回收、重新挂载后仍保持展开。
 */
"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const BASE = process.env.GUADA_PERF_BASE || "http://localhost:5173";
const args = process.argv.slice(2);
const sessionId = args.find((a) => !a.startsWith("--"));
const eager = args.includes("--off");
const outDir = path.resolve(__dirname, "..", "tmp");
app.setPath("userData", path.join(outDir, "perf-window-profile"));
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...v) => console.log("[groups]", ...v);

/** 统计折叠组与其内部节点 */
const STATS = `
(() => {
  const groups = Array.from(document.querySelectorAll('.process-group'));
  let collapsed = 0, expanded = 0, mountedBodies = 0;
  let nodesInCollapsed = 0;
  for (const g of groups) {
    const collapsible = !!g.querySelector('.process-group__header');
    const body = g.querySelector('.process-group__body');
    const scroll = g.querySelector('.process-group__body-scroll');
    const isExpanded = !!g.querySelector('.process-group__collapsible.is-expanded');
    if (collapsible) {
      if (isExpanded) expanded += 1;
      else collapsed += 1;
    }
    if (scroll) mountedBodies += 1;
    if (collapsible && !isExpanded && body) {
      nodesInCollapsed += body.getElementsByTagName('*').length;
    }
  }
  return {
    groups: groups.length,
    collapsed,
    expanded,
    mountedBodies,
    nodesInCollapsed,
    nodesTotal: document.getElementsByTagName('*').length,
    turns: document.querySelectorAll('.turn-wrapper').length,
  };
})()
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: `groups-${Date.now()}`,
    },
  });
  const wc = win.webContents;
  await win.loadURL(BASE);
  await wc.executeJavaScript(
    eager
      ? "localStorage.setItem('gd:lazy-groups','0'); true"
      : "localStorage.removeItem('gd:lazy-groups'); true",
  );
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
  await sleep(1500);

  // ── 0) 展开/收起交替：先确认「点得开也收得回」 ──
  // 曾经的 bug：toggle 写裸 group.id、读取走复合键，导致每次点击都按运行态取反，
  // 分组能展开但永远收不起来。这里逐步断展开态翻转。
  const PICK_STATE = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      const rr = sc.getBoundingClientRect();
      const hs = Array.from(document.querySelectorAll('.process-group__header'));
      const i = hs.findIndex((x) => {
        const r = x.getBoundingClientRect();
        return r.top > rr.top + 20 && r.bottom < rr.bottom - 20;
      });
      if (i < 0) return { found: false };
      const g = hs[i].closest('.process-group');
      return {
        found: true,
        expanded: !!g.querySelector('.process-group__collapsible.is-expanded'),
        mounted: !!g.querySelector('.process-group__body-scroll'),
        nodes: g.getElementsByTagName('*').length,
      };
    })()
  `;
  const CLICK_PICKED = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      const rr = sc.getBoundingClientRect();
      const hs = Array.from(document.querySelectorAll('.process-group__header'));
      const h = hs.find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > rr.top + 20 && r.bottom < rr.bottom - 20;
      });
      if (!h) return false;
      h.click();
      return true;
    })()
  `;

  // 先给一次上滚意图，再逐步上滚直到视口里出现分组标题
  await wc.executeJavaScript(`
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  let picked = { found: false };
  for (let k = 0; k < 40; k += 1) {
    picked = await wc.executeJavaScript(PICK_STATE);
    if (picked.found) break;
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.max(0, sc.scrollTop - sc.clientHeight * 0.7);
        return sc.scrollTop;
      })()
    `);
    await sleep(450);
  }
  if (!picked.found) {
    log("未在视口内找到分组标题，跳过切换验证");
  } else {
    const seq = [];
    for (let i = 0; i < 4; i += 1) {
      await wc.executeJavaScript(CLICK_PICKED);
      await sleep(700);
      seq.push((await wc.executeJavaScript(PICK_STATE)).expanded);
    }
    const toggles = seq.every((v, i) => (i === 0 ? v === true : v === !seq[i - 1]));
    log("展开/收起序列", seq, toggles ? "✅ 可展开也可收起" : "❌ 切换异常");
  }

  // ── 统计首屏结构（旧 vs 新） ──
  log(eager ? "eager(旧行为)" : "lazy(延迟挂载)", await wc.executeJavaScript(STATS));

  if (eager) {
    win.destroy();
    app.exit(0);
    return;
  }

  // ── 置顶，在顶部展开第一个折叠组 ──
  // 目标必须远离尾部保护区（最后 LAZY_TURNS_INITIAL=8 个回合永不卸载）：
  // 顶部回合向下滚会被回收，中部/尾部不会。之前固定滚到 1/3 处取目标，
  // 结果目标恰好落在保护区里，出现了「看起来状态保持、其实从未卸载」的假通过。
  await wc.executeJavaScript(`
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }));
      sc.scrollTop = 0;
      return true;
    })()
  `);
  await sleep(1500);
  const target = await wc.executeJavaScript(`
    (() => {
      const h = document.querySelector('.process-group__header');
      if (!h) return null;
      h.click();
      const turnEl = h.closest('[data-turn-id]');
      return { turnId: turnEl ? turnEl.dataset.turnId : null };
    })()
  `);
  log("中部展开", target);
  if (!target?.turnId) {
    log("未取到目标回合 id，无法验证跨卸载保持");
    win.destroy();
    app.exit(1);
    return;
  }
  await sleep(700);
  log("展开后", await wc.executeJavaScript(STATS));

  const targetTurnId = target.turnId;

  /** 目标回合当前是真实组件还是占位，附带当前滚动位置 */
  const targetState = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      const el = document.querySelector('[data-turn-id="${targetTurnId}"]');
      const st = sc ? Math.round(sc.scrollTop) : -1;
      const sh = sc ? sc.scrollHeight : -1;
      const state = !el ? 'absent' : (el.classList.contains('turn-placeholder') ? 'placeholder' : 'turn');
      return state + '@' + st + '/' + sh;
    })()
  `;
  const stateOf = (raw) => String(raw).split('@')[0];

  // ── 记录该组的展开态，然后把它滚出视口再滚回来（触发回合回收/重挂） ──
  const markExpanded = `
    (() => {
      const expandedGroups = Array.from(document.querySelectorAll('.process-group'))
        .filter((g) => g.querySelector('.process-group__header') && g.querySelector('.process-group__collapsible.is-expanded'));
      return expandedGroups.length;
    })()
  `;
  const before = await wc.executeJavaScript(markExpanded);
  log("展开组数（滚走前）", before);

  // 滚到底再回顶部：让该回合被有界窗口回收
  const wheelUp = `
    (() => {
      const sc = document.querySelector('.chat-scroll-container');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      return true;
    })()
  `;
  let sawUnmounted = false;
  // 先向下滚到最底（让目标离开滞回区），再向上滚回目标。
  // 记录全程是否观察到目标变为占位——这是「跨卸载保持」成立的前提。
  for (let i = 0; i < 30; i += 1) {
    await wc.executeJavaScript(wheelUp);
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + sc.clientHeight * 0.9);
        return sc.scrollTop;
      })()
    `);
    await sleep(320);
    const raw = await wc.executeJavaScript(targetState);
    if (stateOf(raw) === 'placeholder') sawUnmounted = true;
    log(`down${i + 1}`, raw);
  }
  await sleep(1500);
  log("滚到底", await wc.executeJavaScript(STATS), "目标回合", await wc.executeJavaScript(targetState));

  // 再滚回目标回合附近：一直滚到它重新挂载为真实组件为止
  // （固定步数容易没滚到目标，之前就因此把「还没滚到」误读成「状态丢失」）
  let returned = false;
  for (let i = 0; i < 90; i += 1) {
    await wc.executeJavaScript(wheelUp);
    await wc.executeJavaScript(`
      (() => {
        const sc = document.querySelector('.chat-scroll-container');
        sc.scrollTop = Math.max(0, sc.scrollTop - sc.clientHeight * 0.9);
        return sc.scrollTop;
      })()
    `);
    await sleep(260);
    const raw = await wc.executeJavaScript(targetState);
    if (stateOf(raw) === 'placeholder') sawUnmounted = true;
    if (stateOf(raw) === 'turn') { returned = true; break; }
  }
  await sleep(1200);
  const after = await wc.executeJavaScript(markExpanded);
  log("滚回上方", await wc.executeJavaScript(STATS));
  log("目标回合最终状态", await wc.executeJavaScript(targetState));
  log("目标回合是否曾被回收为占位", sawUnmounted, "是否已滚回", returned);
  log("展开组数（回来后）", after, after >= before ? "✅ 状态保持" : "❌ 状态丢失");

  const ok = sawUnmounted && returned && after >= before;
  if (!sawUnmounted) log("⚠️ 目标回合未被回收，本次未真正验证跨卸载保持（可调低 gd:turn-window-max）");
  if (!returned) log("⚠️ 未滚回目标回合，状态结论不成立");
  win.destroy();
  app.exit(ok ? 0 : 1);
}).catch((e) => {
  console.error("[groups] failed", e);
  app.exit(1);
});
