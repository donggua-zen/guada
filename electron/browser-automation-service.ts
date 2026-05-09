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
 * 标签页信息接口（兼容 WindowInfo�?
 */
export interface WindowInfo {
  windowId: string
  url: string
  title: string
  createdAt: number
  lastActivityAt: number
  isActive: boolean
}

/**
 * 浏览器自动化核心服务（基于标签页系统�?
 * 
 * 职责�?
 * - 管理多个标签页生命周期（基于 BrowserTabManager�?
 * - 执行浏览器自动化操作（导航、截图、JS执行等）
 * - 清理无痕数据
 * - 超时自动关闭
 * 
 * 与通信协议解耦，可被 IPC、TCP、UDP 等多种协议复�?
 * 
 * 注意：每个标签使用独立的 session，与主窗口隔离，避免影响主窗口认证状�?
 */
export class BrowserAutomationService {
  private tabManager: BrowserTabManager | null = null
  private defaultTabId: string | null = null
  private maxTabs: number = 6 // 默认最多6个标签（含主应用，即可创建5个）
  private inactivityTimeout: number = 300000 // 默认5分钟无操作自动关�?

  constructor(config: { maxTabs?: number; inactivityTimeout?: number } = {}) {
    this.maxTabs = config.maxTabs || 6
    this.inactivityTimeout = config.inactivityTimeout || 300000
  }

  /**
   * 初始化标签管理器（必须在应用启动时调用）
   */
  initializeTabManager(tabManager: BrowserTabManager): void {
    this.tabManager = tabManager
    log.info('�?BrowserAutomationService initialized with TabManager')
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

    const tabInfo = await this.tabManager.createTab(url, false) // 不自动激�?

    // 如果是第一个标签，设为默认标签
    if (!this.defaultTabId) {
      this.defaultTabId = tabInfo.tabId
    }

    log.info(`�?Browser tab created: ${tabInfo.tabId}`)
    return tabInfo.tabId
  }

  /**
   * 获取或创建默认标签页
   */
  private async getOrCreateDefaultTab(): Promise<{ tabId: string; tabInfo: TabInfo }> {
    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    if (!this.defaultTabId) {
      const tabId = await this.createWindow()
      const tabs = this.tabManager.getTabList()
      const tabInfo = tabs.find((t: TabInfo) => t.tabId === tabId)
      if (!tabInfo) {
        throw new Error(`Tab ${tabId} not found`)
      }
      return { tabId, tabInfo }
    }

    const tabs = this.tabManager.getTabList()
    const tabInfo = tabs.find((t: TabInfo) => t.tabId === this.defaultTabId)
    if (!tabInfo) {
      // 默认标签不存在，创建新的
      const tabId = await this.createWindow()
      const newTabs = this.tabManager.getTabList()
      const newTabInfo = newTabs.find((t: TabInfo) => t.tabId === tabId)
      if (!newTabInfo) {
        throw new Error(`Tab ${tabId} not found`)
      }
      return { tabId, tabInfo: newTabInfo }
    }

    return { tabId: this.defaultTabId, tabInfo }
  }

  /**
   * 确保标签页存�?
   */
  private async ensureTab(tabId?: string): Promise<{ tabId: string; tabInfo: TabInfo }> {
    const targetTabId = tabId || this.defaultTabId

    if (!targetTabId) {
      return await this.getOrCreateDefaultTab()
    }

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    const tabs = this.tabManager.getTabList()
    const tabInfo = tabs.find(t => t.tabId === targetTabId)

    if (!tabInfo) {
      return await this.getOrCreateDefaultTab()
    }

    return { tabId: targetTabId, tabInfo }
  }

  /**
   * 销毁所有标签页并清理数�?
   */
  async destroy(): Promise<void> {
    if (!this.tabManager) {
      log.info('⚠️ No tabs to destroy')
      return
    }

    log.info('🧹 Destroying all browser tabs...')

    const tabs = this.tabManager.getTabList()
    for (const tab of tabs) {
      // 不关闭主应用标签
      if (!tab.isMainApp) {
        try {
          await this.tabManager.closeTab(tab.tabId)
        } catch (error) {
          log.error(`�?Error closing tab ${tab.tabId}:`, error)
        }
      }
    }

    log.info('�?All tabs destroyed')
  }

  /**
   * 导航到指�?URL
   */
  async navigate(url: string, windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`🔗 Navigating to: ${url} (tab: ${tabId})`)

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

  //   log.info(`📸 Taking screenshot (tab: ${tabId})...`)

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
  async executeJavaScript(code: string, windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`�?Executing JavaScript (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    try {
      const result = await webContents.executeJavaScript(code, true)
      return {
        success: true,
        windowId: tabId,
        result,
      }
    } catch (error: any) {
      return {
        success: false,
        windowId: tabId,
        error: error.message,
      }
    }
  }

  /**
   * 获取页面 HTML 内容（结构化，移除了脚本和样式）
   */
  async getPageHtml(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`📄 Getting page HTML (tab: ${tabId})...`)

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
    log.info(`📄 Page status: URL=${currentUrl}, Title=${pageTitle}, Loading=${isLoading}`)

    let html = ''
    try {
      // 使用 JavaScript 清理 HTML，移除 script、style、css，只保留必要属性
      log.debug('Executing JavaScript to get cleaned HTML...')
      html = await webContents.executeJavaScript(`
        (function() {
          try {
            // 克隆 document 以避免修改原页面
            const clone = document.documentElement.cloneNode(true);
            
            // 移除所有 script 标签
            const scripts = clone.querySelectorAll('script');
            for (let i = 0; i < scripts.length; i++) {
              if (scripts[i].parentNode) {
                scripts[i].parentNode.removeChild(scripts[i]);
              }
            }
            
            // 移除所有 style 标签
            const styles = clone.querySelectorAll('style');
            for (let i = 0; i < styles.length; i++) {
              if (styles[i].parentNode) {
                styles[i].parentNode.removeChild(styles[i]);
              }
            }
            
            // 移除所有 link 标签（通常是 CSS）
            const links = clone.querySelectorAll('link');
            for (let i = 0; i < links.length; i++) {
              if (links[i].parentNode) {
                links[i].parentNode.removeChild(links[i]);
              }
            }
            
            // 移除所有 noscript 标签
            const noscripts = clone.querySelectorAll('noscript');
            for (let i = 0; i < noscripts.length; i++) {
              if (noscripts[i].parentNode) {
                noscripts[i].parentNode.removeChild(noscripts[i]);
              }
            }
            
            // 移除所有 meta 标签
            const metas = clone.querySelectorAll('meta');
            for (let i = 0; i < metas.length; i++) {
              if (metas[i].parentNode) {
                metas[i].parentNode.removeChild(metas[i]);
              }
            }
            
            // 移除所有 iframe 标签（不保留）
            const iframes = clone.querySelectorAll('iframe');
            for (let i = 0; i < iframes.length; i++) {
              if (iframes[i].parentNode) {
                iframes[i].parentNode.removeChild(iframes[i]);
              }
            }
            
            // 清空所有 SVG 标签的内容和属性，只保留纯 <svg/> 占位符
            const svgs = clone.querySelectorAll('svg');
            for (let i = 0; i < svgs.length; i++) {
              // 移除所有属性
              while (svgs[i].attributes.length > 0) {
                svgs[i].removeAttribute(svgs[i].attributes[0].name);
              }
              // 移除所有子节点
              while (svgs[i].firstChild) {
                svgs[i].removeChild(svgs[i].firstChild);
              }
            }
            
            // 移除所有注释节点
            function removeComments(node) {
              if (node.nodeType === Node.COMMENT_NODE) {
                if (node.parentNode) {
                  node.parentNode.removeChild(node);
                }
                return;
              }
              const children = Array.from(node.childNodes);
              for (const child of children) {
                removeComments(child);
              }
            }
            removeComments(clone);
            
            // 递归移除空元素（没有文本内容且没有子元素的 div、span、p 等）
            function removeEmptyElements(node) {
              const children = Array.from(node.childNodes);
              for (const child of children) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                  removeEmptyElements(child);
                  
                  // 检查是否是应该移除的空元素
                  const tagName = child.tagName.toLowerCase();
                  const emptyTags = ['div', 'span', 'p', 'section', 'article', 'aside'];
                  
                  if (emptyTags.includes(tagName)) {
                    const hasText = child.textContent && child.textContent.trim().length > 0;
                    const hasChildren = child.children.length > 0;
                    const hasImportantAttrs = child.hasAttribute('id') || 
                                             child.hasAttribute('role') ||
                                             (child.className && typeof child.className === 'string' && 
                                              (child.className.includes('nav') || 
                                               child.className.includes('header') || 
                                               child.className.includes('footer') ||
                                               child.className.includes('main') ||
                                               child.className.includes('content')));
                    
                    // 如果没有文本、没有子元素、也没有重要属性，则移除
                    if (!hasText && !hasChildren && !hasImportantAttrs) {
                      if (child.parentNode) {
                        child.parentNode.removeChild(child);
                      }
                    }
                  }
                }
              }
            }
            removeEmptyElements(clone);
            
            // 清理所有元素的属性，只保留 class、id、role、href 和特定的 data-* 属性
            const allElements = clone.querySelectorAll('*');
            for (let i = 0; i < allElements.length; i++) {
              const el = allElements[i];
              const attrs = Array.from(el.attributes);
              
              for (let j = attrs.length - 1; j >= 0; j--) {
                const attrName = attrs[j].name;
                
                // 判断是否应该保留该属性
                let shouldKeep = false;
                
                // 始终保留的基础属性
                if (attrName === 'class' || attrName === 'id' || attrName === 'role' || attrName === 'href') {
                  shouldKeep = true;
                }
                // 处理 data-* 属性：采用白名单机制
                else if (attrName.startsWith('data-')) {
                  // 排除 Vue 的 data-v-* 属性
                  if (attrName.startsWith('data-v-')) {
                    shouldKeep = false;
                  } else {
                    // 提取 data- 后面的部分
                    const dataKey = attrName.substring(5).toLowerCase();
                    // 白名单关键词：包含这些关键词的 data 属性才保留
                    const allowedKeywords = ['url', 'id', 'link', 'href', 'src', 'path', 'route', 'target'];
                    shouldKeep = allowedKeywords.some(keyword => dataKey.includes(keyword));
                  }
                }
                
                // 移除不应该保留的属性
                if (!shouldKeep) {
                  el.removeAttribute(attrName);
                }
              }
            }
            
            // 序列化清理后的 DOM
            const serializer = new XMLSerializer();
            let html = serializer.serializeToString(clone);
            
            // 移除 HTML 格式化产生的换行符，但保留文本块内的换行
            // 策略：移除标签之间的空白和换行，但保留标签内文本的换行
            html = html.replace(/\>\s+\</g, '><');  // 移除标签间的空白和换行
            html = html.replace(/\n\s*/g, '');       // 移除剩余的换行和缩进
            
            return html;
          } catch (error) {
            console.error('Error in getPageHtml:', error);
            // 降级方案：返回原始 outerHTML
            return document.documentElement.outerHTML;
          }
        })()
      `)
      log.debug(`Successfully got cleaned HTML, length: ${html.length} chars`)
    } catch (error: any) {
      log.warn(`⚠️ Failed to get cleaned HTML: ${error.message}`)
      log.warn(`   Error name: ${error.name}`)
      log.warn(`   Error stack: ${error.stack}`)
      
      // 降级方案：通过序列化 DOM 获取
      log.debug('Trying alternative method: XMLSerializer...')
      try {
        html = await webContents.executeJavaScript(`
          (function() {
            try {
              const serializer = new XMLSerializer();
              return serializer.serializeToString(document.documentElement);
            } catch (e) {
              console.error('XMLSerializer failed:', e);
              return document.body ? document.body.innerHTML : '';
            }
          })()
        `)
        log.debug(`Successfully got HTML via XMLSerializer, length: ${html.length} chars`)
      } catch (fallbackError: any) {
        log.error(`❌ All methods failed to get page content`)
        log.error(`   Primary error: ${error.message}`)
        log.error(`   Fallback error: ${fallbackError.message}`)
        log.error(`   Tab ID: ${tabId}`)
        log.error(`   URL: ${currentUrl}`)
        log.error(`   Title: ${pageTitle}`)
        throw new Error(`Failed to get page content. Primary: ${error.message}, Fallback: ${fallbackError.message}`)
      }
    }

    const title = webContents.getTitle()
    const url = webContents.getURL()

    return {
      success: true,
      windowId: tabId,
      url,
      title,
      html,
    }
  }

  /**
   * 获取页面纯文本内容
   */
  async getPageContent(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`📝 Getting page content (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents)

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL()
    const pageTitle = webContents.getTitle()
    log.info(`📝 Page status for content: URL=${currentUrl}, Title=${pageTitle}`)

    let text = ''
    try {
      log.debug('Executing JavaScript to extract plain text...')
      text = await webContents.executeJavaScript(`
        (function() {
          try {
            // 直接使用 document.body.innerText 获取纯文本
            if (!document.body) {
              return '';
            }
            
            // 创建临时容器来移除不需要的元素
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = document.body.innerHTML;
            
            // 移除脚本、样式和 noscript 元素
            const unwantedElements = tempDiv.querySelectorAll('script, style, noscript, link, meta');
            for (let i = 0; i < unwantedElements.length; i++) {
              if (unwantedElements[i].parentNode) {
                unwantedElements[i].parentNode.removeChild(unwantedElements[i]);
              }
            }
            
            // 获取清理后的文本内容
            let text = tempDiv.innerText || tempDiv.textContent || '';
            
            // 清理多余空白：合并连续空行，去除首尾空白
            text = text
              .split('\n')
              .map(function(line) { return line.trim(); })
              .filter(function(line) { return line.length > 0; })
              .join('\n');
            
            return text;
          } catch (error) {
            console.error('Error in getPlainText:', error);
            // 降级方案：直接返回 body 的 innerText
            return document.body ? document.body.innerText : '';
          }
        })()
      `)
      log.debug(`Successfully got plain text, length: ${text.length} chars`)
    } catch (error: any) {
      log.error(`❌ Failed to get plain text`)
      log.error(`   Error message: ${error.message}`)
      log.error(`   Error name: ${error.name}`)
      log.error(`   Tab ID: ${tabId}`)
      log.error(`   URL: ${currentUrl}`)
      
      // 降级方案：尝试直接获取文本
      log.debug('Trying fallback method to get plain text...')
      try {
        text = await webContents.executeJavaScript(`
          (function() {
            try {
              return document.body ? document.body.innerText : '';
            } catch (e) {
              return '';
            }
          })()
        `)
        log.debug(`Successfully got plain text via fallback, length: ${text.length} chars`)
      } catch (fallbackError: any) {
        log.error(`❌ All methods failed to get plain text`)
        log.error(`   Primary error: ${error.message}`)
        log.error(`   Fallback error: ${fallbackError.message}`)
        throw new Error(`Failed to get plain text. Primary: ${error.message}, Fallback: ${fallbackError.message}`)
      }
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
   * 获取原始 HTML
   */
  async getRawHtml(windowId?: string): Promise<any> {
    return await this.getPageContent(windowId)
  }

  /**
   * 获取纯文本内容（移除所有标签和脚本�?
   */
  async getPlainText(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`📝 Getting plain text (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents)

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL()
    const pageTitle = webContents.getTitle()
    log.info(`📝 Page status for plain text: URL=${currentUrl}, Title=${pageTitle}`)

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
          console.error('Error in getPlainText:', error)
          return ''
        }
      })()
    `)
      log.debug(`Successfully got plain text, length: ${text.length} chars`)
    } catch (error: any) {
      log.error(`❌ Failed to get plain text`)
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
   * 获取主要内容结构（文字和链接）
   */
  async getMainStructure(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`🏗️ Getting main structure (tab: ${tabId})...`)

    const webContents = this.tabManager.getWebContents(tabId)
    if (!webContents) {
      throw new Error(`Tab ${tabId} not found`)
    }

    // 等待页面完全加载
    await this.waitForPageLoad(webContents)

    // 记录页面状态信息用于调试
    const currentUrl = webContents.getURL()
    const pageTitle = webContents.getTitle()
    log.info(`🏗️ Page status for structure: URL=${currentUrl}, Title=${pageTitle}`)

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
            console.error('Outer error in getMainStructure:', error);
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
        log.warn(`⚠️ JavaScript execution returned error: ${structure.error}`)
      }

      log.debug(`Successfully got structure: text=${structure.text?.length || 0} chars, links=${structure.links?.length || 0}, headings=${structure.headings?.length || 0}`)
    } catch (error: any) {
      log.error(`❌ Failed to get main structure`)
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
  async waitForSelector(selector: string, timeout: number = 10000, windowId?: string): Promise<any> {
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
  async click(selector: string, windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`🖱️ Clicking element: ${selector} (tab: ${tabId})`)

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
  async fillForm(selector: string, value: string, windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`✏️ Filling form field: ${selector} (tab: ${tabId})`)

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
  async goBack(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`⬅️ Going back (tab: ${tabId})...`)

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
  async goForward(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`➡️ Going forward (tab: ${tabId})...`)

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
  async reload(windowId?: string): Promise<any> {
    const { tabId } = await this.ensureTab(windowId)

    if (!this.tabManager) {
      throw new Error('TabManager not initialized')
    }

    log.info(`🔄 Reloading page (tab: ${tabId})...`)

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
   * 关闭指定标签�?
   */
  async closeWindow(windowId?: string): Promise<any> {
    const targetTabId = windowId || this.defaultTabId

    if (!targetTabId || !this.tabManager) {
      return {
        success: false,
        message: 'Tab not found',
      }
    }

    const success = await this.tabManager.closeTab(targetTabId)

    // 如果关闭的是默认标签，重新选择默认标签
    if (success && this.defaultTabId === targetTabId) {
      const tabs = this.tabManager.getTabList()
      const nonMainAppTab = tabs.find(t => !t.isMainApp)
      this.defaultTabId = nonMainAppTab ? nonMainAppTab.tabId : 'main_app'
    }

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
   * 这是核心分发逻辑，根�?method 调用对应的功�?
   * 统一使用 snake_case 命名风格
   */
  async handleToolCall(request: ToolRequest): Promise<any> {
    const { method, params } = request

    log.info(`🛠️ Handling tool call: ${method}`)

    try {
      switch (method) {
        case 'navigate':
          return await this.navigate(params.url, params.window_id)

        // TODO: 暂时注释截图工具
        // case 'screenshot':
        //   return await this.screenshot({ ...params, windowId: params.window_id })

        case 'execute_js':
          return await this.executeJavaScript(params.code, params.window_id)

        case 'get_page_html':
          return await this.getPageHtml(params.window_id)

        case 'get_page_content':
          return await this.getPageContent(params.window_id)

        case 'get_main_structure':
          return await this.getMainStructure(params.window_id)

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

        case 'set_default_window':
          return {
            success: this.setDefaultWindow(params.window_id),
            windowId: params.window_id,
          }

        default:
          throw new Error(`Unknown method: ${method}`)
      }
    } catch (error: any) {
      log.error(`�?Error handling tool call ${method}:`, error)
      throw error
    }
  }

  /**
   * 检查服务是否就�?
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
      createdAt: tab.createdAt,
      lastActivityAt: tab.lastActiveAt,
      isActive: tab.tabId === this.defaultTabId,
    }))
  }

  /**
   * 设置默认标签�?
   */
  setDefaultWindow(windowId: string): boolean {
    if (!this.tabManager) {
      return false
    }

    const tabs = this.tabManager.getTabList()
    const exists = tabs.some(t => t.tabId === windowId)

    if (exists) {
      this.defaultTabId = windowId
      return true
    }

    return false
  }

  /**
   * 获取当前标签页数�?
   */
  getWindowCount(): number {
    if (!this.tabManager) {
      return 0
    }
    return this.tabManager.getTabList().filter(t => t.tabId !== 'main_app').length
  }
}
