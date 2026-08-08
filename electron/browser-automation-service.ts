import { BrowserWindow } from "electron";
import log from "electron-log/main";
import * as path from "path";
import * as fs from "fs";
import { BrowserWindowManager, WindowInfo } from "./browser-tab-manager";
import {
  buildSimpleTreeFromLegacyStruct,
  captureAccessibilitySnapshot,
  measureSimpleTree,
} from "./accessibility-snapshot";

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
  // 每个 session (createdBy) 的当前标签映射
  private currentTabs = new Map<string, string>();
  // 同一 webContents 的 CDP 快照必须串行，避免 debugger attach/command 冲突
  private snapshotLocks = new Map<number, Promise<void>>();

  /**
   * 初始化窗口管理器（必须在应用启动时调用）
   */
  initializeWindowManager(windowManager: BrowserWindowManager): void {
    this.windowManager = windowManager;
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
  ): Promise<string> {
    if (!this.windowManager) {
      throw new Error(
        "WindowManager not initialized. Call initializeWindowManager() first.",
      );
    }

    const windowInfo = await this.windowManager.createWindow(url, metadata);

    // 等待初始导航完成（架构统一：与 navigate 使用相同的 waitForPageLoad）
    if (url && windowInfo.windowId) {
      try {
        const wc = await this.windowManager.getWebviewWebContents(
          windowInfo.windowId,
        );
        if (wc) {
          await this.waitForPageLoad(wc);
          // waitForPageLoad 在页面已加载（含 chrome-error 错误页）时会立即 resolve，
          // 需要额外检查是否落在了错误页
          const currentUrl = wc.getURL();
          if (currentUrl.startsWith("chrome-error://")) {
            throw new Error(
              `Initial navigation failed: page loaded chrome-error for ${url}`,
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
  ): Promise<any> {
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

      wid = await this.createWindow(url, metadata);
      if (createdBy) this.setCurrentTab(createdBy, wid);

      const wc = this.windowManager.getWebContents(wid);
      if (wc) {
        return {
          success: true,
          tab_id: wid,
          url: wc.getURL(),
          title: wc.getTitle(),
        };
      }
      return { success: true, tab_id: wid, url, title: "" };
    }

    // 在当前标签导航（无标签时自动创建）
    if (createdBy) {
      const currentWid = this.getCurrentTabId(createdBy);
      if (!currentWid) {
        // 无当前标签，自动创建
        return this.navigate(url, true, createdBy, sessionPath, sessionId);
      }
      wid = currentWid;
    } else {
      throw new Error("No active tab. Call browser_navigate(url, new_tab=true) first.");
    }

    // 所有权验证
    await this.ensureWindow(wid, createdBy);

    log.info(`Navigating to: ${url} (tab: ${wid})`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`);
    }

    try {
      // loadURL 在页面重定向/JS 跳转时会 reject (ERR_ABORTED -3)，
      // 但页面实际上可能已成功加载，因此忽略 loadURL 的 reject，
      // 统一由 waitForPageLoad 判断最终加载状态。
      await webContents.loadURL(url).catch(() => {});
      await this.waitForPageLoad(webContents);
      return {
        success: true,
        tab_id: wid,
        url: webContents.getURL(),
        title: webContents.getTitle(),
      };
    } catch (error: any) {
      throw new Error(`Navigation failed: ${error.message}`);
    }
  }

  /**
   * 截图当前页面，保存到本地文件
   */
  async screenshot(
    createdBy: string,
    filePath?: string,
    sessionPath?: string,
  ): Promise<any> {
    if (!this.windowManager) {
      throw new Error("WindowManager not initialized");
    }

    const { windowId: wid } = await this.ensureWindow("", createdBy);

    log.info(`Taking screenshot (tab: ${wid})...`);

    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`);
    }

    await this.waitForPageLoad(webContents);

    // webview visibility:hidden 时 Chromium 不产生合成器帧，CDP/capturePage 都无法截图。
    // 临时将 webview 设为可渲染（视口内 + opacity:0），截图后恢复。
    // 无条件调用：前端的 getWebviewStyle 会判断是否已可见，已可见时不受影响。
    this.windowManager.setWebviewRenderable(wid, true);
    // 等待合成器产生帧
    await new Promise((r) => setTimeout(r, 300));

    try {
      // 优先使用 capturePage()，失败则回退到 CDP
      let buffer: Buffer;
      let imgWidth: number;
      let imgHeight: number;
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

      let savedPath: string | undefined;

      // 保存到文件
      const targetPath = filePath
        ? path.isAbsolute(filePath)
          ? filePath
          : sessionPath
            ? path.join(sessionPath, filePath)
            : undefined
        : sessionPath
          ? path.join(sessionPath, `screenshot-${Date.now()}.png`)
          : undefined;

      if (targetPath) {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        await fs.promises.writeFile(targetPath, buffer);
        savedPath = targetPath;
        log.info(`Screenshot saved: ${savedPath}`);
      }

      return {
        success: true,
        tab_id: wid,
        format: "png",
        saved_path: savedPath,
        width: imgWidth,
        height: imgHeight,
      };
    } finally {
      this.windowManager.setWebviewRenderable(wid, false);
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
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(label)), ms),
      ),
    ]);
  }

  /**
   * 通过 CDP Page.captureScreenshot 截图。
   * 与 capturePage() 不同，CDP 截图在 webview visibility:hidden 时也能工作。
   */
  private async cdpCaptureScreenshot(
    webContents: Electron.WebContents,
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
   * @param isAsync 是否支持异步代码（默认 false）
   */
  async executeJavaScript(
    code: string,
    windowId: string,
    isAsync: boolean = false,
    createdBy?: string,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Executing JavaScript (tab: ${wid})...`);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`);
    }

    try {
      const result = await webContents.executeJavaScript(code, true);
      return {
        success: true,
        windowId: wid,
        result,
      };
    } catch (error: any) {
      log.error(`JavaScript execution failed in tab ${wid}:`, error.message);
      return {
        success: false,
        windowId: wid,
        error: error.message,
      };
    }
  }

  async getPageStruct(windowId: string, createdBy?: string): Promise<any> {
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
      this.getPageStructUnlocked(wid, createdBy),
    );
  }

  private async getPageStructUnlocked(
    windowId: string,
    createdBy?: string,
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

    // 等待页面完全加载
    await this.waitForPageLoad(webContents);

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

            // 清理旧 ref，在真实 DOM 上重新分配
            document.querySelectorAll('[data-ai-ref]').forEach(function(el) {
              el.removeAttribute('data-ai-ref');
            });
            var refCounter = 0;
            function assignRef(element) {
              var refId = 'e' + (refCounter++);
              element.setAttribute('data-ai-ref', refId);
              return refId;
            }

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

              var ref = assignRef(element);
              var role = getRole(element);

              // 超过 SIMPLE_DEPTH 后，仅返回 role + ref
              if (depth > CONFIG.SIMPLE_DEPTH) {
                return { role: role, ref: ref };
              }

              var node = { role: role, ref: ref };

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
            var unwantedTags = ['script', 'style', 'link', 'noscript', 'meta', 'iframe'];

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

    await this.waitForPageLoad(webContents);
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
      const legacy = await this.getPageStruct(wid, createdBy);
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

  async getPageText(windowId: string, createdBy?: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Getting page text (tab: ${wid})...`);

    const webContents = await this.windowManager.getWebviewWebContents(wid);
    if (!webContents) {
      throw new Error(
        `Window ${wid} webview not ready (did-attach-webview not fired)`,
      );
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents);

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL();
    const pageTitle = webContents.getTitle();
    log.info(`Page status for text: URL=${currentUrl}, Title=${pageTitle}`);

    let text = "";
    try {
      log.debug("Executing JavaScript to extract plain text...");
      text = await webContents.executeJavaScript(`
        (function() {
          try {
            const clone = document.cloneNode(true)
            const scripts = clone.querySelectorAll('script, style, noscript')
            for (let i = 0; i < scripts.length; i++) {
              if (scripts[i].parentNode) {
                scripts[i].parentNode.removeChild(scripts[i])
              }
            }
            
            let text = clone.body ? clone.body.innerText : clone.textContent || ''
            
            text = text
              .split('\n')
              .map(function(line) { return line.trim() })
              .filter(function(line) { return line.length > 0 })
              .join('\n')
            
            return text
          } catch (error) {
            console.error('Error in getPageText:', error)
            return ''
          }
        })()
      `);
    } catch (error: any) {
      log.error(`Failed to get plain text`);
      log.error(`   Error message: ${error.message}`);
      log.error(`   Error name: ${error.name}`);
      log.error(`   Tab ID: ${wid}`);
      log.error(`   URL: ${currentUrl}`);
      throw new Error(`Failed to get plain text: ${error.message}`);
    }

    const title = webContents.getTitle();
    const url = webContents.getURL();

    return {
      success: true,
      windowId: wid,
      url,
      title,
      text,
    };
  }

  async getPageSummary(windowId: string, createdBy?: string): Promise<any> {
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

    // 等待页面完全加载
    await this.waitForPageLoad(webContents);

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
   */
  async snapshot(type: string, createdBy: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow("", createdBy);
    if (type === "summary") {
      return this.getPageSummary(wid, createdBy);
    }
    if (type === "struct") {
      return this.getPageStruct(wid, createdBy);
    }
    if (type === "simple") {
      return this.getPageSimpleSnapshot(wid, createdBy);
    }
    throw new Error(`Unknown snapshot type: ${type}`);
  }

  /**
   * 将 ref ID（如 "e0"）解析为 CSS 属性选择器；非 ref 格式原样返回
   */
  private resolveSelector(selector: string): string {
    if (/^e\d+$/.test(selector)) {
      return `[data-ai-ref="${selector}"]`;
    }
    return selector;
  }

  async waitForSelector(
    selector: string,
    timeout: number = 10000,
    windowId: string,
    createdBy?: string,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Waiting for selector: ${selector} (tab: ${wid})`);

    const cssSelector = this.resolveSelector(selector);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`);
    }

    const selectorLiteral = JSON.stringify(cssSelector);
    const safeTimeout = Number.isFinite(timeout) ? Math.max(0, timeout) : 10000;
    const result = await this.withSnapshotLock(webContents, () =>
      webContents.executeJavaScript(`
        new Promise((resolve) => {
          const element = document.querySelector(${selectorLiteral})
          if (element) {
            resolve({ found: true, exists: true })
            return
          }

          const observer = new MutationObserver(() => {
            const el = document.querySelector(${selectorLiteral})
            if (el) {
              observer.disconnect()
              resolve({ found: true, exists: true })
            }
          })

          observer.observe(document.body, { childList: true, subtree: true })

          setTimeout(() => {
            observer.disconnect()
            resolve({ found: false, exists: false })
          }, ${safeTimeout})
        })
      `),
    );

    return {
      success: true,
      windowId: wid,
      ...result,
    };
  }

  async click(selector: string, windowId: string, createdBy?: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    log.info(`Clicking element: ${selector} (tab: ${wid})`);

    const cssSelector = this.resolveSelector(selector);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`);
    }

    const selectorLiteral = JSON.stringify(cssSelector);

    const result = await this.withSnapshotLock(webContents, async () => {
      // 获取元素位置和视口尺寸
      const rectInfo = await webContents.executeJavaScript(`
        new Promise((resolve) => {
          const element = document.querySelector(${selectorLiteral})
          if (!element) {
            resolve(null)
            return
          }
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
          const rect = element.getBoundingClientRect()
          resolve({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            vw: window.innerWidth,
            vh: window.innerHeight,
          })
        })
      `);

      if (!rectInfo) {
        return { success: false, clicked: false, error: 'Element not found' };
      }

      const targetX = Math.max(0, Math.min(rectInfo.x, rectInfo.vw));
      const targetY = Math.max(0, Math.min(rectInfo.y, rectInfo.vh));

      // 尝试 CDP 输入（isTrusted=true），失败则降级到 dispatchEvent
      const cdpSuccess = await this.cdpClick(webContents, targetX, targetY, rectInfo.vw, rectInfo.vh);
      if (cdpSuccess) {
        return { success: true, clicked: true };
      }

      // 降级：dispatchEvent（isTrusted=false，但保证功能可用）
      await webContents.executeJavaScript(`
        new Promise((resolve) => {
          const element = document.querySelector(${selectorLiteral})
          if (element) {
            const rect = element.getBoundingClientRect()
            element.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            }))
            resolve(true)
          } else {
            resolve(false)
          }
        })
      `);
      return { success: true, clicked: true };
    });

    return {
      windowId: wid,
      ...result,
    };
  }

  async fillForm(
    selector: string,
    value: string,
    windowId: string,
    createdBy?: string,
  ): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId, createdBy);

    if (!this.windowManager) {
      throw new Error("TabManager not initialized");
    }

    if (typeof value !== "string") {
      throw new Error("value is required when action is input");
    }

    log.info(`Filling form field: ${selector} (tab: ${wid})`);

    const cssSelector = this.resolveSelector(selector);

    const webContents = this.windowManager.getWebContents(wid);
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`);
    }

    const selectorLiteral = JSON.stringify(cssSelector);

    const result = await this.withSnapshotLock(webContents, async () => {
      // 获取元素位置并 scrollIntoView
      const rectInfo = await webContents.executeJavaScript(`
        new Promise((resolve) => {
          const element = document.querySelector(${selectorLiteral})
          if (!element) { resolve(null); return }
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
          const rect = element.getBoundingClientRect()
          resolve({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, vw: window.innerWidth, vh: window.innerHeight })
        })
      `);

      if (!rectInfo) {
        return { success: false, filled: false, error: 'Element not found' };
      }

      // 尝试 CDP 键盘输入，失败则降级
      const cdpSuccess = await this.cdpTypeText(webContents, rectInfo.x, rectInfo.y, rectInfo.vw, rectInfo.vh, value);
      if (cdpSuccess) {
        return { success: true, filled: true };
      }

      // 降级：直接设值 + dispatchEvent
      const valueLiteral = JSON.stringify(value);
      await webContents.executeJavaScript(`
        new Promise((resolve) => {
          const element = document.querySelector(${selectorLiteral})
          if (element) {
            element.value = ${valueLiteral}
            element.dispatchEvent(new Event('input', { bubbles: true }))
            element.dispatchEvent(new Event('change', { bubbles: true }))
            resolve(true)
          } else {
            resolve(false)
          }
        })
      `);
      return { success: true, filled: true };
    });

    return {
      windowId: wid,
      ...result,
    };
  }

  /**
   * 通过 CDP Input.dispatchMouseEvent 模拟鼠标点击（isTrusted=true）。
   * 包含鼠标轨迹模拟：从随机起点经多步移动到目标，然后按下/释放。
   * 返回 false 表示 CDP 不可用，调用方应降级。
   */
  private async cdpClick(
    webContents: Electron.WebContents,
    targetX: number,
    targetY: number,
    viewportW: number,
    viewportH: number,
  ): Promise<boolean> {
    const debuggerApi = webContents.debugger;
    let attachedByUs = false;

    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
        attachedByUs = true;
      }

      const send = (method: string, params: any) =>
        debuggerApi.sendCommand(method, params);

      // 起点：从视口边缘随机选择
      const startSide = Math.floor(Math.random() * 4);
      let startX: number, startY: number;
      switch (startSide) {
        case 0: startX = Math.random() * viewportW * 0.3; startY = Math.random() * viewportH; break;
        case 1: startX = viewportW - Math.random() * viewportW * 0.3; startY = Math.random() * viewportH; break;
        case 2: startX = Math.random() * viewportW; startY = Math.random() * viewportH * 0.3; break;
        default: startX = Math.random() * viewportW; startY = viewportH - Math.random() * viewportH * 0.3; break;
      }

      // 生成贝塞尔轨迹（5-8 步）
      const steps = 5 + Math.floor(Math.random() * 4);
      const controlX = startX + (targetX - startX) * 0.5 + (Math.random() - 0.5) * 100;
      const controlY = startY + (targetY - startY) * 0.5 + (Math.random() - 0.5) * 100;

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // 二次贝塞尔曲线
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * targetX;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * targetY;
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
        });
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
      }

      // 短暂停留后点击
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 50));

      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: targetX,
        y: targetY,
        button: "left",
        clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 40));
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: targetX,
        y: targetY,
        button: "left",
        clickCount: 1,
      });

      return true;
    } catch (err: any) {
      log.warn(`CDP click failed, will fallback to dispatchEvent: ${err.message}`);
      return false;
    } finally {
      if (attachedByUs && debuggerApi.isAttached()) {
        try { debuggerApi.detach(); } catch {}
      }
    }
  }

  /**
   * 通过 CDP Input.dispatchKeyEvent 模拟键盘输入（isTrusted=true）。
   * 先点击聚焦元素，Ctrl+A 清空，然后逐字符输入。
   * 返回 false 表示 CDP 不可用，调用方应降级。
   */
  private async cdpTypeText(
    webContents: Electron.WebContents,
    elementX: number,
    elementY: number,
    viewportW: number,
    viewportH: number,
    text: string,
  ): Promise<boolean> {
    const debuggerApi = webContents.debugger;
    let attachedByUs = false;

    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
        attachedByUs = true;
      }

      const send = (method: string, params: any) =>
        debuggerApi.sendCommand(method, params);

      // 先点击元素以获取焦点
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: elementX,
        y: elementY,
      });
      await new Promise((r) => setTimeout(r, 50));
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: elementX,
        y: elementY,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: elementX,
        y: elementY,
        button: "left",
        clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 50));

      // Ctrl+A 全选
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: 2,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers: 2,
      });
      await new Promise((r) => setTimeout(r, 30));

      // Backspace 删除
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Backspace",
        code: "Backspace",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Backspace",
        code: "Backspace",
      });
      await new Promise((r) => setTimeout(r, 30));

      // 逐字符输入
      for (const char of text) {
        const isAscii = char.charCodeAt(0) < 128;
        const keyInfo = isAscii
          ? this.charToKeyCode(char)
          : { key: "Unidentified", code: "Unidentified" };

        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: keyInfo.key,
          code: keyInfo.code,
          text: char,
        });
        if (isAscii) {
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: keyInfo.key,
            code: keyInfo.code,
          });
        } else {
          // 非 ASCII 字符（中文等），发送 keyUp 不带 text
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: keyInfo.key,
            code: keyInfo.code,
          });
        }
        // 随机化打字间隔
        await new Promise((r) => setTimeout(r, 30 + Math.random() * 50));
      }

      return true;
    } catch (err: any) {
      log.warn(`CDP typeText failed, will fallback to dispatchEvent: ${err.message}`);
      return false;
    } finally {
      if (attachedByUs && debuggerApi.isAttached()) {
        try { debuggerApi.detach(); } catch {}
      }
    }
  }

  /**
   * 将 ASCII 字符映射为 CDP key/code
   */
  private charToKeyCode(char: string): { key: string; code: string } {
    if (char === " ") return { key: " ", code: "Space" };
    if (char === "\n") return { key: "Enter", code: "Enter" };
    if (char === "\t") return { key: "Tab", code: "Tab" };
    const upper = char.toUpperCase();
    if (upper.length === 1 && upper >= "A" && upper <= "Z") {
      return { key: upper, code: `Key${upper}` };
    }
    if (char >= "0" && char <= "9") {
      return { key: char, code: `Digit${char}` };
    }
    // 标点符号等
    return { key: char, code: "Unidentified" };
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
      throw new Error(`Tab ${wid} not found`);
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoBack()) {
      webContents.navigationHistory.goBack();
      await this.waitForPageLoad(webContents);
    }

    return {
      success: true,
      windowId: wid,
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
      throw new Error(`Tab ${wid} not found`);
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoForward()) {
      webContents.navigationHistory.goForward();
      await this.waitForPageLoad(webContents);
    }

    return {
      success: true,
      windowId: wid,
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
      throw new Error(`Tab ${wid} not found`);
    }

    webContents.reload();
    await this.waitForPageLoad(webContents);

    return {
      success: true,
      windowId: wid,
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
      return { success: false, message: "WindowManager not initialized" };
    }

    // 获取当前 session 的标签列表
    const sessionWindows = this.getWindowList().filter(
      (w) => !createdBy || w.metadata?.createdBy === createdBy,
    );

    const currentTabId = createdBy ? this.getCurrentTabId(createdBy) : undefined;

    switch (action) {
      case "list": {
        return {
          success: true,
          tabs: sessionWindows.map((w, i) => ({
            index: i,
            tab_id: w.windowId,
            url: w.url,
            title: w.title,
            is_current: w.windowId === currentTabId,
          })),
          current_tab_id: currentTabId || null,
          count: sessionWindows.length,
        };
      }

      case "select": {
        let targetWid: string | undefined;
        if (tabId) {
          targetWid = tabId;
        } else if (typeof index === "number") {
          targetWid = sessionWindows[index]?.windowId;
        }

        if (!targetWid) {
          throw new Error(
            `Tab not found. Use browser_tabs(action="list") to see available tabs.`,
          );
        }

        const found = sessionWindows.find((w) => w.windowId === targetWid);
        if (!found) {
          throw new Error(`Tab ${targetWid} does not belong to this session.`);
        }

        if (createdBy) this.setCurrentTab(createdBy, targetWid);

        const wc = this.windowManager.getWebContents(targetWid);
        return {
          success: true,
          tab_id: targetWid,
          url: wc ? wc.getURL() : found.url,
          title: wc ? wc.getTitle() : found.title,
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
          return { success: false, message: "No tab to close" };
        }

        await this.windowManager.closeWindow(targetWid);

        // 如果关闭的是当前标签，自动切换到相邻标签
        let newCurrentTabId: string | null = null;
        if (targetWid === currentTabId && createdBy) {
          const remaining = this.getWindowList().filter(
            (w) => w.metadata?.createdBy === createdBy,
          );
          if (remaining.length > 0) {
            newCurrentTabId = remaining[0].windowId;
            this.setCurrentTab(createdBy, newCurrentTabId);
          } else {
            this.clearCurrentTab(createdBy);
          }
        }

        return {
          success: true,
          closed_tab_id: targetWid,
          current_tab_id: newCurrentTabId,
        };
      }

      case "close_all": {
        let count = 0;
        for (const w of sessionWindows) {
          await this.windowManager.closeWindow(w.windowId);
          count++;
        }
        if (createdBy) this.clearCurrentTab(createdBy);
        return { success: true, closed_count: count };
      }

      default:
        throw new Error(`Unknown tabs action: ${action}`);
    }
  }

  /**
   * 打开新标签页（兼容旧接口）
   */
  async openNewWindow(
    url: string,
    sessionPath?: string,
    sessionId?: string,
    createdBy?: string,
  ): Promise<any> {
    const metadata: Record<string, any> = {};
    if (sessionPath) metadata.sessionPath = sessionPath;
    if (sessionId) metadata.sessionId = sessionId;
    if (createdBy) metadata.createdBy = createdBy;
    const wid = await this.createWindow(
      url,
      Object.keys(metadata).length > 0 ? metadata : undefined,
    );
    if (createdBy) this.setCurrentTab(createdBy, wid);

    return {
      success: true,
      windowId: wid,
      tab_id: wid,
      url: url,
      message: "Tab created and set as current",
    };
  }

  /**
   * 关闭指定标签（兼容旧接口）
   */
  async closeWindow(windowId: string, createdBy?: string): Promise<any> {
    try {
      await this.ensureWindow(windowId, createdBy);
    } catch (e: any) {
      return { success: false, message: e.message };
    }

    if (!this.windowManager) {
      return { success: false, message: "TabManager not initialized" };
    }

    const success = await this.windowManager.closeWindow(windowId);
    return { success, message: success ? "Tab closed" : "Failed to close tab" };
  }

  /**
   * 关闭指定创建者的所有窗口（子代理清理）
   */
  async closeWindowsByCreator(createdBy: string): Promise<any> {
    if (!this.windowManager) {
      return { success: false, message: "TabManager not initialized" };
    }
    const windows = this.getWindowList().filter(
      (w) => w.metadata?.createdBy === createdBy,
    );
    log.info(`Closing ${windows.length} windows for creator ${createdBy}`);
    for (const w of windows) {
      await this.windowManager.closeWindow(w.windowId);
    }
    this.clearCurrentTab(createdBy);
    return { success: true, closed: windows.length };
  }

  /**
  /**
   * 获取当前标签控制台日志
   */
  async getConsoleLogs(createdBy: string): Promise<any> {
    if (!this.windowManager) {
      return { success: false, message: "TabManager not initialized" };
    }
    const { windowId: wid } = await this.ensureWindow("", createdBy);
    // 复制一份再清空，避免返回的引用被 clearConsoleLogs 清空
    const logs = [...this.windowManager.getConsoleLogs(wid)];
    this.windowManager.clearConsoleLogs(wid);
    return {
      success: true,
      tab_id: wid,
      logs: logs || [],
      recent: (logs || []).slice(-50).join("\n"),
    };
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
        fail(new Error(`Page load failed: ${errorCode} - ${errorDescription}`));
      };

      timer = setTimeout(() => fail(new Error("Page load timeout")), timeout);

      const currentUrl = webContents.getURL();
      if (
        !webContents.isLoading() &&
        currentUrl !== "" &&
        currentUrl !== "about:blank"
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
        // ── 新统一接口 ──

        case "browser_navigate":
          return await this.navigate(
            params.url,
            params.new_tab || false,
            params.created_by,
            params.session_path,
            params.session_id,
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
          );

        // ── 保留接口（操作当前标签）──

        case "browser_evaluate":
          return await this.executeJavaScript(
            params.code,
            "",
            params.is_async || false,
            params.created_by,
          );

        case "browser_page_text":
          return await this.getPageText(
            "",
            params.created_by,
          );

        case "browser_wait":
          return await this.waitForSelector(
            params.selector,
            params.timeout,
            "",
            params.created_by,
          );

        case "browser_click":
          return await this.click(
            params.selector,
            "",
            params.created_by,
          );

        case "browser_input":
          return await this.fillForm(
            params.selector,
            params.value,
            "",
            params.created_by,
          );

        case "browser_interact":
          if (params.action === "click") {
            return await this.click(
              params.selector,
              "",
              params.created_by,
            );
          } else {
            return await this.fillForm(
              params.selector,
              params.value,
              "",
              params.created_by,
            );
          }

        case "browser_console":
          return await this.getConsoleLogs(
            params.created_by,
          );

        case "browser_screenshot":
          return await this.screenshot(
            params.created_by,
            params.file_path,
            params.session_path,
          );

        case "browser_history":
        case "browser_navigate_history": {
          if (params.action === "back") {
            return await this.goBack(
              "",
              params.created_by,
            );
          } else {
            return await this.goForward(
              "",
              params.created_by,
            );
          }
        }

        case "browser_reload":
          return await this.reload(
            "",
            params.created_by,
          );

        // ── 兼容旧接口（仍接受 window_id）──

        case "browser_new_window":
          return await this.openNewWindow(
            params?.url,
            params?.session_path,
            params?.session_id,
            params?.created_by,
          );

        case "browser_page_struct":
          return await this.snapshot("struct", params.created_by);

        case "browser_page_summary":
          return await this.snapshot("summary", params.created_by);

        case "browser_close":
          return await this.tabsManage(
            "close",
            params.created_by,
            undefined,
            params.window_id,
          );

        case "browser_close_by_creator":
          return await this.closeWindowsByCreator(params.created_by);

        case "browser_windows":
          return await this.tabsManage("list", params.created_by || params.session_id);

        default:
          throw new Error(`Unknown method: ${method}`);
      }
    } catch (error: any) {
      log.error(`Error handling tool call ${method}:`, error);
      throw error;
    }
  }

  /**
   * 检查服务是否就绪
   */
  isReady(): boolean {
    return this.windowManager !== null;
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

  /**
   * 获取当前窗口数量
   */
  getWindowCount(): number {
    if (!this.windowManager) {
      return 0;
    }
    return this.windowManager
      .getWindowList()
      .filter((w) => w.windowId !== "main_app").length;
  }
  private truncateConsoleLogs(
    logs: Array<{ level: number; message: string }>,
    maxChars: number,
  ): Array<{ level: number; message: string }> {
    if (logs.length === 0) return [];

    let totalChars = 0;
    const selectedLogs: Array<{ level: number; message: string }> = [];

    // 从后往前遍历，保留最近的日志
    const reversedLogs = [...logs].reverse();

    for (const log of reversedLogs) {
      const levelNames: Record<number, string> = {
        0: "verbose",
        1: "info",
        2: "warning",
        3: "error",
      };
      const levelName = levelNames[log.level] || "unknown";
      const logLine = `[${levelName}] ${log.message}`;

      if (totalChars + logLine.length <= maxChars) {
        selectedLogs.unshift(log);
        totalChars += logLine.length + 1; // +1 for newline
      } else {
        break;
      }
    }

    return selectedLogs;
  }
}
