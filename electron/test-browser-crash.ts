/**
 * Browser Crash Reproduction Test
 *
 * 使用现有浏览器自动化基础设施（BrowserWindowManager / BrowserAutomationService）
 * 创建一个 webview 窗口并导航到不可达 URL，检测是否导致 Electron 进程意外退出。
 *
 * 分层测试模式（通过环境变量 TEST_LEVEL 控制）：
 *   level=1 — 纯 BrowserWindow.loadURL(badUrl)
 *   level=2 — BrowserWindowManager.createWindow(badUrl) + 事件监听
 *   level=3 — 通过 BrowserAutomationService 走底层窗口创建（不含 waitForPageLoad）
 *   level=4 — 完整 BrowserAutomationService.createWindow（含 waitForPageLoad）
 *   level=5 — 完整链路 + notifyWindowUpdate IPC 到主窗口
 *
 * 用法：
 *   npx tsc --project tsconfig.json && cross-env TEST_LEVEL=4 electron dist/test-browser-crash.js
 *   echo "Exit code: $?"
 */

import { app, BrowserWindow, WebContents, ipcMain } from "electron";
import * as path from "path";

// ── 日志 ──
const log = {
  info: (...args: any[]) => console.log("[Test]", ...args),
  warn: (...args: any[]) => console.warn("[Test]", ...args),
  error: (...args: any[]) => console.error("[Test]", ...args),
};

// ── 配置 ──
const BAD_URL = "http://localhost:3001/"; // ERR_CONNECTION_REFUSED（用户真实场景）
const TEST_TIMEOUT = 10000;
const TEST_LEVEL = parseInt(process.env.TEST_LEVEL || "1", 10);

// ── 状态 ──
let mainWindow: BrowserWindow | null = null;
let exitIntentional = false;
let didFinish = false;
let eventLog: string[] = [];
let quitReason = "";

function trackEvent(label: string, data?: string) {
  const line = data ? `[${label}] ${data}` : `[${label}]`;
  eventLog.push(line);
  log.info(line);
}

// 追踪退出原因
app.on("before-quit", (e) => {
  quitReason = "before-quit fired";
  log.warn("⚠ before-quit — app is about to quit");
});
app.on("will-quit", (e) => {
  log.warn("⚠ will-quit — app will quit. Reason:", quitReason);
});
app.on("window-all-closed", () => {
  log.warn("⚠ window-all-closed — all windows closed");
});

// ── 拦截 process.exit 追踪退出源 ──
const origExit = process.exit;
process.exit = ((code?: any) => {
  log.error("✗ process.exit CALLED with code:", code);
  log.error("  Stack:", new Error().stack?.split("\n").slice(2).join("\n    "));
  // 让原版继续执行
  (origExit as any)(code);
}) as typeof process.exit;

process.on("exit", (code) => {
  if (!exitIntentional) {
    log.error("✗ UNEXPECTED EXIT — process exited before test completed!");
    log.error("  Exit code:", code);
    log.error("  Events captured:", eventLog.length);
    eventLog.forEach((e, i) => log.error(`  ${i + 1}. ${e}`));
  }
});

// ──= 级别1 =─ 纯 BrowserWindow.loadURL ──
async function testLevel1(): Promise<void> {
  trackEvent("LEVEL1", "BrowserWindow.loadURL(" + BAD_URL + ")");

  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    trackEvent("did-fail-load", `${code} - ${desc}`);
  });
  win.webContents.on("did-finish-load", () => {
    trackEvent("did-finish-load", win.webContents.getURL());
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    trackEvent("render-process-gone", `reason=${details.reason}`);
  });

  try {
    await win.loadURL(BAD_URL);
  } catch (err: any) {
    trackEvent("loadURL rejected", err.message);
  }

  await new Promise((r) => setTimeout(r, 2000));
  win.close();
}

// ──= 级别2 =─ BrowserWindowManager.createWindow(badUrl) + 事件 ──
async function testLevel2(): Promise<void> {
  trackEvent("LEVEL2", "BrowserWindowManager.createWindow(" + BAD_URL + ")");

  const mod = await import("./browser-tab-manager.js");
  const BrowserWindowManager = mod.BrowserWindowManager;
  const windowManager = new BrowserWindowManager(mainWindow!, 6);

  mainWindow!.webContents.on("render-process-gone", (_e, details) => {
    trackEvent("MAIN render-process-gone", `reason=${details.reason}`);
  });

  try {
    const info = await windowManager.createWindow(BAD_URL);
    trackEvent("window created", info.windowId);

    const wc = await pollWebviewWC(windowManager, info.windowId);
    if (wc) {
      wc.on("did-fail-load", (_e, code, desc) => {
        trackEvent("webview did-fail-load", `${code} - ${desc}`);
      });
      wc.on("did-finish-load", () => {
        trackEvent("webview did-finish-load", wc.getURL());
      });
      wc.on("render-process-gone", (_e, details) => {
        trackEvent("webview render-process-gone", `reason=${details.reason}`);
      });
      await new Promise((r) => setTimeout(r, 3000));
      trackEvent("webview URL", wc.getURL());
    }

    await windowManager.closeWindow(info.windowId);
  } catch (err: any) {
    trackEvent("createWindow error", err.message);
  }
}

// ──= 级别6 =─ 最小化 webview 测试（不依赖 BrowserWindowManager，通过 shell:init IPC） ──
async function testLevel6(): Promise<void> {
  trackEvent("LEVEL6", "minimal webview via shell:init IPC → bad URL");

  // 创建一个带 <webview> 标签的外壳窗口
  const shellWin = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "browser-shell-preload.js"),
    },
  });

  const shellHTML = path.join(__dirname, "..", "browser-shell.html");
  await shellWin.loadFile(shellHTML);

  // 等 webview 挂载
  await new Promise<void>((resolve) => {
    shellWin.webContents.on("did-attach-webview", (_e, wc) => {
      trackEvent("webview attached", `id=${wc.id}`);

      wc.on("did-fail-load", (_ev, code, desc) => {
        trackEvent("webview did-fail-load", `${code} - ${desc}`);
      });
      wc.on("did-finish-load", () => {
        trackEvent("webview did-finish-load", wc.getURL());
      });
      wc.on("render-process-gone", (_ev, details) => {
        trackEvent("webview render-process-gone", `reason=${details.reason}`);
      });

      resolve();
    });
  });

  // 发送 shell:init 导航到坏 URL
  const windowId = "test_win_1";
  const sessionId = "persist:test_session";
  shellWin.webContents.send("shell:init", {
    targetUrl: BAD_URL,
    windowId,
    sessionId,
  });

  // 等导航结果
  await new Promise((r) => setTimeout(r, 5000));
  trackEvent("test done", "shell window survived 5s");

  shellWin.close();
}

// ──= 级别7 =─ 纯 webview 标签 + 直接 src 设置（无 shell:init IPC） ──
async function testLevel7(): Promise<void> {
  trackEvent("LEVEL7", "minimal webview: direct src attribute (no shell:init IPC)");

  const shellWin = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "browser-shell-preload.js"),
    },
  });

  shellWin.webContents.on("did-attach-webview", (_e, wc) => {
    trackEvent("webview attached", `id=${wc.id}`);
    wc.on("did-fail-load", (_ev, code, desc) => {
      trackEvent("webview did-fail-load", `${code} - ${desc}`);
    });
    wc.on("did-finish-load", () => {
      trackEvent("webview did-finish-load", wc.getURL());
    });
    wc.on("render-process-gone", (_ev, details) => {
      trackEvent("webview render-process-gone", `reason=${details.reason}`);
    });
  });

  // 直接加载含 webview src 的 HTML
  const inlineHTML = `
    <!DOCTYPE html>
    <html><body>
    <webview id="wv" preload="${path.join(__dirname, "browser-preload.js").replace(/\\/g, "/")}"
      src="${BAD_URL}" style="width:100%;height:100%"></webview>
    </body></html>
  `;
  await shellWin.loadURL("data:text/html," + encodeURIComponent(inlineHTML));

  await new Promise((r) => setTimeout(r, 5000));
  trackEvent("test done", "shell window survived 5s");
  shellWin.close();
}

// ──= 级别3 =─ BrowserAutomationService，不走 waitForPageLoad ──
async function testLevel3(): Promise<void> {
  trackEvent("LEVEL3", "service-based, no waitForPageLoad");
  await testUsingService(false);
}

// ──= 级别4 =─ BrowserAutomationService.createWindow（含 waitForPageLoad） ──
async function testLevel4(): Promise<void> {
  trackEvent("LEVEL4", "service.createWindow with waitForPageLoad");
  await testUsingService(true);
}

// ──= 级别5 =─ 完整链路 ──
async function testLevel5(): Promise<void> {
  trackEvent("LEVEL5", "full chain (same as LEVEL4 — notifyWindowUpdate already active)");
  await testUsingService(true);
}

// ── 辅助 ──
async function testUsingService(useWaitForPageLoad: boolean): Promise<void> {
  const mod1 = await import("./browser-tab-manager.js");
  const mod2 = await import("./browser-automation-service.js");
  const BrowserWindowManager = mod1.BrowserWindowManager;
  const BrowserAutomationService = mod2.BrowserAutomationService;

  const windowManager = new BrowserWindowManager(mainWindow!, 6);
  const service = new BrowserAutomationService();
  service.initializeWindowManager(windowManager);

  mainWindow!.webContents.on("render-process-gone", (_e, details) => {
    trackEvent("MAIN render-process-gone", `reason=${details.reason}`);
  });

  try {
    let windowId: string;
    if (useWaitForPageLoad) {
      windowId = await service.createWindow(BAD_URL);
    } else {
      const info = await windowManager.createWindow(BAD_URL);
      windowId = info.windowId;
    }
    trackEvent("service createWindow done", "windowId=" + windowId);
    await new Promise((r) => setTimeout(r, 3000));
  } catch (err: any) {
    trackEvent("service createWindow threw", err.message);
  }
}

// ── 轮询获取 webview WebContents ──
async function pollWebviewWC(
  wm: any,
  windowId: string,
  timeoutMs = 10000,
): Promise<WebContents | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = wm.windows?.get(windowId);
    const wc: WebContents | undefined = entry?.webviewWebContents;
    if (wc && !wc.isDestroyed()) return wc;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

// ── 清理 ──
async function cleanup() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }
}

// ──= 入口 =────────────────────────────────────────────────
app.whenReady().then(async () => {
  log.info("===========================================");
  log.info("Browser Crash Test — Level", TEST_LEVEL);
  log.info("Bad URL:", BAD_URL);
  log.info("Timeout:", TEST_TIMEOUT + "ms");
  log.info("===========================================");

  // 创建隐藏的主窗口
  mainWindow = new BrowserWindow({
    width: 1, height: 1, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await mainWindow.loadURL("about:blank");

  // 注册浏览器自动化所需的 IPC 处理器（匹配生产环境）
  ipcMain.handle("browser:get-user-scripts", async (_event, _currentUrl: string) => {
    return { success: true, scripts: [] };
  });

  try {
    switch (TEST_LEVEL) {
      case 1:  await testLevel1(); break;
      case 2:  await testLevel2(); break;
      case 3:  await testLevel3(); break;
      case 4:  await testLevel4(); break;
      case 5:  await testLevel5(); break;
      case 6:  await testLevel6(); break;
      case 7:  await testLevel7(); break;
      default:
        for (let lv = 1; lv <= 5; lv++) {
          trackEvent("RUNNING LEVEL", String(lv));
          switch (lv) {
            case 1: await testLevel1(); break;
            case 2: await testLevel2(); break;
            case 3: await testLevel3(); break;
            case 4: await testLevel4(); break;
            case 5: await testLevel5(); break;
          }
          trackEvent("LEVEL COMPLETE", String(lv));
          await new Promise((r) => setTimeout(r, 500));
        }
        break;
    }

    didFinish = true;
    log.info("✓ Test completed — no unexpected exit");
  } catch (err: any) {
    log.error("Test threw unexpected error:", err.message);
  }

  await cleanup();
  exitIntentional = true;
  await new Promise((r) => setTimeout(r, 500));
  log.info("===========================================");
  log.info("Result: PASS (exit code 0)");
  log.info("===========================================");
  app.quit();
});

setTimeout(() => {
  if (!didFinish) {
    log.error("✗ TEST TIMEOUT — process survived but test did not complete");
    cleanup().then(() => { exitIntentional = true; app.quit(); });
  }
}, TEST_TIMEOUT);

process.on("uncaughtException", (err) => {
  log.error("✗ UNCAUGHT EXCEPTION:", err.message);
});
process.on("unhandledRejection", (reason) => {
  log.error("✗ UNHANDLED REJECTION:", reason);
});
