import {
  BrowserWindow,
  WebContents,
  session,
  Menu,
  MenuItem,
  app,
} from "electron";
import * as path from "path";
import * as url from "url";
import log from "electron-log/main";

/**
 * 窗口信息接口
 */
export interface WindowInfo {
  windowId: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
  lastActiveAt: number;
  isActive: boolean;
  isMainApp: boolean;
  isVisible: boolean; // 窗口是否可见（前台/后台模式）
  metadata?: Record<string, any>; // 元数据支持（用于 session 隔离和作用域标识）
}

/**
 * 浏览器 Webview 管理器（基于主窗口内 <webview> 标签）
 *
 * 不再创建独立 BrowserWindow，而是在主窗口的前端渲染层中创建 <webview> 元素。
 * 主进程通过 mainWindow.webContents 的 did-attach-webview 事件获取 webview 的 WebContents。
 * 显隐通过 IPC 通知前端切换 CSS（visibility: hidden + z-index），不销毁 DOM 以保留渲染进度。
 */
export class BrowserWebviewManager {
  private mainWindow: BrowserWindow | null = null;
  private webviews = new Map<
    string,
    {
      webContents?: WebContents;
      info: WindowInfo;
      consoleLogs: string[];
      partition: string;
    }
  >();
  private maxWindows: number = Infinity;
  private nextWindowId = 1;

  // FIFO 队列：createWindow 按顺序 push，did-attach-webview 按顺序 shift
  private pendingAttachQueue: string[] = [];
  // windowId → { resolve, reject, timer }，did-attach-webview 时 resolve
  private pendingResolvers = new Map<
    string,
    { resolve: (wc: WebContents) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(_maxWindows?: number) {
    // 参数已忽略，不再限制窗口数量
  }

  /**
   * 绑定主窗口，监听 did-attach-webview 事件
   */
  attachMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    mainWindow.webContents.on(
      "did-attach-webview",
      (_event: any, webviewWC: WebContents) => {
        this.handleWebviewAttach(webviewWC);
      },
    );

    // 前端页面刷新时，所有 <webview> DOM 元素销毁，需清理 Manager 中的残留记录
    // 仅在真正离开应用页面时才清理（刷新/导航到非 app URL）
    mainWindow.webContents.on("did-start-navigation", (_e, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      const isAppUrl = url.startsWith("http://localhost:5173") ||
                       url.startsWith("file://") ||
                       url === "about:blank";
      if (!isAppUrl) {
        this.handleFrontendReload();
      }
    });

    log.info("BrowserWebviewManager attached to main window");
  }

  /**
   * 前端刷新/导航时的清理：
   * 所有 <webview> DOM 元素已销毁，清除 Manager 中的 webContents 引用，
   * 保留窗口元数据（webview 可由前端重新创建）。
   * 通知前端同步清空 store。
   */
  private handleFrontendReload(): void {
    if (this.webviews.size === 0 && this.pendingAttachQueue.length === 0) return;
    log.info(`Frontend reloading, clearing ${this.webviews.size} webview records`);

    // reject 所有 pending createWindow Promise
    for (const [windowId, resolver] of this.pendingResolvers) {
      clearTimeout(resolver.timer);
      resolver.reject(new Error("Frontend reloaded, webview creation aborted"));
    }
    this.pendingResolvers.clear();
    this.pendingAttachQueue.length = 0;

    this.webviews.clear();
  }

  /**
   * 处理 webview attach 事件：FIFO 队列取出 windowId，设置事件监听
   *
   * IPC 事件有序、Vue v-for 有序、Electron attach 有序 → FIFO 顺序可靠
   */
  private handleWebviewAttach(webviewWC: WebContents): void {
    const windowId = this.pendingAttachQueue.shift();

    if (!windowId) {
      log.warn(
        `did-attach-webview: no pending window in queue for webContentsId ${webviewWC.id}`,
      );
      return;
    }

    const wv = this.webviews.get(windowId);
    if (!wv) {
      log.warn(`did-attach-webview: windowId ${windowId} not in webviews map`);
      return;
    }

    wv.webContents = webviewWC;

    log.info(
      `Webview attached for window ${windowId}, webContentsId: ${webviewWC.id}`,
    );

    this.setupWebviewEvents(webviewWC, windowId);

    // resolve createWindow() 的 Promise
    const resolver = this.pendingResolvers.get(windowId);
    if (resolver) {
      clearTimeout(resolver.timer);
      this.pendingResolvers.delete(windowId);
      resolver.resolve(webviewWC);
    }
  }

  /**
   * 为 webview WebContents 设置所有事件监听
   */
  private setupWebviewEvents(webviewWC: WebContents, windowId: string): void {
    const wv = this.webviews.get(windowId);
    if (!wv) return;

    // 控制台日志内存缓存
    const logs = wv.consoleLogs;
    logs.length = 0;

    webviewWC.on("console-message", (event: any) => {
      const level = typeof event?.level === "string" ? event.level : "log";
      const message = event?.message ?? "";
      if (!message) return;
      const line = `[${level}] ${message}`;
      logs.push(line);
      if (logs.length > 200) logs.shift();
    });

    let mainFrameLoadFailed = false;

    // 新的主框架导航开始后，允许正常页面在完成时重新注入脚本。
    // Chromium 的内部错误页不会可靠地反映在 getURL() 中，因此不能只靠 URL 判断。
    webviewWC.on(
      "did-start-navigation",
      (_event, navigationUrl, _isInPlace, isMainFrame) => {
        if (isMainFrame && !navigationUrl.startsWith("chrome-error://")) {
          mainFrameLoadFailed = false;
        }
      },
    );

    // 导航开始时清空上一页的日志（did-start-loading 在整个加载周期只触发一次，不会因重定向重复）
    webviewWC.on("did-start-loading", () => {
      logs.length = 0;
    });

    // 在 guest 页面上下文中读取 favicon 并转换为 data URL，复用目标页面的 session/cookie。
    webviewWC.on("page-favicon-updated", (_event, favicons) => {
      log.info(
        `[Favicon] event window=${windowId} pageUrl=${webviewWC.getURL()} candidates=${Array.isArray(favicons) ? favicons.length : 0}`,
      );
      this.updateFaviconFromPage(webviewWC, windowId, favicons);
    });

    // 设置 Edge User Agent
    const edgeUserAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0";
    webviewWC.setUserAgent(edgeUserAgent);
    log.info(`Custom User Agent set to Edge for webview ${windowId}`);

    // 拦截新窗口请求，在当前 webview 打开
    webviewWC.setWindowOpenHandler(({ url }: { url: string }) => {
      log.info(
        `Intercepting new window request: ${url}, loading in current webview`,
      );
      webviewWC.loadURL(url);
      return { action: "deny" };
    });

    // 监听导航完成 — 注入反检测脚本和新标签页内容
    webviewWC.on("did-finish-load", () => {
      const w = this.webviews.get(windowId);
      if (w) {
        w.info.url = webviewWC.getURL();
      }
      const currentUrl = webviewWC.getURL();

      // 注入新建标签页内容
      if (currentUrl === "about:newtab" || currentUrl === "about:blank") {
        this.injectNewTabPage(webviewWC);
        return;
      }

      // 失败导航也可能触发 did-finish-load，且 getURL() 仍返回原目标 URL。
      // 只有当前主框架导航未失败时才向页面执行脚本。
      if (
        !mainFrameLoadFailed &&
        currentUrl &&
        !currentUrl.startsWith("chrome-error://") &&
        !currentUrl.startsWith("about:")
      ) {
        try {
          if (!webviewWC.isDestroyed())
            this.injectAntiDetectionScript(webviewWC);
        } catch {}
      }
    });

    // 加载失败只记录并通知前端，不在回调内取消或重入导航。
    // Chromium 仍可能在 did-fail-load 后完成内部错误页处理，回调内 loadURL 会造成导航重入。
    webviewWC.on(
      "did-fail-load",
      (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame) return;
        mainFrameLoadFailed = true;
        log.error(
          `Window ${windowId} webview failed to load: ${errorCode} - ${errorDescription}`,
        );
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send("window-navigation-error", {
            windowId,
            errorCode,
            errorDescription,
            validatedURL,
            url: webviewWC.getURL(),
          });
        }
      },
    );

    // 监听 webview 崩溃
    (webviewWC as any).on(
      "render-process-gone",
      (_event: any, details: any) => {
        log.error(
          `Window ${windowId} webview render process gone, reason=${details?.reason}, exitCode=${details?.exitCode}`,
        );
      },
    );

    log.info(`Window ${windowId} webview webContentsId: ${webviewWC.id}`);

    // 仅在 did-finish-load 后注入反检测脚本，避免 attach/失败导航期间操作 guest renderer。

    // 设置右键菜单
    this.setupContextMenu(webviewWC, windowId);

    // 监听 webview 销毁（前端刷新或关闭标签时 DOM 元素移除）
    // 清除 WebContents 引用，防止持有已销毁对象
    webviewWC.once("destroyed", () => {
      const wv = this.webviews.get(windowId);
      if (wv) {
        wv.webContents = undefined;
        log.info(`Window ${windowId} webContents destroyed`);
      }
    });
  }

  /**
   * 将页面 favicon 在 guest session 内转换为 data URL，避免主窗口直接请求目标站点图标。
   */
  private updateFaviconFromPage(
    webContents: WebContents,
    windowId: string,
    favicons: string[],
  ): void {
    const wv = this.webviews.get(windowId);
    if (!wv || webContents.isDestroyed() || !favicons?.length) return;

    const candidates = [...favicons]
      .map((icon) => {
        try {
          return new URL(icon, webContents.getURL()).href;
        } catch {
          return null;
        }
      })
      .filter((icon): icon is string => Boolean(icon));

    if (!candidates.length) {
      log.warn(`[Favicon] no valid candidates window=${windowId}`);
      return;
    }

    log.info(
      `[Favicon] normalized window=${windowId} candidates=${candidates.map((candidate) => {
        try {
          const parsed = new URL(candidate);
          return `${parsed.origin}${parsed.pathname}`;
        } catch {
          return "invalid";
        }
      }).join(" | ")}`,
    );

    const pageUrl = webContents.getURL();
    const guestSession = webContents.session as Electron.Session & {
      fetch?: (input: string, init?: RequestInit) => Promise<Response>;
    };

    (async () => {
      for (const [index, candidate] of candidates.entries()) {
        try {
          log.info(`[Favicon] fetch start window=${windowId} index=${index} url=${candidate}`);
          if (candidate.startsWith("data:image/")) {
            log.info(`[Favicon] data candidate accepted window=${windowId} index=${index}`);
            return candidate;
          }
          if (!guestSession.fetch) {
            log.warn(`[Favicon] session.fetch unavailable window=${windowId}`);
            return null;
          }

          const response = await guestSession.fetch(candidate, {
            credentials: "include",
            headers: { Referer: pageUrl },
          });
          const contentType = response.headers.get("content-type") || "";
          log.info(
            `[Favicon] fetch response window=${windowId} index=${index} status=${response.status} ok=${response.ok} mime=${contentType}`,
          );
          if (!response.ok) continue;
          if (!contentType.startsWith("image/")) continue;

          const buffer = Buffer.from(await response.arrayBuffer());
          log.info(`[Favicon] response bytes window=${windowId} index=${index} bytes=${buffer.length}`);
          if (buffer.length === 0) continue;
          return `data:${contentType.split(";", 1)[0]};base64,${buffer.toString("base64")}`;
        } catch (error: any) {
          log.warn(
            `[Favicon] fetch failed window=${windowId} index=${index} error=${error?.message || String(error)}`,
          );
        }
      }
      log.warn(`[Favicon] all candidates failed window=${windowId}`);
      return null;
    })().then((favicon) => {
      const current = this.webviews.get(windowId);
      if (!current || webContents.isDestroyed()) {
        log.warn(`[Favicon] result discarded window=${windowId} reason=window-destroyed`);
        return;
      }
      if (webContents.getURL() !== pageUrl) {
        log.warn(`[Favicon] result discarded window=${windowId} reason=navigated old=${pageUrl} current=${webContents.getURL()}`);
        return;
      }
      if (typeof favicon !== "string") {
        log.warn(`[Favicon] no data URL produced window=${windowId}`);
        return;
      }
      current.info.favicon = favicon;
      log.info(`[Favicon] data URL ready window=${windowId} chars=${favicon.length}`);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("window-favicon-updated", {
          windowId,
          favicon,
        });
        log.info(`[Favicon] IPC sent window=${windowId}`);
      } else {
        log.warn(`[Favicon] IPC skipped window=${windowId} reason=main-window-unavailable`);
      }
    }).catch((error) => {
      log.warn(`[Favicon] conversion failed window=${windowId} error=${error?.message || String(error)}`);
    });
  }

  /**
   * 获取 browser-preload.js 的 file:// URL
   */
  private getBrowserPreloadUrl(): string {
    const preloadPath = path.join(__dirname, "browser-preload.js");
    return url.pathToFileURL(preloadPath).href;
  }

  /**
   * 创建新的 webview 窗口
   * 通过 IPC 通知前端创建 <webview> 元素，主进程等待 did-attach-webview 事件
   * Promise 在 webview attach 完成后才 resolve，前端调用方可直接使用结果
   */
  async createWindow(
    url?: string,
    metadata?: Record<string, any>,
  ): Promise<WindowInfo> {
    if (!this.mainWindow) {
      throw new Error("Main window not initialized");
    }

    const windowId = `win_${this.nextWindowId++}`;
    const partition = "persist:browser_shared";

    log.info(`Creating new webview window: ${windowId}`);

    session.fromPartition(partition, { cache: true });

    const now = Date.now();
    const windowInfo: WindowInfo = {
      windowId,
      title: url || "New Window",
      url: url || "about:blank",
      createdAt: now,
      lastActiveAt: now,
      isActive: false,
      isMainApp: false,
      isVisible: false,
      metadata,
    };

    this.webviews.set(windowId, {
      info: windowInfo,
      consoleLogs: [],
      partition,
    });

    // 入队等待 did-attach-webview 匹配
    this.pendingAttachQueue.push(windowId);

    // 通知前端创建 <webview> 元素
    this.mainWindow.webContents.send("browser:create-webview", {
      windowId,
      partition,
      url: url || "about:blank",
      preloadUrl: this.getBrowserPreloadUrl(),
      metadata,
    });

    log.info(`Webview window created: ${windowId} (total: ${this.webviews.size})`);

    // 等待 did-attach-webview 事件 resolve（10s 超时）
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(windowId);
        // 从队列中移除超时的 windowId
        const idx = this.pendingAttachQueue.indexOf(windowId);
        if (idx !== -1) this.pendingAttachQueue.splice(idx, 1);
        reject(new Error(`Webview attach timeout for ${windowId}`));
      }, 10000);

      this.pendingResolvers.set(windowId, {
        resolve: () => resolve(),
        reject,
        timer,
      });
    }).catch((err) => {
      // attach 超时：清理记录，向上抛出
      this.webviews.delete(windowId);
      log.error(err.message);
      throw err;
    });

    return windowInfo;
  }

  /**
   * 关闭窗口
   */
  async closeWindow(windowId: string): Promise<boolean> {
    const wv = this.webviews.get(windowId);
    if (!wv) {
      // 可能在 pending 状态（attach 未完成）就被关闭
      const idx = this.pendingAttachQueue.indexOf(windowId);
      if (idx !== -1) this.pendingAttachQueue.splice(idx, 1);
      const resolver = this.pendingResolvers.get(windowId);
      if (resolver) {
        clearTimeout(resolver.timer);
        this.pendingResolvers.delete(windowId);
      }
      return false;
    }

    log.info(`🗑️ Closing webview window: ${windowId}`);

    try {
      // 通知前端销毁 <webview> 元素
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("browser:destroy-webview", {
          windowId,
        });
      }

      this.webviews.delete(windowId);

      return true;
    } catch (error) {
      log.error(`Error closing webview window ${windowId}:`, error);
      return false;
    }
  }

  /**
   * 获取所有窗口列表
   */
  getWindowList(): WindowInfo[] {
    return Array.from(this.webviews.values())
      .filter(
        ({ webContents }) => !webContents || !webContents.isDestroyed(),
      )
      .map(({ info, webContents }) => {
        if (webContents && !webContents.isDestroyed()) {
          return {
            ...info,
            url: webContents.getURL() || info.url,
            title: webContents.getTitle() || info.title,
          };
        }
        return info;
      });
  }

  /**
   * 获取指定窗口的 WebContents
   */
  getWebContents(windowId: string): WebContents | null {
    const wv = this.webviews.get(windowId);
    if (!wv) return null;
    if (wv.webContents && !wv.webContents.isDestroyed()) {
      return wv.webContents;
    }
    return null;
  }

  /**
   * 等待并获取指定窗口的 webview WebContents
   */
  async getWebviewWebContents(
    windowId: string,
    timeoutMs: number = 10000,
  ): Promise<WebContents | null> {
    const wv = this.webviews.get(windowId);
    if (!wv) return null;
    if (wv.webContents && !wv.webContents.isDestroyed()) {
      return wv.webContents;
    }

    // 等待 did-attach-webview 设置 webContents
    const pollInterval = 50;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));
      const w = this.webviews.get(windowId);
      if (w?.webContents && !w.webContents.isDestroyed()) {
        return w.webContents;
      }
    }
    log.warn(
      `getWebviewWebContents: webview not attached for window ${windowId} after ${timeoutMs}ms`,
    );
    return null;
  }

  /**
   * 获取指定窗口的外壳 WebContents（兼容接口，返回 webview 的 WebContents）
   */
  getShellWebContents(windowId: string): WebContents | null {
    return this.getWebContents(windowId);
  }

  /**
   * 根据 WebContents ID 查找对应的窗口 ID
   */
  getWindowIdByWebContentsId(webContentsId: number): string | null {
    for (const [windowId, wv] of this.webviews.entries()) {
      try {
        if (
          wv.webContents &&
          !wv.webContents.isDestroyed() &&
          wv.webContents.id === webContentsId
        ) {
          return windowId;
        }
      } catch {
        // webContents 可能已失效
      }
    }
    return null;
  }

  /**
   * 获取指定窗口的元数据
   */
  getWindowMetadata(windowId: string): Record<string, any> | undefined {
    const wv = this.webviews.get(windowId);
    return wv ? wv.info.metadata : undefined;
  }

  /** 获取指定窗口的控制台日志 */
  getConsoleLogs(windowId: string): string[] {
    const wv = this.webviews.get(windowId);
    return wv ? wv.consoleLogs : [];
  }

  /** 清空指定窗口的控制台日志 */
  clearConsoleLogs(windowId: string): void {
    const wv = this.webviews.get(windowId);
    if (wv) wv.consoleLogs.length = 0;
  }

  async closeAllWindows(): Promise<void> {
    const windowIds = Array.from(this.webviews.keys());
    for (const windowId of windowIds) {
      await this.closeWindow(windowId);
    }
  }

  /**
   * 清空所有浏览器自动化 session 数据（cookie、localStorage、indexedDB、缓存等）
   * 关闭所有 webview 窗口后清理共享 partition 数据
   * 不影响主程序的默认 session
   */
  async clearAllBrowserData(): Promise<void> {
    log.info("Clearing all browser automation session data...");

    // 先关闭所有窗口（销毁 webview DOM，释放 session 引用）
    await this.closeAllWindows();

    // 清理共享 session 的全部存储数据
    const sharedSession = session.fromPartition("persist:browser_shared", {
      cache: true,
    });
    await sharedSession.clearStorageData({
      storages: [
        "cookies",
        "filesystem",
        "indexdb",
        "localstorage",
        "shadercache",
        "websql",
        "serviceworkers",
        "cachestorage",
      ],
    });
    await sharedSession.clearCache();

    log.info("All browser shared session data cleared");
  }

  /**
   * 设置窗口为置顶悬浮模式（webview 架构下为 no-op）
   */
  setAlwaysOnTop(_windowId: string, _alwaysOnTop: boolean): void {
    // webview 架构下不适用，保留接口兼容
    log.warn("setAlwaysOnTop is not supported in webview architecture");
  }

  /**
   * 隐藏窗口（后台模式）— 通知前端切换 CSS
   */
  hideWindow(windowId: string): void {
    const wv = this.webviews.get(windowId);
    if (!wv) return;

    wv.info.isVisible = false;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("browser:set-webview-visibility", {
        windowId,
        visible: false,
      });
    }
    log.info(`Window ${windowId} hidden (background mode)`);
  }

  /**
   * 显示窗口（前台模式）— 通知前端切换 CSS
   */
  showWindow(windowId: string): void {
    const wv = this.webviews.get(windowId);
    if (!wv) return;

    wv.info.isVisible = true;
    wv.info.lastActiveAt = Date.now();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("browser:set-webview-visibility", {
        windowId,
        visible: true,
      });
    }
    log.info(`Window ${windowId} shown (foreground mode)`);
  }

  /**
   * 切换窗口显示状态
   */
  toggleWindowVisibility(windowId: string): boolean {
    const wv = this.webviews.get(windowId);
    if (!wv) return false;

    if (wv.info.isVisible) {
      this.hideWindow(windowId);
      return false;
    } else {
      this.showWindow(windowId);
      return true;
    }
  }

  /**
   * 获取窗口可见性状态
   */
  isWindowVisible(windowId: string): boolean {
    const wv = this.webviews.get(windowId);
    return wv ? wv.info.isVisible : false;
  }

  /**
   * 注入简约新建标签页（地球图标 + 提示文案）
   * 使用 executeJavaScript 直接写入 DOM，避免 loadURL 触发二次 did-finish-load
   */
  private injectNewTabPage(webContents: WebContents): void {
    if (webContents.isDestroyed()) return;
    // 用 <base> 标记当前 URL 为 about:newtab，地址栏显示友好
    const js = `
document.head.innerHTML = \`<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New Tab</title>\`;
document.body.innerHTML = '';
document.body.style.cssText = 'margin:0;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100vh;background:#ffffff;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;gap:12px';
var icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
icon.setAttribute('class','icon');
icon.setAttribute('width','48'); icon.setAttribute('height','48');
icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('fill','none');
icon.setAttribute('stroke','currentColor'); icon.setAttribute('stroke-width','1.5');
icon.setAttribute('stroke-linecap','round'); icon.setAttribute('stroke-linejoin','round');
icon.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';
icon.style.cssText = 'color:#9ca3af;margin-bottom:4px';
document.body.appendChild(icon);
var title = document.createElement('div'); title.className='title';
title.textContent = '开始浏览';
title.style.cssText = 'font-size:18px;font-weight:500';
document.body.appendChild(title);
var sub = document.createElement('div'); sub.className='subtext';
sub.textContent = '在地址栏输入 URL 以打开页面';
sub.style.cssText = 'font-size:13px;color:#9ca3af';
document.body.appendChild(sub);
document.title = '新标签页';
// 暗色模式适配
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.body.style.background = '#1a1b1e';
  document.body.style.color = '#e8e9ed';
  icon.style.color = '#6b6d73';
  sub.style.color = '#6b6d73';
}`;
    webContents.executeJavaScript(js).catch(() => {});
  }

  /**
   * 注入反检测脚本
   */
  private injectAntiDetectionScript(webContents: WebContents): void {
    if (webContents.isDestroyed()) return;
    const antiDetectionScript = `
      (function() {
        // 1. 移除 webdriver 标志
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });

        // 2. 伪装 plugins
        const fakePlugins = [
          {
            name: 'Chrome PDF Plugin',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            version: 'undefined',
            length: 1,
            item: () => null,
            namedItem: () => null,
          },
          {
            name: 'Native Client',
            filename: 'internal-nacl-plugin',
            description: '',
            version: 'undefined',
            length: 2,
            item: () => null,
            namedItem: () => null,
          },
        ];
        Object.defineProperty(navigator, 'plugins', {
          get: () => fakePlugins,
          configurable: true,
        });

        // 3. 伪装 mimeTypes
        Object.defineProperty(navigator, 'mimeTypes', {
          get: () => ({
            length: 4,
            item: () => null,
            namedItem: () => null,
          }),
          configurable: true,
        });

        // 4. 伪装硬件信息
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8,
          configurable: true,
        });
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8,
          configurable: true,
        });
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => 0,
          configurable: true,
        });

        // 5. 伪装语言环境
        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en'],
          configurable: true,
        });
        Object.defineProperty(navigator, 'language', {
          get: () => 'zh-CN',
          configurable: true,
        });

        // 6. 伪装 platform
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32',
          configurable: true,
        });

        // 7. 伪装 vendor
        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.',
          configurable: true,
        });

        // 8. 覆盖 Permissions API
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = async (permissionDesc) => {
          const name = typeof permissionDesc === 'string' ? permissionDesc : permissionDesc.name;
          const allowedPermissions = ['notifications', 'clipboard-read', 'clipboard-write'];
          if (allowedPermissions.includes(name)) {
            return { state: 'prompt', onchange: null };
          }
          return originalQuery.call(navigator.permissions, permissionDesc);
        };

        // 9. 覆盖 Chrome 自动化相关属性
        Object.defineProperty(window, 'chrome', {
          get: () => ({
            runtime: {
              OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
              OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
              PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', MIPS64EL: 'mips64el', MIPSEL: 'mipsel', X86_32: 'x86-32', X86_64: 'x86-64' },
              PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', MIPS64EL: 'mips64el', MIPSEL: 'mipsel', MIPSEL64: 'mipsel64', X86_32: 'x86-32', X86_64: 'x86-64' },
              PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
              RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
              OnConnectEvent: { addListener: () => {} },
              OnMessageEvent: { addListener: () => {} },
            },
            loadTimes: () => ({
              commitLoadTime: performance.now() / 1000,
              connectionInfo: 'h2',
              finishDocumentLoadTime: performance.now() / 1000,
              finishLoadTime: performance.now() / 1000,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: performance.now() / 1000,
              navigationStart: performance.now() / 1000,
              npnNegotiatedProtocol: 'h2',
              requestTime: performance.now() / 1000,
              startLoadTime: performance.now() / 1000,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
            }),
            csi: () => ({ startE: performance.now(), onloadT: performance.now(), pageT: performance.now() }),
            app: {
              isInstalled: false,
              InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
              RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
              getDetails: () => null,
              getIsInstalled: () => false,
            },
            webstore: {
              onInstallStageChanged: { addListener: () => {} },
              onDownloadProgress: { addListener: () => {} },
            },
          }),
          configurable: true,
        });

        // 10. 覆盖 Notification 权限
        const originalNotification = window.Notification;
        Object.defineProperty(window, 'Notification', {
          get: () => {
            return class extends originalNotification {
              static get permission() { return 'default'; }
              static requestPermission() { return Promise.resolve('default'); }
            };
          },
          configurable: true,
        });

        // 11. WebGL 指纹混淆
        const getParameterProxyHandler = {
          apply: function(target, thisArg, args) {
            const param = args[0];
            if (param === 37445) return 'Intel Inc.';
            if (param === 37446) return 'Intel Iris Xe Graphics';
            return target.apply(thisArg, args);
          }
        };

        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          const context = originalGetContext.call(this, type, ...args);
          if (context && (type === 'webgl' || type === 'experimental-webgl')) {
            const originalGetParameter = context.getParameter;
            context.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
          }
          return context;
        };

        // 12. 防止 iframe 中检测
        try {
          const iframe = document.createElement('iframe');
          iframe.srcdoc = '<html></html>';
          document.body.appendChild(iframe);
          const iframeNavigator = iframe.contentWindow.navigator;
          Object.defineProperty(iframeNavigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
          });
          document.body.removeChild(iframe);
        } catch (e) {}


      })();
    `;

    webContents.executeJavaScript(antiDetectionScript, true).catch((err) => {
      log.warn("Failed to inject anti-detection script:", err);
    });
  }

  /**
   * 为 webview 设置右键菜单
   */
  private setupContextMenu(webContents: WebContents, windowId: string): void {
    webContents.on("context-menu", (_event, params) => {
      const menu = new Menu();

      menu.append(
        new MenuItem({
          label: "后退",
          enabled: webContents.navigationHistory.canGoBack(),
          click: () => {
            if (webContents.navigationHistory.canGoBack()) {
              webContents.navigationHistory.goBack();
            }
          },
        }),
      );

      menu.append(
        new MenuItem({
          label: "前进",
          enabled: webContents.navigationHistory.canGoForward(),
          click: () => {
            if (webContents.navigationHistory.canGoForward()) {
              webContents.navigationHistory.goForward();
            }
          },
        }),
      );

      menu.append(
        new MenuItem({
          label: "刷新",
          click: () => {
            webContents.reload();
          },
        }),
      );

      menu.append(new MenuItem({ type: "separator" }));

      menu.append(
        new MenuItem({
          label: "打开开发者工具",
          click: () => {
            webContents.openDevTools({ mode: "right" });
          },
        }),
      );

      menu.append(new MenuItem({ type: "separator" }));

      // 隐藏/显示窗口
      const wv = this.webviews.get(windowId);
      if (wv) {
        const isVisible = wv.info.isVisible;
        menu.append(
          new MenuItem({
            label: isVisible ? "隐藏窗口（后台模式）" : "显示窗口（前台模式）",
            click: () => {
              if (isVisible) {
                this.hideWindow(windowId);
              } else {
                this.showWindow(windowId);
              }
            },
          }),
        );

        // 静音/取消静音
        const wc = wv.webContents;
        if (wc && !wc.isDestroyed()) {
          const isMuted = wc.isAudioMuted();
          menu.append(
            new MenuItem({
              label: isMuted ? "取消静音" : "静音",
              type: "checkbox",
              checked: isMuted,
              click: (item) => {
                wc.setAudioMuted(item.checked);
                log.info(`Window ${windowId} audio muted: ${item.checked}`);
              },
            }),
          );
        }
      }

      // 显示菜单（使用主窗口）
      menu.popup({ window: this.mainWindow || undefined });
    });
  }
}

// 保持向后兼容的导出
export { BrowserWebviewManager as BrowserWindowManager };
export { BrowserWebviewManager as BrowserTabManager };
export type { WindowInfo as TabInfo };
