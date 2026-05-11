import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { BrowserTabManager, TabInfo } from './browser-tab-manager'

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
 * 标签页信息接口
 */
export interface WindowInfo {
  windowId: string
  url: string
  title: string
}

/**
 * 浏览器自动化核心服务（基于标签页系统)
 * 
 * 职责说明：
 * - 管理多个标签页生命周期（基于 BrowserTabManager）
 * - 执行浏览器自动化操作（导航、截图、JS执行等）
 * - 清理无痕数据
 * - 超时自动关闭
 * 
 * 与通信协议解耦，可被 IPC、TCP、UDP 等多种协议复用
 * 
 * 注意：每个标签页使用独立的 session，与主窗口隔离，避免影响主窗口认证状态
 */
export class BrowserAutomationService {
  private tabManager: BrowserTabManager | null = null
  private maxTabs: number = 6 // 默认最多6个标签（含主应用，即可创建5个）
  private inactivityTimeout: number = 300000 // 默认5分钟无操作自动关闭

  constructor(config: { maxTabs?: number; inactivityTimeout?: number } = {}) {
    this.maxTabs = config.maxTabs || 6
    this.inactivityTimeout = config.inactivityTimeout || 300000
  }

  /**
   * 初始化标签管理器（必须在应用启动时调用）
   */
  initializeTabManager(tabManager: BrowserTabManager): void {
    this.tabManager = tabManager
    log.info('BrowserAutomationService initialized with TabManager')
  }

  /**
   * 创建新的浏览器标签页
   * @param url - 初始 URL（可选）
   * @returns 标签页ID
   */
  async createWindow(url?: string): Promise<string> {
    if (!this.tabManager) {
      throw new Error('TabManager not initialized. Call initializeTabManager() first.')
    }

    const tabInfo = await this.tabManager.createTab(url, false) // 不自动激活

    log.info(`Browser tab created: ${tabInfo.tabId}`)
    return tabInfo.tabId
  }


  /**
   * 确保标签页存在
   */
  private async ensureTab(tabId: string): Promise<{ tabId: string; tabInfo: TabInfo }> {
    if (!tabId) {
      throw new Error('window_id is required for all browser operations')
    }

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    const tabs = this.tabManager.getTabList()
    const tabInfo = tabs.find(t => t.tabId === tabId)

    if (!tabInfo) {
      throw new Error(`Window ${tabId} not found. Use get_window_list() to see available windows.`)
    }

    return { tabId, tabInfo }
  }

  /**
   * 销毁所有标签页并清理数据
   */
  async destroy(): Promise<void> {
    if (!this.tabManager) {
      log.info('No tabs to destroy')
      return
    }

    log.info('Destroying all browser tabs...')

    const tabs = this.tabManager.getTabList()
    for (const tab of tabs) {
      // 不关闭主应用标签
      if (!tab.isMainApp) {
        try {
          await this.tabManager.closeTab(tab.tabId)
        } catch (error) {
          log.error(`Error closing tab ${tab.tabId}:`, error)
        }
      }
    }

    log.info('All tabs destroyed')
  }

  /**
   * 导航到指定 URL
   */
  async navigate(url: string, windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Navigating to: ${url} (tab: ${tabId})`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Navigation timeout'))
      }, 30000)

      webContents.once('did-finish-load', () => {
        clearTimeout(timeout)
        resolve({
          success: true,
          windowId: tabId,
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
  //   const { tabId } = await this.ensureTab(windowId)

  //   if (!this.tabManager) {
  //     throw new Error('TabManager not initialized')
  //   }

  //   log.info(`Taking screenshot (tab: ${tabId})...`)

  //   const webContents = this.tabManager.getWebContents(tabId)
  //   if (!webContents) {
  //     throw new Error(`Tab ${tabId} not found`)
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
  //     windowId: tabId,
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
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Executing JavaScript (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    try {
      // 如果是异步模式,将代码包装在 async IIFE 中
      // 关键改进:在渲染进程中包裹 try-catch,返回错误对象而不是抛出异常
      const wrappedCode = isAsync 
        ? `(async () => { 
            try { 
              const result = ${code};
              return { __success: true, data: result };
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
            try { 
              const result = ${code};
              return { __success: true, data: result };
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
              
          log.error(`JavaScript execution failed in tab ${tabId}:`, detailedError)
              
          return {
            success: false,
            windowId: tabId,
            error: detailedError,
            details: errorInfo,
          }
        }
            
        // 执行成功,返回数据
        return {
          success: true,
          windowId: tabId,
          result: result.data,
        }
      }
          
      // 兼容旧代码:如果没有 __success 标记,直接返回结果
      return {
        success: true,
        windowId: tabId,
        result,
      }
    } catch (error: any) {
      // 这里捕获的是主进程级别的错误(如页面未加载等)
      log.error(`JavaScript execution failed in tab ${tabId}:`, error.message)
          
      return {
        success: false,
        windowId: tabId,
        error: error.message,
      }
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
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Getting page structure (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
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
            // DOM 转 JSON 的核心函数（选择器风格优化 - 方案 E）
            function domToSelectorStyle(element, depth) {
              if (depth > 50) return null;
              
              const tag = element.tagName.toLowerCase();
              const id = element.id;
              // 仅当 className 为字符串时处理
              const classes = (typeof element.className === 'string' && element.className) 
                ? element.className.trim().split(/\\s+/).filter(Boolean) 
                : [];
              
              // 构建选择器字符串: tag.class1.class2#id
              let selectorStr = tag;
              if (classes.length > 0) selectorStr += '.' + classes.join('.');
              if (id) selectorStr += '#' + id;
              
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
                if (value.length > 300) value = value.substring(0, 300) + '...';
                node[attr.name] = value;
              }
              
              // 处理文本
              const text = element.textContent ? element.textContent.trim() : '';
              if (element.children.length === 0 && text.length > 0) {
                node.text = text.substring(0, 10000);
              }
              
              // 处理子节点
              const children = [];
              for (let i = 0; i < element.children.length; i++) {
                const childNode = domToSelectorStyle(element.children[i], depth + 1);
                if (childNode) children.push(childNode);
              }
              
              if (children.length > 0) {
                // 极简子节点优化：如果子节点只有 node 字段，则转为字符串数组
                const allSimple = children.every(c => Object.keys(c).length === 1 && c.node);
                node.children = allSimple ? children.map(c => c.node) : children;
              }
              
              return node;
            }
            
            // 克隆并清理 DOM
            const clone = document.documentElement.cloneNode(true);
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
                  if (['div', 'span', 'p', 'section', 'article', 'aside'].includes(tagName)) {
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
            
            return domToSelectorStyle(clone, 0);
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
      windowId: tabId,
      url,
      title,
      struct: jsonStructure,
    }
  }

  /**
   * 获取页面纯文本内容
   */
  async getPageText(windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Getting page text (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
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
      log.error(`   Tab ID: ${tabId}`)
      log.error(`   URL: ${currentUrl}`)
      throw new Error(`Failed to get plain text: ${error.message}`)
    }

    const title = webContents.getTitle()
    const url = webContents.getURL()

    return {
      success: true,
      windowId: tabId,
      url,
      title,
      text,
    }
  }

  /**
   * 获取页面摘要（文字、链接和标题层级）
   */
  async getPageSummary(windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Getting main structure (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
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
      log.error(`   Tab ID: ${tabId}`)
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
      windowId: tabId,
      url,
      title,
      ...structure,
    }
  }

  /**
   * 等待元素出现
   */
  async waitForSelector(selector: string, timeout: number = 10000, windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Waiting for selector: ${selector} (tab: ${tabId})`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
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
      windowId: tabId,
      ...result,
    }
  }

  /**
   * 点击元素
   */
  async click(selector: string, windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Clicking element: ${selector} (tab: ${tabId})`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
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
      windowId: tabId,
      ...result,
    }
  }

  /**
   * 填充表单字段
   */
  async fillForm(selector: string, value: string, windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Filling form field: ${selector} (tab: ${tabId})`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
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
      windowId: tabId,
      ...result,
    }
  }

  /**
   * 后退
   */
  async goBack(windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Going back (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoBack()) {
      webContents.navigationHistory.goBack()
      await this.waitForPageLoad(webContents)
    }

    return {
      success: true,
      windowId: tabId,
      url: webContents.getURL(),
    }
  }

  /**
   * 前进
   */
  async goForward(windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Going forward (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    // 使用新的 navigationHistory API
    if (webContents.navigationHistory.canGoForward()) {
      webContents.navigationHistory.goForward()
      await this.waitForPageLoad(webContents)
    }

    return {
      success: true,
      windowId: tabId,
      url: webContents.getURL(),
    }
  }

  /**
   * 刷新页面
   */
  async reload(windowId: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`Reloading page (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    webContents.reload()
    await this.waitForPageLoad(webContents)

    return {
      success: true,
      windowId: tabId,
      url: webContents.getURL(),
    }
  }

  /**
   * 打开新标签页
   */
  async openNewWindow(url: string): Promise<any> {
    const tabId = await this.createWindow(url)

    return {
      success: true,
      windowId: tabId,
      url: url,
      message: 'Tab created in background (not activated)',
    }
  }

  /**
   * 关闭指定标签
   */
  async closeWindow(windowId: string): Promise<any> {
    if (!this.tabManager) {
      return {
        success: false,
        message: 'TabManager not initialized',
      }
    }

    const success = await this.tabManager.closeTab(windowId)

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
    return this.tabManager !== null
  }

  /**
   * 获取所有标签页列表（不包含主应用标签）
   */
  getWindowList(): WindowInfo[] {
    if (!this.tabManager) {
      return []
    }

    const tabs = this.tabManager.getTabList().filter(t => t.tabId !== 'main_app')
    return tabs.map(tab => ({
      windowId: tab.tabId,
      url: tab.url,
      title: tab.title,
    }))
  }

  /**
   * 获取当前标签页数量
   */
  getWindowCount(): number {
    if (!this.tabManager) {
      return 0
    }
    return this.tabManager.getTabList().filter(t => t.tabId !== 'main_app').length
  }
}
