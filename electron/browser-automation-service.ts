import log from "electron-log/main";
import * as path from "path";
import * as fs from "fs";
import { nativeImage } from "electron";
import { BrowserWindowManager, WindowInfo } from "./browser-tab-manager";
import {
  buildSimpleTreeFromLegacyStruct,
  captureAccessibilitySnapshot,
  measureSimpleTree,
} from "./accessibility-snapshot";
import { BrowserBridgeError } from "./browser-errors";
import { assertNavigableUrl } from "./browser-url";
import {
  BrowserLocatorEngine,
  LocatorDescriptor,
  LocatorWaitState,
} from "./browser-locator-engine";
import {
  ActionOptions,
  BrowserActionEngine,
  FillOptions,
  PressOptions,
  ScrollOptions,
  SelectOptions,
  WaitState,
} from "./browser-action-engine";

export { BrowserBridgeError };


/**
 * 浏览器自动化工具请求接口
 */
export interface ToolRequest {
  id: string;
  method: string;
  params: any;
}

/**
 * 浏览器自动化工具响应接口
 */
export interface ToolResponse {
  id: string;
  result?: any;
  error?: string;
}

/**
 * 浏览器 Bridge 的结构化错误。
 *
 * 通过 bridge-server 序列化为 { code, message, details }，
 * 让 backend 能把 NOT_FOUND / STALE_REF / TIMEOUT 等语义透传给脚本。
 */
export type BrowserWaitUntil = "none" | "domcontentloaded" | "load";

/**
 * 浏览器自动化核心服务（基于独立窗口系统)
 *
 * 职责说明：
 * - 管理多个独立窗口生命周期（基于 BrowserWindowManager）
 * - 执行浏览器自动化操作（导航、截图、JS执行等）
 * - 清理无痕数据
 * - 超时自动关闭
 *
 * 与通信协议解耦，可被 IPC、TCP、UDP 等多种协议复用
 *
 * 注意：每个窗口使用独立的 session，与主窗口隔离，避免影响主窗口认证状态
 */
export class BrowserAutomationService {
  private windowManager: BrowserWindowManager | null = null;
  private actionEngine: BrowserActionEngine | null = null;
  private readonly locatorEngine = new BrowserLocatorEngine();
  // 每个 session (createdBy) 的当前标签映射
  private currentTabs = new Map<string, string>();
  // 同一 webContents 的 CDP 快照必须串行，避免 debugger attach/command 冲突
  private snapshotLocks = new Map<number, Promise<void>>();

  /**
   * 初始化窗口管理器（必须在应用启动时调用）
   */
  initializeWindowManager(windowManager: BrowserWindowManager): void {
    this.windowManager = windowManager;
    this.actionEngine = new BrowserActionEngine({
      isWindowVisible: (windowId) =>
        typeof (windowManager as any).isWindowVisible === "function"
          ? windowManager.isWindowVisible(windowId)
          : true,
      setWebviewRenderable: (windowId, renderable) => {
        if (typeof (windowManager as any).setWebviewRenderable === "function") {
          windowManager.setWebviewRenderable(windowId, renderable);
        }
      },
    });
    log.info("BrowserAutomationService initialized with WindowManager");
  }

  private async withSnapshotLock<T>(
    webContents: Electron.WebContents,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.snapshotLocks.get(webContents.id) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.snapshotLocks.set(webContents.id, queued);

    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.snapshotLocks.get(webContents.id) === queued) {
        this.snapshotLocks.delete(webContents.id);
      }
    }
  }

  /**
   * 创建新的浏览器窗口
   * @param url - 初始 URL（可选）
   * @param metadata - 元数据（可选，用于 session 隔离和作用域标识）
   * @returns 窗口ID
   */
  async createWindow(
    url?: string,
    metadata?: Record<string, any>,
    waitUntil: BrowserWaitUntil = "load",
  ): Promise<string> {
    if (url) {
      assertNavigableUrl(url, "createWindow");
    }
    if (!this.windowManager) {
      throw new Error(
        "WindowManager not initialized. Call initializeWindowManager() first.",
      );
    }

    const windowInfo = await this.windowManager.createWindow(url, metadata);

    // 等待初始导航完成：waitUntil=none 时完全跳过，由脚本自行决定何时观察。
    if (url && windowInfo.windowId && waitUntil !== "none") {
      try {
        const wc = await this.windowManager.getWebviewWebContents(
          windowInfo.windowId,
        );
        if (wc) {
          if (waitUntil === "domcontentloaded") {
            await this.waitForDomReady(wc);
          } else {
            await this.waitForPageLoad(wc);
          }
          // 页面可能落在 chrome-error 错误页
          const currentUrl = wc.getURL();
          if (currentUrl.startsWith("chrome-error://")) {
            throw new BrowserBridgeError(
              "NAVIGATION_FAILED",
              `Initial navigation failed: page loaded chrome-error for ${url}`,
              { url, currentUrl },
            );
          }
        }
      } catch (error: any) {
        // 导航失败/超时，不关闭窗口——页面可能仍有内容或稍后可用
        log.warn(
          `Browser window navigation warning: ${windowInfo.windowId} - ${error.message}`,
          metadata,
        );
        throw error;
      }
    }

    log.info(`Browser window created: ${windowInfo.windowId}`, metadata);
    return windowInfo.windowId;
  }

  /**
   * 设置当前标签
   */
  private setCurrentTab(createdBy: string, windowId: string): void {
    this.currentTabs.set(createdBy, windowId);
  }

  /**
   * 获取当前标签 ID
   */
  private getCurrentTabId(createdBy: string): string | undefined {
    const wid = this.currentTabs.get(createdBy);
    if (!wid) return undefined;
    // 验证窗口仍然存在
    if (!this.windowManager) return undefined;
    const windows = this.windowManager.getWindowList();
    if (!windows.find((w) => w.windowId === wid)) {
      this.currentTabs.delete(createdBy);
      return undefined;
    }
    return wid;
  }

  /**
   * 清除当前标签映射
   */
  private clearCurrentTab(createdBy: string): void {
    this.currentTabs.delete(createdBy);
  }

  /**
   * 确保有当前标签可用，否则抛出明确错误
   */
  private async ensureCurrentTab(createdBy: string): Promise<string> {
    if (!createdBy) {
      throw new Error("No active tab and no session context. Call browser_navigate(url, new_tab=true) first.");
    }
    const wid = this.getCurrentTabId(createdBy);
    if (!wid) {
      throw new Error(
        `No active tab for this session. Call browser_navigate(url, new_tab=true) to open one.`,
      );
    }
    return wid;
  }

  /**
   * 确保窗口存在
   */
  private async ensureWindow(
    windowId: string,
    createdBy?: string,
  ): Promise<{ windowId: string; windowInfo: WindowInfo }> {
    if (!this.windowManager) {
      throw new Error("WindowManager not initialized");
    }

    // windowId 为空时回退到当前标签
    let resolvedWindowId = windowId;
    if (!resolvedWindowId && createdBy) {
      resolvedWindowId = await this.ensureCurrentTab(createdBy);
    }

    if (!resolvedWindowId) {
      throw new Error(
        "window_id is required (or have an active tab). Call browser_navigate(url, new_tab=true) first.",
      );
    }

    const windows = this.windowManager.getWindowList();
    const windowInfo = windows.find((w) => w.windowId === resolvedWindowId);

    if (!windowInfo) {
      throw new Error(
        `Window ${resolvedWindowId} not found. Use browser_tabs(action="list") to see available tabs.`,
      );
    }

    // 所有权验证：如果提供了 createdBy，必须匹配窗口的 createdBy
    if (createdBy && windowInfo.metadata?.createdBy && windowInfo.metadata.createdBy !== createdBy) {
      throw new Error(
        `Permission denied: window ${resolvedWindowId} does not belong to this session.`,
      );
    }

    return { windowId: resolvedWindowId, windowInfo };
  }

  /**
   * 销毁所有窗口并清理数据
   */
  async destroy(): Promise<void> {
    if (!this.windowManager) {
      log.info("No windows to destroy");
      return;
    }

    log.info("Destroying all browser windows...");

    try {
      const windows = this.windowManager.getWindowList();
      for (const win of windows) {
        // 不关闭主应用窗口
        if (!win.isMainApp) {
          try {
            await this.windowManager.closeWindow(win.windowId);
          } catch (error) {
            log.error(`Error closing window ${win.windowId}:`, error);
          }
        }
      }

      log.info("All windows destroyed");
      this.currentTabs.clear();
    } catch (error) {
      log.error("Error during window destruction:", error);
    }
  }

  /**
   * 导航到指定 URL（统一接口：支持新开标签和当前标签导航）
   *
   * @param url       目标 URL
   * @param newTab    true=新开标签并设为当前; false=在当前标签导航（无标签时自动创建）
   * @param createdBy 会话标识，用于所有权隔离
   * @param sessionPath 会话工作路径
   * @param sessionId  会话 ID
   * @param windowId   显式标签 ID（可选，兼容旧接口）
   */
  async navigate(
    url: string,
    newTab: boolean,
    createdBy: string,
    sessionPath?: string,
    sessionId?: string,
    waitUntil: BrowserWaitUntil = "load",
  ): Promise<any> {
    assertNavigableUrl(url, "browser_navigate");

    if (!this.windowManager) {
      throw new Error("WindowManager not initialized");
    }

    let wid: string;

    if (newTab) {
      // 新开标签
      const metadata: Record<string, any> = {};
      if (sessionPath) metadata.sessionPath = sessionPath;
      if (sessionId) metadata.sessionId = sessionId;
      if (createdBy) metadata.createdBy = createdBy;

      wid = await this.createWindow(url, metadata, waitUntil);
      if (createdBy) this.setCurrentTab(createdBy, wid);

      const wc = this.windowManager.getWebContents(wid);
      return {
        ok: true,
        tabId: wid,
        // wait_until=none 时 webview 可能还没提交导航，优先返回请求的 URL
        url: waitUntil === "none" ? url : wc?.getURL() || url,
        title: wc?.getTitle() || "",
        readyState: await this.readReadyState(wc),
      };
    }

    // 在当前标签导航（无标签时自动创建）
    if (createdBy) {
      const currentWid = this.getCurrentTabId(createdBy);
      if (!currentWid) {
        // 无当前标签，自动创建
        return this.navigate(url, true, createdBy, sessionPath, sessionId, waitUntil);
      }
      wid = currentWid;
    } else {
      throw new BrowserBridgeError(
        "TAB_NOT_FOUND",
        "No active tab. Call browser_navigate(url, new_tab=true) first.",
      );
    }

    // 所有权验证
    await this.ensureWindow(wid, createdBy);

    log.info(`Navigating to: ${url} (tab: ${wid})`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    // 拒绝 javascript: 协议（安全风险，且会导致等待挂起）
    // 统一白名单已在方法入口校验；这里保留注释说明历史原因。

    let navError: Error | null = null;
    const navigation = webContents.loadURL(url).catch((err: any) => {
      if (this.isAbortedNavigationError(err)) return;
      navError = err instanceof Error ? err : new Error(String(err));
    });

    if (waitUntil === "none") {
      // 不等待页面加载；loadURL 的失败只记日志，由后续显式等待/观察暴露
      void navigation.then(() => {
        if (navError) {
          log.warn(`Navigation (no-wait) failed for ${url}: ${navError.message}`);
        }
      });
      return {
        ok: true,
        tabId: wid,
        url,
        title: webContents.getTitle(),
        readyState: "loading",
      };
    }

    try {
      if (waitUntil === "domcontentloaded") {
        // 让 loadURL 先进入 loading，避免 waitForDomReady 对旧页面立即 resolve
        await new Promise((r) => setImmediate(r));
        void navigation.then(() => {
          if (navError) {
            log.warn(
              `Navigation (domcontentloaded) later failed for ${url}: ${navError.message}`,
            );
          }
        });
        await this.waitForDomReady(webContents);
      } else {
        await navigation;
        await this.waitForPageLoad(webContents);
      }

      if (navError) {
        throw new BrowserBridgeError(
          "NAVIGATION_FAILED",
          `Navigation failed: ${(navError as Error).message}`,
          { url },
        );
      }

      const currentUrl = webContents.getURL();
      if (currentUrl.startsWith("chrome-error://")) {
        throw new BrowserBridgeError(
          "NAVIGATION_FAILED",
          `Navigation failed: page loaded chrome-error for ${url}`,
          { url, currentUrl },
        );
      }

      return {
        ok: true,
        tabId: wid,
        url: currentUrl,
        title: webContents.getTitle(),
        readyState: await this.readReadyState(webContents),
      };
    } catch (error: any) {
      if (error instanceof BrowserBridgeError) throw error;
      throw new BrowserBridgeError(
        "NAVIGATION_FAILED",
        `Navigation failed: ${error?.message || error}`,
        { url },
      );
    }
  }

  /**
   * 截图当前页面，返回 PNG 字节（base64）。
   *
   * 不落盘：截图只有一份持久副本，由后端转码后写入会话附件目录
   * （sessions/<id>/images|previews/）。工作区不再产生全尺寸 PNG。
   *
   * wantsSave=true 时跳过降采样：调用方显式要求导出原始质量（工作区另存）。
   * 其余情况按模型侧预算降采样，避免几 MB 的 PNG base64 过桥。
   */
  async screenshot(
    createdBy: string,
    fullPage: boolean = false,
    wantsSave: boolean = false,
  ): Promise<any> {
    if (!this.windowManager) {
      throw new Error("WindowManager not initialized");
    }

    const { windowId: wid } = await this.ensureWindow("", createdBy);

    log.info(`Taking screenshot (tab: ${wid})...`);

    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    let renderableToggled = false;
    try {
      await this.waitForPageLoad(webContents);

      // webview visibility:hidden 时 Chromium 不产生合成器帧，CDP/capturePage 都无法截图。
      // 临时将 webview 设为可渲染（视口内 + opacity:0），截图后恢复。
      // 已经可见的标签不需要切换，避免每次截图都闪一下。
      const wasVisible = this.windowManager.isWindowVisible(wid);
      if (!wasVisible) {
        this.windowManager.setWebviewRenderable(wid, true);
        renderableToggled = true;
        // 等待合成器产生帧
        await new Promise((r) => setTimeout(r, 300));
      } else {
        await new Promise((r) => setTimeout(r, 50));
      }

      let buffer: Buffer;
      let imgWidth: number;
      let imgHeight: number;

      if (fullPage) {
        // fullPage: 使用 CDP captureBeyondViewport 截整页
        buffer = await this.cdpCaptureScreenshot(webContents, { captureBeyondViewport: true });
        imgWidth = buffer.readUInt32BE(16);
        imgHeight = buffer.readUInt32BE(20);
      } else {
        // 默认: capturePage() 截视口，失败回退 CDP
        try {
          const image = await this.withTimeout(
            webContents.capturePage(),
            10000,
            "capturePage timeout",
          );
          buffer = image.toPNG();
          const size = image.getSize();
          imgWidth = size.width;
          imgHeight = size.height;
        } catch (e: any) {
          log.warn(`capturePage failed (${e.message}), falling back to CDP`);
          buffer = await this.cdpCaptureScreenshot(webContents);
          imgWidth = buffer.readUInt32BE(16);
          imgHeight = buffer.readUInt32BE(20);
        }
      }

      // 降采样：模型侧转码目标就是最长边 1920，先在捕获端收敛可显著减小
      // base64 过桥体积（视口截图约 0.1–0.4MB），且不损失模型可见质量。
      // wantsSave=true（显式导出）跳过，保留原始画质。
      const capped = wantsSave
        ? { buffer, width: imgWidth, height: imgHeight }
        : shrinkRasterForModel(buffer, imgWidth, imgHeight);
      buffer = capped.buffer;
      imgWidth = capped.width;
      imgHeight = capped.height;

      return {
        ok: true,
        // 必须是 base64 字符串：直接返回 Buffer 会被 JSON.stringify 成
        // {type:"Buffer",data:[...]}，体积与解析成本远高于 base64。
        data: buffer.toString("base64"),
        mime_type: "image/png",
        width: imgWidth,
        height: imgHeight,
      };
    } catch (error: any) {
      if (
        error instanceof BrowserBridgeError &&
        (error.code === "SCREENSHOT_FAILED" || error.code === "INVALID_ARGUMENT")
      ) {
        throw error;
      }
      throw new BrowserBridgeError(
        "SCREENSHOT_FAILED",
        error?.message || "Screenshot failed",
        {
          ...(error instanceof BrowserBridgeError
            ? { cause: error.code, ...(error.details === undefined ? {} : { details: error.details }) }
            : {}),
        },
      );
    } finally {
      if (renderableToggled) {
        this.windowManager.setWebviewRenderable(wid, false);
      }
    }
  }

  /**
   * 为 Promise 添加超时保护
   */
  private async withTimeout<T>(
      promise: Promise<T>,
      ms: number,
      label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 通过 CDP Page.captureScreenshot 截图。
   * 与 capturePage() 不同，CDP 截图在 webview visibility:hidden 时也能工作。
   */
  private async cdpCaptureScreenshot(
    webContents: Electron.WebContents,
    opts?: { captureBeyondViewport?: boolean },
  ): Promise<Buffer> {
    const debuggerApi = webContents.debugger;
    let attachedByUs = false;
    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
        attachedByUs = true;
      }
      const result = await debuggerApi.sendCommand("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: opts?.captureBeyondViewport || false,
      });
      if (!result?.data) {
        throw new Error("CDP captureScreenshot returned no image data");
      }
      return Buffer.from(result.data, "base64");
    } finally {
      if (attachedByUs && debuggerApi.isAttached()) {
        debuggerApi.detach();
      }
    }
  }

  /**
   * 执行 JavaScript 代码
   * @param code JavaScript 代码
   * @param windowId 窗口 ID（可选）
   * @param createdBy 会话标识
   * @param timeoutMs 执行超时（默认 30s）
   */
  async executeJavaScript(
    code: string,
    windowId: string,
    createdBy?: string,
    timeoutMs: number = 30000,
    mutates: boolean = true,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Executing JavaScript (tab: ${wid})...`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    try {
      return await this.withTimeout(
        webContents.executeJavaScript(code, true),
        timeoutMs,
        `JavaScript execution timeout (${timeoutMs}ms)`,
      );
    } catch (error: any) {
      log.error(`JavaScript execution failed in tab ${wid}:`, error?.message || error);
      if (error instanceof BrowserBridgeError) throw error;
      if (String(error?.message || "").includes("timeout")) {
        throw new BrowserBridgeError(
          "TIMEOUT",
          `Execution exceeded ${timeoutMs}ms and timed out. The script may still be running and cannot be cancelled.`,
          { timeout: timeoutMs },
        );
      }
      throw new BrowserBridgeError(
        "EVALUATE_FAILED",
        error?.message || String(error),
      );
    }
  }

  async getPageStruct(
    windowId: string,
    createdBy?: string,
    waitForLoad: boolean = true,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);
    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }
    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new Error(
        `Window ${wid} webview not ready (did-attach-webview not fired)`,
      );
    }
    return this.withSnapshotLock(webContents, () =>
      this.getPageStructUnlocked(wid, createdBy, waitForLoad),
    );
  }

  private async getPageStructUnlocked(
    windowId: string,
    createdBy?: string,
    waitForLoad: boolean = true,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Getting page structure (tab: ${wid})...`);

    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new Error(
        `Window ${wid} webview not ready (did-attach-webview not fired)`,
      );
    }

    // 只在显式要求时等待页面完全加载；脚本已通过 goto 控制等待级别
    if (waitForLoad) {
      await this.waitForPageLoad(webContents);
    }

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL();
    const pageTitle = webContents.getTitle();
    const isLoading = webContents.isLoading();
    log.info(
      `Page status: URL=${currentUrl}, Title=${pageTitle}, Loading=${isLoading}`,
    );

    let structTree: any;
    let originalHtmlLength = 0;
    try {
      // 先获取原始 HTML 长度用于对比
      originalHtmlLength = await webContents.executeJavaScript(`
        (function() {
          return document.documentElement.outerHTML.length;
        })()
      `);
      log.debug(`Original HTML length: ${originalHtmlLength} chars`);

      log.debug("Executing JavaScript to get page structure...");
      structTree = await webContents.executeJavaScript(`
        (function() {
          try {
            // 配置常量
            const CONFIG = {
              MAX_DEPTH: 50,              // 最大递归深度
              SIMPLE_DEPTH: 15,           // 超过此深度仅返回 role + ref
              MAX_SIBLINGS: 10,           // 同类型子节点最大数量
              KEEP_HEAD_COUNT: 5,         // 列表省略时保留的头部数量
              KEEP_TAIL_COUNT: 3,         // 列表省略时保留的尾部数量
              MAX_TEXT_LENGTH: 100,       // 文本最大长度
              MAX_ATTR_VALUE_LENGTH: 300  // 属性值最大长度
            };

            // 不再向 DOM 写入 ref；快照只返回语义结构。
            // role 推导：显式 ARIA role > tag→role 映射 > tag 名
            function getRole(element) {
              var explicit = element.getAttribute('role');
              if (explicit) return explicit;
              var tag = element.tagName.toLowerCase();
              var roleMap = {
                a: 'link', button: 'button', input: 'textbox', select: 'listbox',
                textarea: 'textbox', img: 'image', nav: 'navigation',
                header: 'banner', footer: 'contentinfo', main: 'main',
                aside: 'complementary', form: 'form', ul: 'list', ol: 'list',
                li: 'listitem', table: 'table', h1: 'heading', h2: 'heading',
                h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
                body: 'document', section: 'region', article: 'article',
                label: 'label', fieldset: 'group', dialog: 'dialog'
              };
              return roleMap[tag] || tag;
            }

            // text 提取：叶子节点取 textContent，截断到 MAX_TEXT_LENGTH
            function getText(element) {
              if (element.children.length > 0) return null;
              var text = element.textContent ? element.textContent.trim() : '';
              if (text.length === 0) return null;
              return text.substring(0, CONFIG.MAX_TEXT_LENGTH);
            }

            // 获取当前页面域名用于 URL 精简
            var currentHost = window.location.host;

            // 属性白名单提取（href 同源精简）
            function getExtraAttrs(element) {
              var attrs = {};
              for (var i = 0; i < element.attributes.length; i++) {
                var attr = element.attributes[i];
                if (attr.name === 'class' || attr.name === 'id' || attr.name === 'data-ai-ref' || attr.name === 'role') continue;

                var value = attr.value;

                // href 同源精简
                if (attr.name === 'href' && value) {
                  var protocolRegex = /^(https?:)?\\/\\//;
                  if (protocolRegex.test(value)) {
                    try {
                      var urlObj = new URL(value, window.location.href);
                      if (urlObj.host === currentHost) {
                        value = urlObj.pathname + urlObj.search + urlObj.hash;
                        if (value.charAt(0) !== '/') value = '/' + value;
                      }
                    } catch (e) {}
                  }
                }

                // 白名单：href, data-*-id, data-*-url
                if (attr.name === 'href') {
                  // 保留
                } else if (attr.name.startsWith('data-')) {
                  var suffix = attr.name.substring(5).toLowerCase();
                  if (!suffix.includes('-id') && !suffix.includes('-url')) continue;
                } else {
                  continue;
                }

                if (value.length > CONFIG.MAX_ATTR_VALUE_LENGTH) {
                  value = value.substring(0, CONFIG.MAX_ATTR_VALUE_LENGTH) + '...';
                }
                attrs[attr.name] = value;
              }
              return Object.keys(attrs).length > 0 ? attrs : null;
            }

            // DOM 转 ref-tree 的核心函数
            function domToRefTree(element, depth) {
              if (depth > CONFIG.MAX_DEPTH) {
                return { role: '...', text: 'Maximum depth exceeded' };
              }

              var role = getRole(element);

              // 超过 SIMPLE_DEPTH 后，仅返回 role
              if (depth > CONFIG.SIMPLE_DEPTH) {
                return { role: role };
              }

              var node = { role: role };

              // 文本（仅叶子节点）
              var text = getText(element);
              if (text) node.text = text;

              // 额外属性
              var extraAttrs = getExtraAttrs(element);
              if (extraAttrs) {
                var keys = Object.keys(extraAttrs);
                for (var k = 0; k < keys.length; k++) {
                  node[keys[k]] = extraAttrs[keys[k]];
                }
              }

              // 处理子节点（带智能压缩）
              var children = [];
              var childElements = getFilteredChildren(element);

              if (childElements.length > CONFIG.MAX_SIBLINGS) {
                // 按 role + class 分组
                var groupMap = new Map();
                childElements.forEach(function(child) {
                  var childRole = getRole(child);
                  var childClasses = (typeof child.className === 'string' && child.className)
                    ? child.className.trim().split(/\\s+/).filter(Boolean).join('.')
                    : '';
                  var groupKey = childRole + (childClasses ? '.' + childClasses : '');
                  if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
                  groupMap.get(groupKey).push(child);
                });

                groupMap.forEach(function(group, groupKey) {
                  if (group.length > CONFIG.MAX_SIBLINGS) {
                    var headCount = Math.min(CONFIG.KEEP_HEAD_COUNT, group.length);
                    var tailCount = Math.min(CONFIG.KEEP_TAIL_COUNT, group.length - headCount);

                    for (var i = 0; i < headCount; i++) {
                      var childNode = domToRefTree(group[i], depth + 1);
                      if (childNode) children.push(childNode);
                    }

                    var omittedCount = group.length - headCount - tailCount;
                    children.push({
                      role: '...',
                      text: 'Omitted ' + omittedCount + ' similar ' + groupKey + ' elements',
                      omittedCount: omittedCount
                    });

                    for (var j = group.length - tailCount; j < group.length; j++) {
                      var childNode2 = domToRefTree(group[j], depth + 1);
                      if (childNode2) children.push(childNode2);
                    }
                  } else {
                    group.forEach(function(child) {
                      var childNode = domToRefTree(child, depth + 1);
                      if (childNode) children.push(childNode);
                    });
                  }
                });
              } else {
                for (var i = 0; i < childElements.length; i++) {
                  var childNode = domToRefTree(childElements[i], depth + 1);
                  if (childNode) children.push(childNode);
                }
              }

              if (children.length > 0) {
                // 保留完整节点对象，确保 DOM fallback 能识别深层/无文本交互控件。
                node.children = children;
              }

              return node;
            }

            // 不需要的标签（遍历时跳过，不修改真实 DOM）
            // iframe 保留：struct 快照需要包含 iframe 元素信息
            var unwantedTags = ['script', 'style', 'link', 'noscript', 'meta'];

            // 过滤子节点：跳过无用标签和空容器
            function getFilteredChildren(element) {
              var result = [];
              var childElements = Array.from(element.children);
              for (var i = 0; i < childElements.length; i++) {
                var child = childElements[i];
                var tag = child.tagName.toLowerCase();
                if (unwantedTags.indexOf(tag) !== -1) continue;

                // 空容器折叠：跳过无文本、无子节点、无重要属性的容器
                var isFormElement = ['button', 'input', 'select', 'textarea', 'form'].indexOf(tag) !== -1;
                var isInteractive = ['a', 'label'].indexOf(tag) !== -1;
                if (!isFormElement && !isInteractive && ['div', 'span', 'p', 'section', 'article', 'aside'].indexOf(tag) !== -1) {
                  var hasText = child.textContent && child.textContent.trim().length > 0;
                  var hasChildren = child.children.length > 0;
                  var hasImportantAttrs = child.hasAttribute('id') || child.hasAttribute('role') ||
                    (child.className && typeof child.className === 'string' &&
                     /nav|header|footer|main|content/.test(child.className));
                  if (!hasText && !hasChildren && !hasImportantAttrs) continue;
                }

                result.push(child);
              }
              return result;
            }

            // 在真实 DOM 上分配 ref 并构建 tree
            return domToRefTree(document.body, 0);
          } catch (error) {
            console.error('Error in getPageStruct:', error);
            throw error;
          }
        })()
      `);
      log.debug(
        `Successfully got page structure, length: ${JSON.stringify(structTree).length} chars`,
      );

      // 计算并记录压缩比例
      const treeJsonLength = JSON.stringify(structTree).length;
      const compressionRatio = (
        (1 - treeJsonLength / originalHtmlLength) *
        100
      ).toFixed(2);
      log.info(`Page Structure Size Comparison:`);
      log.info(
        `   Original HTML:    ${originalHtmlLength.toLocaleString()} chars`,
      );
      log.info(
        `   Struct Tree:      ${treeJsonLength.toLocaleString()} chars (${compressionRatio}% reduction)`,
      );
      log.info(
        `   Saved:            ${(originalHtmlLength - treeJsonLength).toLocaleString()} chars`,
      );
    } catch (error: any) {
      log.warn(`Failed to get page structure: ${error.message}`);
      log.warn(`   Error name: ${error.name}`);
      log.warn(`   Error stack: ${error.stack}`);
      throw new Error(`Failed to get page structure: ${error.message}`);
    }

    const title = webContents.getTitle();
    const url = webContents.getURL();
    const measureStruct = (node: any, depth = 0): { nodeCount: number; maxDepth: number } => {
      if (!node || typeof node === "string") {
        return { nodeCount: 0, maxDepth: depth };
      }
      let nodeCount = 1;
      let maxDepth = depth;
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          const measured = measureStruct(child, depth + 1);
          nodeCount += measured.nodeCount;
          maxDepth = Math.max(maxDepth, measured.maxDepth);
        }
      }
      return { nodeCount, maxDepth };
    };

    return {
      success: true,
      windowId: wid,
      url,
      title,
      type: "struct",
      struct: structTree,
      stats: {
        originalHtmlLength,
        outputLength: JSON.stringify(structTree).length,
        ...measureStruct(structTree),
      },
    };
  }

  /**
   * 获取精简无障碍树快照。CDP 不可用时回退到旧 DOM struct 压缩。
   */
  async getPageSimpleSnapshot(
    windowId: string,
    createdBy?: string,
    waitForLoad: boolean = true,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);
    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new Error(
        `Window ${wid} webview not ready (did-attach-webview not fired)`,
      );
    }

    if (waitForLoad) {
      await this.waitForPageLoad(webContents);
    }
    const startedAt = Date.now();

    try {
      const captured = await this.withSnapshotLock(webContents, () =>
        captureAccessibilitySnapshot(webContents),
      );
      return {
        success: true,
        windowId: wid,
        url: webContents.getURL(),
        title: webContents.getTitle(),
        type: "simple",
        source: "ax",
        snapshot: captured.tree,
        stats: {
          ...captured.stats,
          durationMs: Date.now() - startedAt,
          outputLength: JSON.stringify(captured.tree).length,
        },
      };
    } catch (error: any) {
      log.warn(`Accessibility snapshot failed, using DOM fallback: ${error.message}`);
      const legacy = await this.getPageStruct(wid, createdBy, waitForLoad);
      const snapshot = buildSimpleTreeFromLegacyStruct(legacy.struct);
      const measured = measureSimpleTree(snapshot);
      return {
        success: true,
        windowId: wid,
        url: legacy.url,
        title: legacy.title,
        type: "simple",
        source: "dom-fallback",
        snapshot,
        stats: {
          rawNodeCount: legacy.stats?.nodeCount || 0,
          ...measured,
          omittedNodeCount: 0,
          durationMs: Date.now() - startedAt,
          outputLength: JSON.stringify(snapshot).length,
        },
      };
    }
  }

  async getPageSummary(
    windowId: string,
    createdBy?: string,
    waitForLoad: boolean = true,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Getting main structure (tab: ${wid})...`);

    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new Error(
        `Window ${wid} webview not ready (did-attach-webview not fired)`,
      );
    }

    if (waitForLoad) {
      await this.waitForPageLoad(webContents);
    }

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL();
    const pageTitle = webContents.getTitle();
    log.info(
      `Page status for structure: URL=${currentUrl}, Title=${pageTitle}`,
    );

    let structure: any;
    try {
      log.debug("Executing JavaScript to extract main structure...");

      // 使用更简单、更安全的 JavaScript 代码，避免复杂的 DOM 操作
      structure = await webContents.executeJavaScript(`
        (function() {
          try {
            const result = { text: '', links: [], headings: [], error: null };
            
            // 提取文本 - 简化版本
            try {
              const body = document.body;
              if (body) {
                result.text = (body.innerText || body.textContent || '').substring(0, 50000);
              }
            } catch (e) {
              console.warn('Failed to extract text:', e);
            }
            
            // 提取链接 - 限制数量
            try {
              const anchors = document.querySelectorAll('a[href]');
              const maxLinks = Math.min(anchors.length, 100);
              for (let i = 0; i < maxLinks; i++) {
                const a = anchors[i];
                result.links.push({
                  text: (a.innerText || '').trim().substring(0, 100),
                  href: a.getAttribute('href') || ''
                });
              }
            } catch (e) {
              console.warn('Failed to extract links:', e);
            }
            
            // 提取标题 - 只提取 h1-h3
            try {
              const headings = document.querySelectorAll('h1, h2, h3');
              const maxHeadings = Math.min(headings.length, 50);
              for (let i = 0; i < maxHeadings; i++) {
                const h = headings[i];
                const text = (h.innerText || '').trim();
                if (text) {
                  result.headings.push({
                    level: parseInt(h.tagName.charAt(1)),
                    text: text.substring(0, 200)
                  });
                }
              }
            } catch (e) {
              console.warn('Failed to extract headings:', e);
            }
            
            return result;
          } catch (error) {
            console.error('Outer error in getPageSummary:', error);
            return {
              text: '',
              links: [],
              headings: [],
              error: error.toString()
            };
          }
        })()
      `);

      // 检查是否返回了错误信息
      if (structure && structure.error) {
        log.warn(`JavaScript execution returned error: ${structure.error}`);
      }

      log.debug(
        `Successfully got structure: text=${structure.text?.length || 0} chars, links=${structure.links?.length || 0}, headings=${structure.headings?.length || 0}`,
      );
    } catch (error: any) {
      log.error(`Failed to get main structure`);
      log.error(`   Error message: ${error.message}`);
      log.error(`   Error name: ${error.name}`);
      log.error(`   Error stack: ${error.stack}`);
      log.error(`   Tab ID: ${wid}`);
      log.error(`   URL: ${currentUrl}`);
      log.error(`   Title: ${pageTitle}`);

      // 尝试获取渲染进程的控制台日志
      try {
        const consoleLogs = await webContents.executeJavaScript(`
          (function() {
            return {
              url: document.URL,
              readyState: document.readyState,
              hasBody: !!document.body,
              bodyChildCount: document.body ? document.body.children.length : 0
            };
          })()
        `);
        log.error(`   Page diagnostics: ${JSON.stringify(consoleLogs)}`);
      } catch (diagError: any) {
        log.error(`   Failed to get page diagnostics: ${diagError.message}`);
      }

      throw new Error(`Failed to get main structure: ${error.message}`);
    }

    const title = webContents.getTitle();
    const url = webContents.getURL();

    return {
      success: true,
      windowId: wid,
      url,
      title,
      ...structure,
    };
  }

  /**
   * 统一快照接口：simple（默认）/ struct / summary。
   *
   * snapshot 只用于观察，不再返回 ref/generation。
   */
  async snapshot(
    type: string,
    createdBy: string,
    waitForLoad: boolean = false,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow("", createdBy);

    if (type === "summary") {
      const res = await this.getPageSummary(wid, createdBy, waitForLoad);
      return {
        type: "summary",
        url: res.url,
        title: res.title,
        tree: {
          text: res.text,
          links: res.links,
          headings: res.headings,
        },
      };
    }
    if (type === "struct") {
      const res = await this.getPageStruct(wid, createdBy, waitForLoad);
      return {
        type: "struct",
        url: res.url,
        title: res.title,
        source: "dom",
        stats: res.stats,
        tree: res.struct,
      };
    }
    if (type === "simple") {
      const res = await this.getPageSimpleSnapshot(wid, createdBy, waitForLoad);
      return {
        type: "simple",
        url: res.url,
        title: res.title,
        source: res.source,
        stats: res.stats,
        tree: res.snapshot,
      };
    }
    throw new BrowserBridgeError(
      "INVALID_ARGUMENT",
      `Unknown snapshot type: ${type}`,
    );
  }

  async waitForSelector(
    selector: string,
    timeout: number = 10000,
    windowId: string,
    createdBy?: string,
    _generation?: number,
    state: WaitState = "attached",
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }
    if (!this.actionEngine) {
      throw new Error("Action engine not initialized");
    }

    const normalizedState: WaitState =
      state === "visible" || state === "hidden" || state === "detached"
        ? state
        : "attached";

    log.info(
      `Waiting for selector: ${selector} to be ${normalizedState} (tab: ${wid})`,
    );

    const cssSelector = selector;

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    return this.withSnapshotLock(webContents, () =>
      this.actionEngine!.waitForState(
        webContents,
        cssSelector,
        normalizedState,
        timeout,
      ),
    );
  }

  /**
   * 动作前的公共准备：所有权、当前标签、webContents。
   */
  private async prepareContext(
    windowId: string,
    createdBy?: string,
  ): Promise<{ wid: string; webContents: Electron.WebContents }> {
    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }
    if (!this.actionEngine) {
      throw new Error("Action engine not initialized");
    }
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);
    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }
    return { wid, webContents };
  }

  private async prepareAction(
    selector: string,
    windowId: string,
    createdBy?: string,
    _generation?: number,
  ): Promise<{ wid: string; webContents: Electron.WebContents; selector: string }> {
    const context = await this.prepareContext(windowId, createdBy);
    return {
      ...context,
      selector,
    };
  }

  private withPreparedSelector(
    context: { wid: string; webContents: Electron.WebContents },
    selector: string,
  ): { wid: string; webContents: Electron.WebContents; selector: string } {
    return { ...context, selector };
  }

  async click(
    selector: string,
    windowId: string,
    createdBy?: string,
    options: ActionOptions = {},
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(selector, windowId, createdBy, generation);
    log.info(`Clicking element: ${selector} (tab: ${prepared.wid})`);
    const result = await this.withSnapshotLock(prepared.webContents, () =>
      this.clickInternal(prepared, options),
    );
    return result;
  }

  private clickInternal(
    prepared: { wid: string; webContents: Electron.WebContents; selector: string },
    options: ActionOptions,
  ): Promise<any> {
    return this.actionEngine!.click(
      prepared.webContents,
      prepared.wid,
      prepared.selector,
      options,
    );
  }

  async hover(
    selector: string,
    windowId: string,
    createdBy?: string,
    options: ActionOptions = {},
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(selector, windowId, createdBy, generation);
    log.info(`Hovering element: ${selector} (tab: ${prepared.wid})`);
    const result = await this.withSnapshotLock(prepared.webContents, () =>
      this.hoverInternal(prepared, options),
    );
    return result;
  }

  private hoverInternal(
    prepared: { wid: string; webContents: Electron.WebContents; selector: string },
    options: ActionOptions,
  ): Promise<any> {
    return this.actionEngine!.hover(
      prepared.webContents,
      prepared.wid,
      prepared.selector,
      options,
    );
  }

  async press(
    key: string,
    windowId: string,
    createdBy?: string,
    options: PressOptions = {},
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(
      options.selector || "",
      windowId,
      createdBy,
      generation,
    );
    log.info(`Pressing key: ${key} (tab: ${prepared.wid})`);
    const result = await this.withSnapshotLock(prepared.webContents, () =>
      this.pressInternal(prepared, key, options),
    );
    return result;
  }

  private pressInternal(
    prepared: { wid: string; webContents: Electron.WebContents; selector: string },
    key: string,
    options: PressOptions,
  ): Promise<any> {
    return this.actionEngine!.press(prepared.webContents, prepared.wid, key, {
      ...options,
      ...(prepared.selector ? { selector: prepared.selector } : {}),
    });
  }

  async scroll(
    windowId: string,
    createdBy?: string,
    options: ScrollOptions = {},
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(
      options.selector || "",
      windowId,
      createdBy,
      generation,
    );
    return this.withSnapshotLock(prepared.webContents, () =>
      this.scrollInternal(prepared, options),
    );
  }

  private scrollInternal(
    prepared: { wid: string; webContents: Electron.WebContents; selector: string },
    options: ScrollOptions,
  ): Promise<any> {
    return this.actionEngine!.scroll(prepared.webContents, prepared.wid, {
      ...options,
      ...(prepared.selector ? { selector: prepared.selector } : {}),
    });
  }

  async selectOption(
    selector: string,
    values: unknown,
    windowId: string,
    createdBy?: string,
    options: SelectOptions = {},
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(selector, windowId, createdBy, generation);
    const result = await this.withSnapshotLock(prepared.webContents, () =>
      this.selectOptionInternal(prepared, values, options),
    );
    return result;
  }

  private selectOptionInternal(
    prepared: { webContents: Electron.WebContents; selector: string },
    values: unknown,
    options: SelectOptions,
  ): Promise<any> {
    return this.actionEngine!.selectOption(
      prepared.webContents,
      prepared.selector,
      values,
      options,
    );
  }

  async check(
    selector: string,
    checked: boolean,
    windowId: string,
    createdBy?: string,
    options: ActionOptions = {},
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(selector, windowId, createdBy, generation);
    const result = await this.withSnapshotLock(prepared.webContents, () =>
      this.checkInternal(prepared, checked, options),
    );
    return result;
  }

  private checkInternal(
    prepared: { wid: string; webContents: Electron.WebContents; selector: string },
    checked: boolean,
    options: ActionOptions,
  ): Promise<any> {
    return this.actionEngine!.check(
      prepared.webContents,
      prepared.wid,
      prepared.selector,
      checked,
      options,
    );
  }

  async elementState(
    selector: string,
    windowId: string,
    createdBy?: string,
    generation?: number,
  ): Promise<any> {
    const prepared = await this.prepareAction(selector, windowId, createdBy, generation);
    return this.withSnapshotLock(prepared.webContents, () =>
      this.elementStateInternal(prepared),
    );
  }

  private elementStateInternal(prepared: {
    webContents: Electron.WebContents;
    selector: string;
  }): Promise<any> {
    return this.actionEngine!.elementState(prepared.webContents, prepared.selector);
  }

  async fillForm(
    selector: string,
    value: string,
    windowId: string,
    createdBy?: string,
    options: FillOptions = {},
    generation?: number,
  ): Promise<any> {
    if (typeof value !== "string") {
      throw new BrowserBridgeError(
        "INVALID_ARGUMENT",
        "value is required when action is input",
      );
    }

    const prepared = await this.prepareAction(selector, windowId, createdBy, generation);
    log.info(`Filling form field: ${selector} (tab: ${prepared.wid})`);
    return this.withSnapshotLock(prepared.webContents, () =>
      this.fillInternal(prepared, value, options),
    );
  }

  private fillInternal(
    prepared: { wid: string; webContents: Electron.WebContents; selector: string },
    value: string,
    options: FillOptions,
  ): Promise<any> {
    return this.actionEngine!.fill(
      prepared.webContents,
      prepared.wid,
      prepared.selector,
      value,
      options,
    );
  }

  /**
   * 统一 locator 入口：查询 → strictness → materialize → 现有动作引擎。
   */
  async locator(params: any): Promise<any> {
    const descriptor = params?.descriptor as LocatorDescriptor;
    if (!descriptor || typeof descriptor !== "object") {
      throw new BrowserBridgeError(
        "INVALID_ARGUMENT",
        "browser_locator requires a locator descriptor",
      );
    }
    const action = String(params.action || "");
    const context = await this.prepareContext(
      params.window_id || params.tab_id || "",
      params.created_by,
    );
    return this.withSnapshotLock(context.webContents, async () => {
      if (action === "count") {
        return (await this.locatorEngine.queryAll(context.webContents, descriptor)).count;
      }
      if (action === "text") {
        return this.locatorEngine.text(context.webContents, descriptor);
      }
      if (action === "isVisible") {
        return this.locatorEngine.isVisible(context.webContents, descriptor);
      }
      if (action === "wait") {
        const state = normalizeLocatorWaitState(params.state);
        return this.locatorEngine.waitFor(
          context.webContents,
          descriptor,
          state,
          Number(params.timeout) || 3000,
        );
      }

      const materialized = await this.locatorEngine.materialize(
        context.webContents,
        action === "state" && descriptor.kind === "role"
          ? { ...descriptor, includeHidden: true }
          : descriptor,
      );
      if (!materialized.ok) {
        if (materialized.count === 0) {
          throw new BrowserBridgeError(
            "NOT_FOUND",
            "No element matched the locator.",
            { descriptor },
          );
        }
        throw new BrowserBridgeError(
          "AMBIGUOUS",
          `Locator matched ${materialized.count} elements. Narrow it with a more specific locator or use first/last/nth.`,
          { descriptor, candidates: materialized.candidates || [] },
        );
      }
      if (materialized.inShadow) {
        throw new BrowserBridgeError(
          "UNSUPPORTED",
          "Locator actions inside shadow roots are not supported yet; query/count/text are available.",
          { descriptor, candidate: materialized.candidate },
        );
      }
      if (!materialized.selector || !materialized.token) {
        throw new BrowserBridgeError(
          "CALL_FAILED",
          "Locator materialization did not return a selector.",
          { descriptor, materialized },
        );
      }

      const prepared = this.withPreparedSelector(context, materialized.selector);
      try {
        if (action === "click") {
          return await this.clickInternal(prepared, params.options || {});
        }
        if (action === "fill") {
          if (typeof params.value !== "string") {
            throw new BrowserBridgeError(
              "INVALID_ARGUMENT",
              "value is required when action is fill",
            );
          }
          return await this.fillInternal(prepared, params.value, params.options || {});
        }
        if (action === "hover") {
          return await this.hoverInternal(prepared, params.options || {});
        }
        if (action === "press") {
          if (!params.key) {
            throw new BrowserBridgeError(
              "INVALID_ARGUMENT",
              "key is required when action is press",
            );
          }
          return await this.pressInternal(prepared, String(params.key), params.options || {});
        }
        if (action === "scroll") {
          return await this.scrollInternal(prepared, params.options || {});
        }
        if (action === "selectOption") {
          return await this.selectOptionInternal(
            prepared,
            params.values,
            params.options || {},
          );
        }
        if (action === "check" || action === "uncheck") {
          return await this.checkInternal(
            prepared,
            action === "check" ? params.checked !== false : false,
            params.options || {},
          );
        }
        if (action === "state") {
          const probe = await this.elementStateInternal(prepared);
          return { ok: true, ...probe };
        }
        throw new BrowserBridgeError(
          "INVALID_ARGUMENT",
          `Unknown browser_locator action: ${action}`,
        );
      } finally {
        await this.locatorEngine.release(context.webContents, materialized.token);
      }
    });
  }

  /**
   * 后退
   */

  async goBack(windowId: string, createdBy?: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Going back (tab: ${wid})...`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoBack()) {
      webContents.navigationHistory.goBack();
      await this.waitForPageLoad(webContents);
    }

    return {
      ok: true,
      url: webContents.getURL(),
    };
  }

  /**
   * 前进
   */
  async goForward(windowId: string, createdBy?: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Going forward (tab: ${wid})...`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoForward()) {
      webContents.navigationHistory.goForward();
      await this.waitForPageLoad(webContents);
    }

    return {
      ok: true,
      url: webContents.getURL(),
    };
  }

  /**
   * 刷新页面
   */
  async reload(windowId: string, createdBy?: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Reloading page (tab: ${wid})...`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${wid} not found`);
    }

    webContents.reload();
    await this.waitForPageLoad(webContents);

    return {
      ok: true,
      url: webContents.getURL(),
    };
  }

  /**
   * 统一标签管理
   *
   * @param action    list | select | close | close_all
   * @param createdBy 会话标识
   * @param index     标签在列表中的位置 (0-based)
   * @param tabId     显式标签 ID（优先于 index）
   */
  async tabsManage(
    action: string,
    createdBy: string,
    index?: number,
    tabId?: string,
  ): Promise<any> {
    if (!this.windowManager) {
      throw new BrowserBridgeError(
        "TABS_FAILED",
        "WindowManager not initialized",
      );
    }

    // 获取当前 session 的标签列表
    const sessionWindows = this.getWindowList().filter(
      (w) => !createdBy || w.metadata?.createdBy === createdBy,
    );

    const currentTabId = createdBy ? this.getCurrentTabId(createdBy) : undefined;
    const toTabInfo = (w: WindowInfo, i: number) => ({
      index: i,
      tabId: w.windowId,
      url: w.url,
      title: w.title,
      isCurrent: w.windowId === currentTabId,
    });

    switch (action) {
      case "list": {
        return sessionWindows.map((w, i) => toTabInfo(w, i));
      }

      case "current": {
        const idx = sessionWindows.findIndex(
          (w) => w.windowId === currentTabId,
        );
        return idx >= 0 ? toTabInfo(sessionWindows[idx], idx) : null;
      }

      case "select": {
        let targetWid: string | undefined;
        if (tabId) {
          targetWid = tabId;
        } else if (typeof index === "number") {
          targetWid = sessionWindows[index]?.windowId;
        }

        if (!targetWid) {
          throw new BrowserBridgeError(
            "NOT_FOUND",
            'Tab not found. Use browser_tabs(action="list") to see available tabs.',
          );
        }

        const targetIndex = sessionWindows.findIndex(
          (w) => w.windowId === targetWid,
        );
        if (targetIndex < 0) {
          throw new BrowserBridgeError(
            "NOT_FOUND",
            `Tab ${targetWid} does not belong to this session.`,
          );
        }

        if (createdBy) this.setCurrentTab(createdBy, targetWid);

        const found = sessionWindows[targetIndex];
        const wc = this.windowManager.getWebContents(targetWid);
        return {
          index: targetIndex,
          tabId: targetWid,
          url: wc ? wc.getURL() : found.url,
          title: wc ? wc.getTitle() : found.title,
          isCurrent: true,
        };
      }

      case "close": {
        let targetWid: string | undefined;
        if (tabId) {
          targetWid = tabId;
        } else if (typeof index === "number") {
          targetWid = sessionWindows[index]?.windowId;
        } else {
          // 关闭当前标签
          targetWid = currentTabId;
        }

        if (!targetWid) {
          throw new BrowserBridgeError("NOT_FOUND", "No tab to close");
        }

        // 与 select 一致：显式 tab_id 也必须属于当前 session
        if (!sessionWindows.some((w) => w.windowId === targetWid)) {
          throw new BrowserBridgeError(
            "NOT_FOUND",
            `Tab ${targetWid} does not belong to this session.`,
          );
        }

        await this.windowManager.closeWindow(targetWid);

        // 关闭的是当前标签时自动切换到相邻标签；否则当前标签保持不变
        let nextCurrentTabId: string | null = currentTabId || null;
        if (targetWid === currentTabId && createdBy) {
          const remaining = this.getWindowList().filter(
            (w) => w.metadata?.createdBy === createdBy,
          );
          if (remaining.length > 0) {
            nextCurrentTabId = remaining[0].windowId;
            this.setCurrentTab(createdBy, nextCurrentTabId);
          } else {
            nextCurrentTabId = null;
            this.clearCurrentTab(createdBy);
          }
        }

        return {
          ok: true,
          closedTabId: targetWid,
          currentTabId: nextCurrentTabId,
        };
      }

      case "close_all": {
        let count = 0;
        for (const w of sessionWindows) {
          await this.windowManager.closeWindow(w.windowId);
          count++;
        }
        if (createdBy) this.clearCurrentTab(createdBy);
        return { ok: true, closedCount: count };
      }

      default:
        throw new BrowserBridgeError(
          "INVALID_ARGUMENT",
          `Unknown tabs action: ${action}`,
        );
    }
  }

  /**
   * 关闭指定创建者的所有窗口（子代理清理）
   */
  async closeWindowsByCreator(createdBy: string): Promise<any> {
    if (!this.windowManager) {
      throw new BrowserBridgeError(
        "TABS_FAILED",
        "TabManager not initialized",
      );
    }
    const windows = this.getWindowList().filter(
      (w) => w.metadata?.createdBy === createdBy,
    );
    log.info(`Closing ${windows.length} windows for creator ${createdBy}`);
    for (const w of windows) {
      await this.windowManager.closeWindow(w.windowId);
    }
    this.clearCurrentTab(createdBy);
    return { closedCount: windows.length };
  }

  /**
  /**
   * 获取当前标签控制台日志
   */
  async getConsoleLogs(createdBy: string, clear: boolean = false): Promise<string[]> {
    if (!this.windowManager) {
      throw new BrowserBridgeError(
        "CONSOLE_FAILED",
        "TabManager not initialized",
      );
    }
    const { windowId: wid } = await this.ensureWindow("", createdBy);
    // 默认只读：脚本可能需要多次读取同一段日志。显式 clear 才清空。
    const logs = [...this.windowManager.getConsoleLogs(wid)];
    if (clear) {
      this.windowManager.clearConsoleLogs(wid);
    }
    return logs;
  }

  private isAbortedNavigationError(error: any): boolean {
    const code = error?.code ?? error?.errno;
    return (
      code === -3 ||
      String(error?.message || "").includes("ERR_ABORTED")
    );
  }

  private async readReadyState(
    webContents?: Electron.WebContents | null,
  ): Promise<string | undefined> {
    if (!webContents) return undefined;
    try {
      return await webContents.executeJavaScript("document.readyState");
    } catch {
      return undefined;
    }
  }

  /**
   * 等待 DOM ready（document.readyState >= interactive）。
   * 用于 navigate wait_until="domcontentloaded"，不等待子资源。
   */
  private async waitForDomReady(
    webContents: Electron.WebContents,
    timeout: number = 30000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timer);
        webContents.removeListener("dom-ready", onDomReady);
        webContents.removeListener("did-fail-load", onFailLoad);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onDomReady = () => succeed();
      const onFailLoad = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        _validatedURL: string,
        isMainFrame: boolean,
      ) => {
        if (errorCode === -3 || !isMainFrame) return;
        fail(
          new BrowserBridgeError(
            "NAVIGATION_FAILED",
            `Page DOM load failed: ${errorCode} - ${errorDescription}`,
            { errorCode },
          ),
        );
      };

      timer = setTimeout(
        () =>
          fail(
            new BrowserBridgeError(
              "NAVIGATION_TIMEOUT",
              `DOM ready timeout after ${timeout}ms`,
              { timeout },
            ),
          ),
        timeout,
      );

      // 页面可能已经完成 DOM 解析
      const currentUrl = webContents.getURL();
      if (!webContents.isLoading() && currentUrl !== "") {
        succeed();
        return;
      }

      webContents.on("dom-ready", onDomReady);
      webContents.on("did-fail-load", onFailLoad);
    });
  }

  /**
   * 等待页面加载完成
   */
  private async waitForPageLoad(
    webContents: Electron.WebContents,
    timeout: number = 60000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timer);
        webContents.removeListener("did-stop-loading", onStopLoading);
        webContents.removeListener("did-fail-load", onFailLoad);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onStopLoading = () => succeed();
      const onFailLoad = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        _validatedURL: string,
        isMainFrame: boolean,
      ) => {
        // ERR_ABORTED 常由重定向/JS 跳转触发；子框架失败也不代表主页面失败。
        if (errorCode === -3 || !isMainFrame) return;
        fail(
          new BrowserBridgeError(
            "NAVIGATION_FAILED",
            `Page load failed: ${errorCode} - ${errorDescription}`,
            { errorCode },
          ),
        );
      };

      timer = setTimeout(
        () =>
          fail(
            new BrowserBridgeError(
              "NAVIGATION_TIMEOUT",
              `Page load timeout after ${timeout}ms`,
              { timeout },
            ),
          ),
        timeout,
      );

      const currentUrl = webContents.getURL();
      if (
        !webContents.isLoading() &&
        currentUrl !== ""
      ) {
        succeed();
        return;
      }

      webContents.on("did-stop-loading", onStopLoading);
      webContents.on("did-fail-load", onFailLoad);
    });
  }

  /**
   * 处理工具调用请求
   *
   * 这是核心分发逻辑，根据 method 调用对应的功能
   * 统一使用 snake_case 命名风格
   */
  async handleToolCall(request: ToolRequest): Promise<any> {
    const { method, params } = request;

    log.info(`Handling tool call: ${method}`);

    try {
      switch (method) {
        case "browser_navigate":
          return await this.navigate(
            params.url,
            params.new_tab || false,
            params.created_by,
            params.session_path,
            params.session_id,
            params.wait_until || "load",
          );

        case "browser_tabs":
          return await this.tabsManage(
            params.action,
            params.created_by,
            params.index,
            params.tab_id || params.window_id,
          );

        case "browser_snapshot":
          return await this.snapshot(
            params.type || "simple",
            params.created_by,
            params.wait_for_load === true,
          );

        case "browser_evaluate":
          return await this.executeJavaScript(
            params.code,
            "",
            params.created_by,
            params.timeout_ms,
            params.mutates !== false,
          );

        case "browser_wait":
          return await this.waitForSelector(
            params.selector,
            params.timeout,
            "",
            params.created_by,
            params.generation,
            params.state || "attached",
          );

        case "browser_locator":
          return await this.locator(params);

        case "browser_click":
          return await this.click(
            params.selector,
            "",
            params.created_by,
            {
              button: params.button,
              clickCount: params.click_count,
              modifiers: params.modifiers,
              force: params.force === true,
              timeout: params.timeout,
              trusted: resolveTrusted(params),
            },
            params.generation,
          );

        case "browser_input":
          return await this.fillForm(
            params.selector,
            params.value,
            "",
            params.created_by,
            {
              force: params.force === true,
              timeout: params.timeout,
              trusted: resolveTrusted(params),
            },
            params.generation,
          );

        case "browser_hover":
          return await this.hover(
            params.selector,
            "",
            params.created_by,
            {
              force: params.force === true,
              timeout: params.timeout,
              trusted: resolveTrusted(params),
            },
            params.generation,
          );

        case "browser_press":
          return await this.press(
            params.key,
            "",
            params.created_by,
            {
              selector: params.selector,
              modifiers: params.modifiers,
              timeout: params.timeout,
              trusted: resolveTrusted(params),
            },
            params.generation,
          );

        case "browser_scroll":
          return await this.scroll(
            "",
            params.created_by,
            {
              selector: params.selector,
              deltaX: params.delta_x,
              deltaY: params.delta_y,
              timeout: params.timeout,
            },
            params.generation,
          );

        case "browser_select":
          return await this.selectOption(
            params.selector,
            params.values,
            "",
            params.created_by,
            {
              force: params.force === true,
              timeout: params.timeout,
            },
            params.generation,
          );

        case "browser_check":
          return await this.check(
            params.selector,
            params.checked !== false,
            "",
            params.created_by,
            {
              button: "left",
              force: params.force === true,
              timeout: params.timeout,
              trusted: resolveTrusted(params),
            },
            params.generation,
          );

        case "browser_element_state":
          return await this.elementState(
            params.selector,
            "",
            params.created_by,
            params.generation,
          );

        case "browser_console":
          return await this.getConsoleLogs(
            params.created_by,
            params.clear === true,
          );

        case "browser_screenshot":
          // 不再落工作区；返回 base64 由后端转码进会话附件目录。
          // wants_save 仅决定是否保留原始栅格（显式导出场景）。
          return await this.screenshot(
            params.created_by,
            params.full_page || false,
            params.wants_save === true,
          );

        case "browser_history": {
          if (params.action === "back") {
            return await this.goBack("", params.created_by);
          }
          if (params.action === "forward") {
            return await this.goForward("", params.created_by);
          }
          if (params.action === "reload") {
            return await this.reload("", params.created_by);
          }
          throw new BrowserBridgeError(
            "INVALID_ARGUMENT",
            `browser_history action must be "back", "forward", or "reload"`,
            { action: params.action },
          );
        }

        case "browser_close_by_creator":
          return await this.closeWindowsByCreator(params.created_by);

        default:
          throw new BrowserBridgeError(
            "INVALID_ARGUMENT",
            `Unknown method: ${method}`,
          );
      }
    } catch (error: any) {
      log.error(`Error handling tool call ${method}:`, error);
      throw error;
    }
  }

  /**
   * 获取所有窗口列表（不包含主应用窗口）
   */
  getWindowList(): WindowInfo[] {
    if (!this.windowManager) {
      return [];
    }

    // 直接返回 WindowManager 的窗口列表，过滤掉主应用
    return this.windowManager
      .getWindowList()
      .filter((w) => w.windowId !== "main_app");
  }
}

function resolveTrusted(params: any): boolean | undefined {
  if (params?.trusted !== undefined) return params.trusted === true;
  if (params?.full_simulation !== undefined) return params.full_simulation === true;
  return undefined;
}

function normalizeLocatorWaitState(value: unknown): LocatorWaitState {
  return value === "attached" || value === "hidden" || value === "detached"
    ? value
    : "visible";
}

/** 模型侧截图栅格上限（与后端转码预算一致：最长边 1920） */
const SCREENSHOT_MAX_EDGE = 1920;
/** 像素上限（16MP）：超长整页截图先收敛，避免 base64 过桥体积失控 */
const SCREENSHOT_MAX_PIXELS = 16 * 1024 * 1024;

/**
 * 按模型侧预算把截图栅格收敛到 ≤1920 长边 / ≤16MP。
 *
 * 后端转码本来就会缩到同一上限，在捕获端先缩可以直接减小 base64 体积
 * （视口截图通常只剩 0.1–0.4MB）。失败时原样返回，交给后端转码兜底。
 */
function shrinkRasterForModel(
  buffer: Buffer,
  width: number,
  height: number,
): { buffer: Buffer; width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const pixels = Math.max(width * height, 1);
  const scale = Math.min(
    longest > SCREENSHOT_MAX_EDGE ? SCREENSHOT_MAX_EDGE / longest : 1,
    pixels > SCREENSHOT_MAX_PIXELS ? Math.sqrt(SCREENSHOT_MAX_PIXELS / pixels) : 1,
  );
  if (scale >= 1) return { buffer, width, height };

  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return { buffer, width, height };
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const resized = image.resize({
      width: targetWidth,
      height: targetHeight,
      quality: "best",
    });
    const size = resized.getSize();
    return { buffer: resized.toPNG(), width: size.width, height: size.height };
  } catch (error: any) {
    log.warn(`screenshot downscale failed, using original: ${error?.message ?? error}`);
    return { buffer, width, height };
  }
}
