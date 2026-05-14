import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { BrowserWindowManager, WindowInfo } from './browser-tab-manager'

/**
 * 浏览器自动化工具请求接口
 */
export interface ToolRequest {
  id: string
  method: string
  params: any
}

/**
 * 浏览器自动化工具响应接口
 */
export interface ToolResponse {
  id: string
  result?: any
  error?: string
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
  private windowManager: BrowserWindowManager | null = null
  private maxWindows: number = 6 // 默认最多6个窗口（含主应用，即可创建5个）
  private inactivityTimeout: number = 300000 // 默认5分钟无操作自动关闭

  constructor(config: { maxWindows?: number; inactivityTimeout?: number } = {}) {
    this.maxWindows = config.maxWindows || 6
    this.inactivityTimeout = config.inactivityTimeout || 300000
  }

  /**
   * 初始化窗口管理器（必须在应用启动时调用）
   */
  initializeWindowManager(windowManager: BrowserWindowManager): void {
    this.windowManager = windowManager
    log.info('BrowserAutomationService initialized with WindowManager')
  }

  /**
   * 创建新的浏览器窗口
   * @param url - 初始 URL（可选）
   * @param metadata - 元数据（可选，用于 session 隔离和作用域标识）
   * @returns 窗口ID
   */
  async createWindow(url?: string, metadata?: Record<string, any>): Promise<string> {
    if (!this.windowManager) {
      throw new Error('WindowManager not initialized. Call initializeWindowManager() first.')
    }

    const windowInfo = await this.windowManager.createWindow(url, metadata)

    log.info(`Browser window created: ${windowInfo.windowId}`, metadata)
    return windowInfo.windowId
  }


  /**
   * 确保窗口存在
   */
  private async ensureWindow(windowId: string): Promise<{ windowId: string; windowInfo: WindowInfo }> {
    if (!windowId) {
      throw new Error('window_id is required for all browser operations')
    }

    if (!this.windowManager) {
      throw new Error('WindowManager not initialized')
    }

    const windows = this.windowManager.getWindowList()
    const windowInfo = windows.find(w => w.windowId === windowId)

    if (!windowInfo) {
      throw new Error(`Window ${windowId} not found. Use get_window_list() to see available windows.`)
    }

    return { windowId, windowInfo }
  }

  /**
   * 销毁所有窗口并清理数据
   */
  async destroy(): Promise<void> {
    if (!this.windowManager) {
      log.info('No windows to destroy')
      return
    }

    log.info('Destroying all browser windows...')

    try {
      const windows = this.windowManager.getWindowList()
      for (const win of windows) {
        // 不关闭主应用窗口
        if (!win.isMainApp) {
          try {
            await this.windowManager.closeWindow(win.windowId)
          } catch (error) {
            log.error(`Error closing window ${win.windowId}:`, error)
          }
        }
      }

      log.info('All windows destroyed')
    } catch (error) {
      log.error('Error during window destruction:', error)
    }
  }

  /**
   * 导航到指定 URL
   */
  async navigate(url: string, windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('WindowManager not initialized')
    }

    log.info(`Navigating to: ${url} (window: ${wid})`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Window ${wid} not found`)
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Navigation timeout'))
      }, 30000)

      webContents.once('did-finish-load', () => {
        clearTimeout(timeout)
        resolve({
          success: true,
          windowId: wid,
          url: webContents.getURL(),
          title: webContents.getTitle(),
        })
      })

      webContents.once('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
        clearTimeout(timeout)
        reject(new Error(`Navigation failed: ${errorCode} - ${errorDescription}`))
      })

      webContents.loadURL(url).catch(reject)
    })
  }

  /**
   * 获取页面截图
   * TODO: 暂时注释，待后续优化
   */
  // async screenshot(options: { format?: 'png' | 'jpeg'; quality?: number; windowId?: string } = {}): Promise<any> {
  //   const { windowId, ...screenshotOptions } = options
  //   const { wid } = await this.ensureTab(windowId)

  //   if (!this.windowManager) {
  //     throw new Error('TabManager not initialized')
  //   }

  //   log.info(`Taking screenshot (tab: ${wid})...`)

  //   const webContents = this.windowManager.getWebContents(wid)
  //   if (!webContents) {
  //     throw new Error(`Tab ${wid} not found`)
  //   }

  //   // 等待页面完全加载
  //   await this.waitForPageLoad(webContents)

  //   const image = await webContents.capturePage()
  //   const buffer = screenshotOptions.format === 'jpeg'
  //     ? image.toJPEG(screenshotOptions.quality || 90)
  //     : image.toPNG()

  //   const base64 = buffer.toString('base64')

  //   return {
  //     success: true,
  //     windowId: wid,
  //     format: screenshotOptions.format || 'png',
  //     data: base64,
  //   }
  // }

  /**
   * 执行 JavaScript 代码
   */
  /**
   * 执行 JavaScript 代码
   * @param code JavaScript 代码
   * @param windowId 窗口 ID（可选）
   * @param isAsync 是否支持异步代码（默认 false）
   */
  async executeJavaScript(code: string, windowId: string, isAsync: boolean = false): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Executing JavaScript (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    // 设置控制台日志捕获
    const consoleLogs: Array<{ level: number; message: string }> = []
    const MAX_CONSOLE_LINES = 200
    const MAX_CONSOLE_CHARS = 5000
    
    const consoleListener = (event: Electron.ConsoleMessageEvent) => {
      const levelNames: Record<number, string> = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }
      const levelName = levelNames[event.level] || 'unknown'
      log.debug(`[Renderer Console][${levelName}] ${event.message}`)
      consoleLogs.push({ level: event.level, message: event.message })
      
      // 限制行数：超过200行时移除最早的日志
      if (consoleLogs.length > MAX_CONSOLE_LINES) {
        consoleLogs.shift()
      }
    }
    // @ts-ignore - console-message is a valid Electron event
    webContents.on('console-message', consoleListener)
    log.debug(`Console listener attached for tab ${wid} (max ${MAX_CONSOLE_LINES} lines, ${MAX_CONSOLE_CHARS} chars)`)

    try {
      // 如果是异步模式,将代码包装在 async IIFE 中
      // 关键改进:在渲染进程中包裹 try-catch,返回错误对象而不是抛出异常
      
      // 定义 safeSerialize 函数，注入到渲染进程中
      const safeSerializeFunction = `
        function safeSerialize(value) {
          if (value === null || value === undefined) {
            return value;
          }
          
          const type = typeof value;
          if (type === 'string' || type === 'number' || type === 'boolean') {
            return value;
          }
          
          // 检测 DOM 元素（使用 duck typing）
          if (value && value.nodeType === 1 && value.tagName) {
            const tagName = value.tagName.toLowerCase();
            const id = value.id ? '#' + value.id : '';
            const className = value.className && typeof value.className === 'string' 
              ? '.' + value.className.split(' ').filter(c => c).join('.') 
              : '';
            return '[HTMLElement: ' + tagName + id + className + ']';
          }
          
          // 检测 NodeList
          if (value && typeof value.length === 'number' && value.item) {
            return '[NodeList: ' + value.length + ' items]';
          }
          
          // 处理函数
          if (type === 'function') {
            return '[Function]';
          }
          
          // 对于对象和数组，递归处理其中的不可序列化值
          if (Array.isArray(value)) {
            return value.map(item => safeSerialize(item));
          }
          
          if (type === 'object') {
            const result = {};
            for (const key in value) {
              if (value.hasOwnProperty(key)) {
                result[key] = safeSerialize(value[key]);
              }
            }
            return result;
          }
          
          return value;
        }
      `
      
      const wrappedCode = isAsync 
        ? `(async () => { 
            ${safeSerializeFunction}
            try { 
              // 使用 eval 执行多行代码，返回最后一行的值
              const result = await (async () => { ${code} })();
              return { __success: true, data: safeSerialize(result) };
            } catch (error) {
              return {
                __success: false,
                error: {
                  name: error.name || 'Error',
                  message: error.message || String(error),
                  stack: error.stack || '',
                  lineNumber: error.lineNumber,
                  columnNumber: error.columnNumber
                }
              };
            }
          })()` 
        : `
          (function() {
            ${safeSerializeFunction}
            try { 
              // 使用 eval 执行多行代码，返回最后一行的值
              const result = (function() { ${code} })();
              return { __success: true, data: safeSerialize(result) };
            } catch (error) {
              return {
                __success: false,
                error: {
                  name: error.name || 'Error',
                  message: error.message || String(error),
                  stack: error.stack || '',
                  lineNumber: error.lineNumber,
                  columnNumber: error.columnNumber
                }
              };
            }
          })()
        `
          
      const result = await webContents.executeJavaScript(wrappedCode, true)
      log.debug(`JavaScript execution completed, captured ${consoleLogs.length} console messages`)
          
      // 检查是否是错误响应
      if (result && typeof result === 'object' && '__success' in result) {
        if (!result.__success) {
          // 执行失败,返回详细错误信息
          const errorInfo = result.error
          let detailedError = errorInfo.message
              
          if (errorInfo.name && errorInfo.name !== 'Error') {
            detailedError = `${errorInfo.name}: ${errorInfo.message}`
          }
              
          if (errorInfo.stack) {
            const stackLines = errorInfo.stack.split('\n').slice(0, 3).join('\n')
            detailedError += `\nStack trace:\n${stackLines}`
          }
              
          if (errorInfo.lineNumber !== undefined || errorInfo.columnNumber !== undefined) {
            const line = errorInfo.lineNumber ?? '?'
            const col = errorInfo.columnNumber ?? '?'
            detailedError += `\nLocation: Line ${line}, Column ${col}`
          }
              
          // 附加控制台日志（应用长度限制）
          if (consoleLogs.length > 0) {
            detailedError += `\n\nConsole logs:`
            let totalChars = 0
            let truncatedCount = 0
            
            // 从后往前遍历，保留最近的日志
            const reversedLogs = [...consoleLogs].reverse()
            const selectedLogs: Array<{ level: number; message: string }> = []
            
            for (const log of reversedLogs) {
              const levelNames: Record<number, string> = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }
              const levelName = levelNames[log.level] || 'unknown'
              const logLine = `[${levelName}] ${log.message}`
              
              if (totalChars + logLine.length <= MAX_CONSOLE_CHARS) {
                selectedLogs.unshift(log)
                totalChars += logLine.length + 1 // +1 for newline
              } else {
                truncatedCount++
              }
            }
            
            if (truncatedCount > 0) {
              detailedError += `\n(Showing last ${selectedLogs.length} logs, ${truncatedCount} older logs omitted due to ${MAX_CONSOLE_CHARS} char limit)`
            }
            
            selectedLogs.forEach(log => {
              const levelNames: Record<number, string> = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }
              const levelName = levelNames[log.level] || 'unknown'
              detailedError += `\n[${levelName}] ${log.message}`
            })
          }
              
          log.error(`JavaScript execution failed in tab ${wid}:`, detailedError)
              
          return {
            success: false,
            windowId: wid,
            error: detailedError,
            details: errorInfo,
            consoleLogs: consoleLogs.length > 0 ? consoleLogs : undefined,
          }
        }
            
        // 执行成功,返回数据
        return {
          success: true,
          windowId: wid,
          result: result.data,
          consoleLogs: consoleLogs.length > 0 ? this.truncateConsoleLogs(consoleLogs, MAX_CONSOLE_CHARS) : undefined,
        }
      }
          
      // 兼容旧代码:如果没有 __success 标记,直接返回结果
      return {
        success: true,
        windowId: wid,
        result,
        consoleLogs: consoleLogs.length > 0 ? this.truncateConsoleLogs(consoleLogs, MAX_CONSOLE_CHARS) : undefined,
      }
    } catch (error: any) {
      // 这里捕获的是主进程级别的错误(如页面未加载、通信失败等)
      log.error(`JavaScript execution failed in tab ${wid}:`, error.message)
      
      // 构建详细错误信息
      let errorMessage = error.message
      
      // 如果是通用的脚本执行失败错误，尝试提供更多上下文
      if (error.message.includes('Script failed to execute')) {
        errorMessage = `Script execution failed. This usually means a syntax error or runtime exception occurred.\n`
        errorMessage += `Original error: ${error.message}\n`
        
        // 附加控制台日志帮助调试（应用长度限制）
        if (consoleLogs.length > 0) {
          errorMessage += `\nConsole logs captured before failure:`
          let totalChars = 0
          let truncatedCount = 0
          
          // 从后往前遍历，保留最近的日志
          const reversedLogs = [...consoleLogs].reverse()
          const selectedLogs: Array<{ level: number; message: string }> = []
          
          for (const log of reversedLogs) {
            const levelNames: Record<number, string> = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }
            const levelName = levelNames[log.level] || 'unknown'
            const logLine = `[${levelName}] ${log.message}`
            
            if (totalChars + logLine.length <= MAX_CONSOLE_CHARS) {
              selectedLogs.unshift(log)
              totalChars += logLine.length + 1 // +1 for newline
            } else {
              truncatedCount++
            }
          }
          
          if (truncatedCount > 0) {
            errorMessage += `\n(Showing last ${selectedLogs.length} logs, ${truncatedCount} older logs omitted due to ${MAX_CONSOLE_CHARS} char limit)`
          }
          
          selectedLogs.forEach(log => {
            const levelNames: Record<number, string> = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }
            const levelName = levelNames[log.level] || 'unknown'
            errorMessage += `\n[${levelName}] ${log.message}`
          })
        } else {
          errorMessage += `\nNo console logs were captured. The error may have occurred during script parsing.`
        }
        
        errorMessage += `\n\nSuggestions:`
        errorMessage += `\n1. Check for syntax errors in your JavaScript code`
        errorMessage += `\n2. Ensure all variables and functions are defined`
        errorMessage += `\n3. Try wrapping your code in a try-catch block`
        errorMessage += `\n4. Use execute_js with simpler code first to test`
      }
          
      return {
        success: false,
        windowId: wid,
        error: errorMessage,
        consoleLogs: consoleLogs.length > 0 ? this.truncateConsoleLogs(consoleLogs, MAX_CONSOLE_CHARS) : undefined,
      }
    } finally {
      // 清理控制台监听器
      // @ts-ignore - console-message is a valid Electron event
      webContents.off('console-message', consoleListener)
      log.debug(`Console listener removed for tab ${wid}, total logs captured: ${consoleLogs.length}`)
    }
  }

  /**
   * 获取页面结构化 JSON（选择器风格优化 - 方案 E）
   * 
   * 返回格式示例：
   * {
   *   "node": "div.class#id",
   *   "href": "/path",
   *   "children": ["span", { "node": "a", "text": "Link" }]
   * }
   */
  async getPageStruct(windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Getting page structure (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents)

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL()
    const pageTitle = webContents.getTitle()
    const isLoading = webContents.isLoading()
    log.info(`Page status: URL=${currentUrl}, Title=${pageTitle}, Loading=${isLoading}`)

    let jsonStructure: any
    let originalHtmlLength = 0
    try {
      // 先获取原始 HTML 长度用于对比
      originalHtmlLength = await webContents.executeJavaScript(`
        (function() {
          return document.documentElement.outerHTML.length;
        })()
      `)
      log.debug(`Original HTML length: ${originalHtmlLength} chars`)

      log.debug('Executing JavaScript to get page structure...')
      jsonStructure = await webContents.executeJavaScript(`
        (function() {
          try {
            // 配置常量
            const CONFIG = {
              MAX_DEPTH: 50,              // 最大递归深度
              SIMPLE_DEPTH: 15,           // 超过此深度仅显示 node 字段
              MAX_SIBLINGS: 10,           // 同类型子节点最大数量
              KEEP_HEAD_COUNT: 5,         // 列表省略时保留的头部数量
              KEEP_TAIL_COUNT: 3,         // 列表省略时保留的尾部数量
              MAX_TEXT_LENGTH: 2000,      // 文本最大长度
              MAX_ATTR_VALUE_LENGTH: 300  // 属性值最大长度
            };

            // DOM 转 JSON 的核心函数（智能压缩优化 - 方案 F）
            function domToSmartCompress(element, depth, parentSelector) {
              if (depth > CONFIG.MAX_DEPTH) {
                return { node: '...', warning: 'Maximum depth exceeded' };
              }
              
              const tag = element.tagName.toLowerCase();
              const id = element.id;
              const classes = (typeof element.className === 'string' && element.className) 
                ? element.className.trim().split(/\\s+/).filter(Boolean) 
                : [];
              
              // 构建选择器字符串: tag.class1.class2#id
              let selectorStr = tag;
              if (classes.length > 0) selectorStr += '.' + classes.join('.');
              if (id) selectorStr += '#' + id;
              
              const currentSelector = parentSelector ? parentSelector + ' > ' + selectorStr : selectorStr;
              
              // 超过 SIMPLE_DEPTH 后，仅返回 node 字段
              if (depth > CONFIG.SIMPLE_DEPTH) {
                return { node: selectorStr };
              }
              
              const node = { node: selectorStr };
              
              // 获取当前页面域名用于 URL 精简
              const currentHost = window.location.host;
              
              // 处理其他属性（排除 class, id），直接平铺到节点对象中
              for (let i = 0; i < element.attributes.length; i++) {
                const attr = element.attributes[i];
                if (['class', 'id'].includes(attr.name)) continue;
                
                let value = attr.value;
                
                // 针对 href 进行同源域名精简
                if (attr.name === 'href' && value) {
                  const protocolRegex = /^(https?:)?\\/\\//;
                  if (protocolRegex.test(value)) {
                    try {
                      const urlObj = new URL(value, window.location.href);
                      if (urlObj.host === currentHost) {
                        value = urlObj.pathname + urlObj.search + urlObj.hash;
                        if (!value.startsWith('/')) value = '/' + value;
                      }
                    } catch (e) {}
                  }
                }
                
                // 白名单过滤：只保留 href, role 和特定的 data-*
                if (attr.name === 'href' || attr.name === 'role') {
                  // 保留
                } else if (attr.name.startsWith('data-')) {
                  const suffix = attr.name.substring(5).toLowerCase();
                  if (!suffix.includes('-id') && !suffix.includes('-url')) {
                    continue;
                  }
                } else {
                  continue;
                }
                
                // 长度大于 300 截断
                if (value.length > CONFIG.MAX_ATTR_VALUE_LENGTH) {
                  value = value.substring(0, CONFIG.MAX_ATTR_VALUE_LENGTH) + '...';
                }
                node[attr.name] = value;
              }
              
              // 处理文本
              const text = element.textContent ? element.textContent.trim() : '';
              if (element.children.length === 0 && text.length > 0) {
                node.text = text.substring(0, CONFIG.MAX_TEXT_LENGTH);
              }
              
              // 处理子节点（带智能压缩）
              const children = [];
              const childElements = Array.from(element.children);
              
              // 检测是否需要列表压缩
              if (childElements.length > CONFIG.MAX_SIBLINGS) {
                // 按选择器分组统计
                const groupMap = new Map();
                childElements.forEach(child => {
                  const childTag = child.tagName.toLowerCase();
                  const childClasses = (typeof child.className === 'string' && child.className)
                    ? child.className.trim().split(/\\s+/).filter(Boolean).join('.')
                    : '';
                  const groupKey = childTag + (childClasses ? '.' + childClasses : '');
                  
                  if (!groupMap.has(groupKey)) {
                    groupMap.set(groupKey, []);
                  }
                  groupMap.get(groupKey).push(child);
                });
                
                // 对每个组进行处理
                groupMap.forEach((group, groupKey) => {
                  if (group.length > CONFIG.MAX_SIBLINGS) {
                    // 保留头部和尾部，中间插入省略提示
                    const headCount = Math.min(CONFIG.KEEP_HEAD_COUNT, group.length);
                    const tailCount = Math.min(CONFIG.KEEP_TAIL_COUNT, group.length - headCount);
                    
                    // 添加头部元素
                    for (let i = 0; i < headCount; i++) {
                      const childNode = domToSmartCompress(group[i], depth + 1, currentSelector);
                      if (childNode) children.push(childNode);
                    }
                    
                    // 插入省略提示
                    const omittedCount = group.length - headCount - tailCount;
                    children.push({
                      node: '...',
                      warning: \`Omitted \${omittedCount} similar \${groupKey} elements. Use querySelector('\${currentSelector} > \${groupKey}:nth-child(n)') to access specific items.\`,
                      omittedCount: omittedCount,
                      elementType: groupKey
                    });
                    
                    // 添加尾部元素
                    for (let i = group.length - tailCount; i < group.length; i++) {
                      const childNode = domToSmartCompress(group[i], depth + 1, currentSelector);
                      if (childNode) children.push(childNode);
                    }
                  } else {
                    // 数量不多，全部添加
                    group.forEach(child => {
                      const childNode = domToSmartCompress(child, depth + 1, currentSelector);
                      if (childNode) children.push(childNode);
                    });
                  }
                });
              } else {
                // 子节点数量不多，正常处理
                for (let i = 0; i < childElements.length; i++) {
                  const childNode = domToSmartCompress(childElements[i], depth + 1, currentSelector);
                  if (childNode) children.push(childNode);
                }
              }
              
              if (children.length > 0) {
                // 极简子节点优化：如果子节点只有 node 字段，则转为字符串数组
                const allSimple = children.every(c => Object.keys(c).length === 1 && c.node);
                node.child = allSimple ? children.map(c => c.node) : children;
              }
              
              return node;
            }
            
            // 克隆并清理 DOM（从 body 开始，避免 html 和 head 层）
            const clone = document.body.cloneNode(true);
            const unwantedSelectors = 'script, style, link, noscript, meta, iframe';
            const unwantedElements = clone.querySelectorAll(unwantedSelectors);
            for (let i = unwantedElements.length - 1; i >= 0; i--) {
              if (unwantedElements[i].parentNode) unwantedElements[i].parentNode.removeChild(unwantedElements[i]);
            }
            
            const svgs = clone.querySelectorAll('svg');
            for (let i = 0; i < svgs.length; i++) {
              while (svgs[i].attributes.length > 0) svgs[i].removeAttribute(svgs[i].attributes[0].name);
              while (svgs[i].firstChild) svgs[i].removeChild(svgs[i].firstChild);
            }
            
            // 清理 blob URL 和 object URL，避免克隆后访问失败
            function cleanBlobUrls(node) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const attrsToRemove = [];
                for (let i = 0; i < node.attributes.length; i++) {
                  const attr = node.attributes[i];
                  // 检测 blob: 或 object URLs
                  if (attr.value && (attr.value.startsWith('blob:') || attr.value.startsWith('object:'))) {
                    attrsToRemove.push(attr.name);
                  }
                }
                attrsToRemove.forEach(attrName => node.removeAttribute(attrName));
                
                // 递归处理子节点
                Array.from(node.childNodes).forEach(cleanBlobUrls);
              }
            }
            cleanBlobUrls(clone);
            
            function removeComments(node) {
              if (node.nodeType === Node.COMMENT_NODE) {
                if (node.parentNode) node.parentNode.removeChild(node);
                return;
              }
              Array.from(node.childNodes).forEach(removeComments);
            }
            removeComments(clone);
            
            function removeEmptyElements(node) {
              Array.from(node.childNodes).forEach(child => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                  removeEmptyElements(child);
                  const tagName = child.tagName.toLowerCase();
                  // 保留所有表单元素和交互式元素，即使是空的
                  const isFormElement = ['button', 'input', 'select', 'textarea', 'form'].includes(tagName);
                  const isInteractive = ['a', 'label'].includes(tagName);
                  
                  if (!isFormElement && !isInteractive && ['div', 'span', 'p', 'section', 'article', 'aside'].includes(tagName)) {
                    const hasText = child.textContent && child.textContent.trim().length > 0;
                    const hasChildren = child.children.length > 0;
                    const hasImportantAttrs = child.hasAttribute('id') || child.hasAttribute('role') ||
                                             (child.className && typeof child.className === 'string' && 
                                              /nav|header|footer|main|content/.test(child.className));
                    if (!hasText && !hasChildren && !hasImportantAttrs && child.parentNode) {
                      child.parentNode.removeChild(child);
                    }
                  }
                }
              });
            }
            removeEmptyElements(clone);
            
            return domToSmartCompress(clone, 0, '');
          } catch (error) {
            console.error('Error in getPageStruct:', error);
            return { node: 'error', text: 'Failed to parse DOM: ' + error.toString() };
          }
        })()
      `)
      log.debug(`Successfully got page structure, length: ${JSON.stringify(jsonStructure).length} chars`)

      // 计算并记录压缩比例
      const jsonLength = JSON.stringify(jsonStructure).length
      const compressionRatio = ((1 - jsonLength / originalHtmlLength) * 100).toFixed(2)
      log.info(`Page Structure Size Comparison:`)
      log.info(`   Original HTML:    ${originalHtmlLength.toLocaleString()} chars`)
      log.info(`   Selector JSON:    ${jsonLength.toLocaleString()} chars (${compressionRatio}% reduction)`)
      log.info(`   Saved:            ${(originalHtmlLength - jsonLength).toLocaleString()} chars`)
    } catch (error: any) {
      log.warn(`Failed to get page structure: ${error.message}`)
      log.warn(`   Error name: ${error.name}`)
      log.warn(`   Error stack: ${error.stack}`)

      // 降级方案：返回错误对象
      jsonStructure = { node: 'error', text: 'Failed to parse DOM: ' + error.toString() }
    }

    const title = webContents.getTitle()
    const url = webContents.getURL()

    return {
      success: true,
      windowId: wid,
      url,
      title,
      struct: jsonStructure,
    }
  }

  /**
   * 获取页面纯文本内容
   */
  async getPageText(windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Getting page text (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents)

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL()
    const pageTitle = webContents.getTitle()
    log.info(`Page status for text: URL=${currentUrl}, Title=${pageTitle}`)

    let text = ''
    try {
      log.debug('Executing JavaScript to extract plain text...')
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
      `)
    } catch (error: any) {
      log.error(`Failed to get plain text`)
      log.error(`   Error message: ${error.message}`)
      log.error(`   Error name: ${error.name}`)
      log.error(`   Tab ID: ${wid}`)
      log.error(`   URL: ${currentUrl}`)
      throw new Error(`Failed to get plain text: ${error.message}`)
    }

    const title = webContents.getTitle()
    const url = webContents.getURL()

    return {
      success: true,
      windowId: wid,
      url,
      title,
      text,
    }
  }

  /**
   * 获取页面摘要（文字、链接和标题层级）
   */
  async getPageSummary(windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Getting main structure (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents)

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL()
    const pageTitle = webContents.getTitle()
    log.info(`Page status for structure: URL=${currentUrl}, Title=${pageTitle}`)

    let structure: any
    try {
      log.debug('Executing JavaScript to extract main structure...')

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
      `)

      // 检查是否返回了错误信息
      if (structure && structure.error) {
        log.warn(`JavaScript execution returned error: ${structure.error}`)
      }

      log.debug(`Successfully got structure: text=${structure.text?.length || 0} chars, links=${structure.links?.length || 0}, headings=${structure.headings?.length || 0}`)
    } catch (error: any) {
      log.error(`Failed to get main structure`)
      log.error(`   Error message: ${error.message}`)
      log.error(`   Error name: ${error.name}`)
      log.error(`   Error stack: ${error.stack}`)
      log.error(`   Tab ID: ${wid}`)
      log.error(`   URL: ${currentUrl}`)
      log.error(`   Title: ${pageTitle}`)

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
        `)
        log.error(`   Page diagnostics: ${JSON.stringify(consoleLogs)}`)
      } catch (diagError: any) {
        log.error(`   Failed to get page diagnostics: ${diagError.message}`)
      }

      throw new Error(`Failed to get main structure: ${error.message}`)
    }

    const title = webContents.getTitle()
    const url = webContents.getURL()

    return {
      success: true,
      windowId: wid,
      url,
      title,
      ...structure,
    }
  }

  /**
   * 等待元素出现
   */
  async waitForSelector(selector: string, timeout: number = 10000, windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Waiting for selector: ${selector} (tab: ${wid})`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    const result = await webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const element = document.querySelector('${selector}')
        if (element) {
          resolve({ found: true, exists: true })
          return
        }

        const observer = new MutationObserver(() => {
          const el = document.querySelector('${selector}')
          if (el) {
            observer.disconnect()
            resolve({ found: true, exists: true })
          }
        })

        observer.observe(document.body, { childList: true, subtree: true })

        setTimeout(() => {
          observer.disconnect()
          resolve({ found: false, exists: false })
        }, ${timeout})
      })
    `)

    return {
      success: true,
      windowId: wid,
      ...result,
    }
  }

  /**
   * 点击元素
   */
  async click(selector: string, windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Clicking element: ${selector} (tab: ${wid})`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    const result = await webContents.executeJavaScript(`
      new Promise((resolve) => {
        const element = document.querySelector('${selector}')
        if (element) {
          element.click()
          resolve({ success: true, clicked: true })
        } else {
          resolve({ success: false, clicked: false, error: 'Element not found' })
        }
      })
    `)

    return {
      windowId: wid,
      ...result,
    }
  }

  /**
   * 填充表单字段
   */
  async fillForm(selector: string, value: string, windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Filling form field: ${selector} (tab: ${wid})`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    const result = await webContents.executeJavaScript(`
      new Promise((resolve) => {
        const element = document.querySelector('${selector}')
        if (element) {
          element.value = '${value.replace(/'/g, "\\'")}'
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
          resolve({ success: true, filled: true })
        } else {
          resolve({ success: false, filled: false, error: 'Element not found' })
        }
      })
    `)

    return {
      windowId: wid,
      ...result,
    }
  }

  /**
   * 后退
   */
  async goBack(windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Going back (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoBack()) {
      webContents.navigationHistory.goBack()
      await this.waitForPageLoad(webContents)
    }

    return {
      success: true,
      windowId: wid,
      url: webContents.getURL(),
    }
  }

  /**
   * 前进
   */
  async goForward(windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Going forward (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoForward()) {
      webContents.navigationHistory.goForward()
      await this.waitForPageLoad(webContents)
    }

    return {
      success: true,
      windowId: wid,
      url: webContents.getURL(),
    }
  }

  /**
   * 刷新页面
   */
  async reload(windowId: string): Promise<any> {
    const { windowId: wid } = await this.ensureWindow(windowId)

    if (!this.windowManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Reloading page (tab: ${wid})...`)

    const webContents = this.windowManager.getWebContents(wid)
    if (!webContents) {
      throw new Error(`Tab ${wid} not found`)
    }

    webContents.reload()
    await this.waitForPageLoad(webContents)

    return {
      success: true,
      windowId: wid,
      url: webContents.getURL(),
    }
  }

  /**
   * 打开新标签页
   */
  async openNewWindow(url: string): Promise<any> {
    const wid = await this.createWindow(url)

    return {
      success: true,
      windowId: wid,
      url: url,
      message: 'Tab created in background (not activated)',
    }
  }

  /**
   * 关闭指定标签
   */
  async closeWindow(windowId: string): Promise<any> {
    if (!this.windowManager) {
      return {
        success: false,
        message: 'TabManager not initialized',
      }
    }

    const success = await this.windowManager.closeWindow(windowId)

    return {
      success,
      message: success ? 'Tab closed' : 'Failed to close tab',
    }
  }

  /**
   * 等待页面加载完成
   */
  private async waitForPageLoad(webContents: Electron.WebContents, timeout: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Page load timeout'))
      }, timeout)

      // 检查是否已经加载完成
      if (!webContents.isLoadingMainFrame() && webContents.getURL() !== '') {
        clearTimeout(timer)
        resolve()
        return
      }

      // 监听加载完成事件
      webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        resolve()
      })

      // 监听加载失败事件
      webContents.once('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
        clearTimeout(timer)
        reject(new Error(`Page load failed: ${errorCode} - ${errorDescription}`))
      })
    })
  }

  /**
   * 处理工具调用请求
   * 
   * 这是核心分发逻辑，根据 method 调用对应的功能
   * 统一使用 snake_case 命名风格
   */
  async handleToolCall(request: ToolRequest): Promise<any> {
    const { method, params } = request

    log.info(`Handling tool call: ${method}`)

    try {
      switch (method) {
        case 'navigate':
          return await this.navigate(params.url, params.window_id)

        // TODO: 暂时注释截图工具
        // case 'screenshot':
        //   return await this.screenshot({ ...params, windowId: params.window_id })

        case 'execute_js':
          return await this.executeJavaScript(params.code, params.window_id, params.is_async || false)

        case 'get_page_struct':
          return await this.getPageStruct(params.window_id)

        case 'get_page_text':
          return await this.getPageText(params.window_id)

        case 'get_page_summary':
          return await this.getPageSummary(params.window_id)

        case 'wait_for_selector':
          return await this.waitForSelector(params.selector, params.timeout, params.window_id)

        case 'click':
          return await this.click(params.selector, params.window_id)

        case 'fill_input':
          return await this.fillForm(params.selector, params.value, params.window_id)

        case 'go_back':
          return await this.goBack(params.window_id)

        case 'go_forward':
          return await this.goForward(params.window_id)

        case 'reload':
          return await this.reload(params.window_id)

        case 'open_new_window':
          return await this.openNewWindow(params?.url)

        case 'close_window':
          return await this.closeWindow(params.window_id)

        case 'get_window_list':
          return {
            success: true,
            windows: this.getWindowList(),
            count: this.getWindowCount(),
          }

        default:
          throw new Error(`Unknown method: ${method}`)
      }
    } catch (error: any) {
      log.error(`Error handling tool call ${method}:`, error)
      throw error
    }
  }

  /**
   * 检查服务是否就绪
   */
  isReady(): boolean {
    return this.windowManager !== null
  }

  /**
   * 获取所有窗口列表（不包含主应用窗口）
   */
  getWindowList(): WindowInfo[] {
    if (!this.windowManager) {
      return []
    }

    // 直接返回 WindowManager 的窗口列表，过滤掉主应用
    return this.windowManager.getWindowList().filter(w => w.windowId !== 'main_app')
  }

  /**
   * 获取当前窗口数量
   */
  getWindowCount(): number {
    if (!this.windowManager) {
      return 0
    }
    return this.windowManager.getWindowList().filter(w => w.windowId !== 'main_app').length
  }

  /**
   * 截断控制台日志，保留最近的日志，总字符数不超过限制
   * @param logs 原始日志数组
   * @param maxChars 最大字符数
   * @returns 截断后的日志数组
   */
  private truncateConsoleLogs(
    logs: Array<{ level: number; message: string }>,
    maxChars: number
  ): Array<{ level: number; message: string }> {
    if (logs.length === 0) return []

    let totalChars = 0
    const selectedLogs: Array<{ level: number; message: string }> = []

    // 从后往前遍历，保留最近的日志
    const reversedLogs = [...logs].reverse()

    for (const log of reversedLogs) {
      const levelNames: Record<number, string> = { 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }
      const levelName = levelNames[log.level] || 'unknown'
      const logLine = `[${levelName}] ${log.message}`

      if (totalChars + logLine.length <= maxChars) {
        selectedLogs.unshift(log)
        totalChars += logLine.length + 1 // +1 for newline
      } else {
        break
      }
    }

    return selectedLogs
  }
}
