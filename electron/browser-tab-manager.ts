import { BrowserWindow, WebContents, WebContentsView, session, webContents } from 'electron'
import log from 'electron-log/main'

/**
 * 标签页信息
 */
export interface TabInfo {
  tabId: string
  title: string
  url: string
  favicon?: string
  createdAt: number
  lastActiveAt: number
  isActive: boolean
  isMainApp: boolean // 是否为主应用标签（不可关闭）
}

/**
 * 标签页管理器（基于 WebContentsView）
 * 
 * 使用 Electron 推荐的 WebContentsView API
 * 每个标签页有独立的 WebContents 和 Session
 * 
 * 注意：第一个标签是主应用，不可关闭
 */
export class BrowserTabManager {
  private mainWindow: BrowserWindow | null = null
  private tabs = new Map<string, {
    view: WebContentsView
    webContents: WebContents
    info: TabInfo
  }>()
  private activeTabId: string | null = null
  private maxTabs: number = 6 // 默认最多6个标签（含主应用）
  private tabBarHeight: number = 40 // 标签栏高度

  constructor(mainWindow: BrowserWindow, maxTabs: number = 6) {
    this.mainWindow = mainWindow
    this.maxTabs = maxTabs
  }

  /**
   * 初始化主应用标签（第一个标签，不可关闭）
   */
  async initializeMainApp(): Promise<TabInfo> {
    if (!this.mainWindow) {
      throw new Error('Main window not initialized')
    }

    const tabId = 'main_app'
    
    log.info(`Initializing main app tab: ${tabId}`)

    // 主应用使用 mainWindow 的 webContents
    const webContents = this.mainWindow.webContents

    // 注意：不能为 mainWindow.webContents 创建 WebContentsView，因为它已经附加到窗口上了
    // 我们创建一个空的占位符（不会被使用）
    const placeholderView = null as any

    // 监听页面标题变化
    webContents.on('page-title-updated', (_, title) => {
      const tab = this.tabs.get(tabId)
      if (tab) {
        tab.info.title = title
        this.notifyTabUpdate(tabId)
      }
    })

    const now = Date.now()
    const tabInfo: TabInfo = {
      tabId,
      title: '主应用',
      url: '',
      createdAt: now,
      lastActiveAt: now,
      isActive: true,
      isMainApp: true, // 标记为主应用
    }

    // 存储引用（view 字段为 null，表示这是主应用）
    this.tabs.set(tabId, { view: placeholderView, webContents, info: tabInfo })
    this.activeTabId = tabId

    log.info(`Main app tab added to tabs Map. Total tabs: ${this.tabs.size}`)
    log.info(`Main app tab initialized (using mainWindow.webContents directly)`)
    return tabInfo
  }

  /**
   * 创建新标签页
   * @param url - 初始 URL
   * @param autoActivate - 是否自动激活（默认 true，Agent 调用时传 false）
   */
  async createTab(url?: string, autoActivate: boolean = true): Promise<TabInfo> {
    if (!this.mainWindow) {
      throw new Error('Main window not initialized')
    }

    // 检查标签数限制
    if (this.tabs.size >= this.maxTabs) {
      throw new Error(`标签数量已达上限（最多 ${this.maxTabs} 个，包含主应用）`)
    }

    const tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    log.info(`Creating new tab with WebContentsView: ${tabId}`)

    // 创建独立的 session
    const sessionId = `persist:tab_${tabId}`
    const tabSession = session.fromPartition(sessionId, { cache: true })

    // 创建 WebContentsView（会自动创建内部的 WebContents）
    const view = new WebContentsView({
      webPreferences: {
        session: tabSession,
      },
    })

    const wc = view.webContents

    // 设置自定义 User Agent，伪装成 Microsoft Edge 浏览器
    const edgeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0'
    wc.setUserAgent(edgeUserAgent)
    log.info(`Custom User Agent set to Edge: ${edgeUserAgent}`)

    // 配置 WebContents - 拦截新窗口请求，在当前标签打开
    wc.setWindowOpenHandler(({ url }: { url: string }) => {
      log.info(`Intercepting new window request: ${url}, loading in current tab`)
      // 强制在当前标签加载 URL，禁止创建新窗口
      wc.loadURL(url)
      return { action: 'deny' }
    })

    // 设置位置和大小
    this.updateViewBounds(view)

    // 监听页面标题变化
    wc.on('page-title-updated', (_event: Electron.Event, title: string) => {
      const tab = this.tabs.get(tabId)
      if (tab) {
        tab.info.title = title
        this.notifyTabUpdate(tabId)
      }
    })

    // 监听导航完成
    wc.on('did-finish-load', () => {
      const tab = this.tabs.get(tabId)
      if (tab) {
        tab.info.url = wc.getURL()
        this.notifyTabUpdate(tabId)
      }
    })

    // 监听页面加载失败
    wc.on('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
      log.error(`Tab ${tabId} failed to load: ${errorCode} - ${errorDescription}`)
    })

    const now = Date.now()
    const tabInfo: TabInfo = {
      tabId,
      title: url || 'New Tab',
      url: url || 'about:blank',
      createdAt: now,
      lastActiveAt: now,
      isActive: false,
      isMainApp: false,
    }

    // 存储引用
    this.tabs.set(tabId, { view, webContents: wc, info: tabInfo })

    // 异步加载 URL（不阻塞返回）
    if (url && url !== 'about:blank') {
      wc.loadURL(url).catch(err => {
        log.error(`Failed to load URL in tab ${tabId}:`, err)
      })
    }

    // 根据参数决定是否激活新创建的标签
    if (autoActivate) {
      this.activateTab(tabId)
    } else {
      log.info(`Created tab without activation: ${tabId}`)
    }

    log.info(`Tab created: ${tabId} (total: ${this.tabs.size})`)
    return tabInfo
  }

  /**
   * 激活指定标签页
   */
  activateTab(tabId: string): boolean {
    if (!this.mainWindow) {
      log.error(`Cannot activate tab: no main window`)
      return false
    }

    if (!this.tabs.has(tabId)) {
      log.error(`Cannot activate tab: ${tabId} (not found in tabs Map)`)
      log.error(`   Available tabs: ${Array.from(this.tabs.keys()).join(', ')}`)
      return false
    }

    // 如果已经是当前活跃标签，不需要切换
    if (this.activeTabId === tabId) {
      log.debug(`Tab ${tabId} is already active`)
      return true
    }

    log.info(`Switching to tab: ${tabId}`)

    // 隐藏当前活跃的 View（如果不是主应用）
    if (this.activeTabId && this.activeTabId !== 'main_app') {
      const currentTab = this.tabs.get(this.activeTabId)
      if (currentTab && currentTab.view) {
        this.mainWindow.contentView.removeChildView(currentTab.view)
        currentTab.info.isActive = false
        log.debug(`Removed view for tab: ${this.activeTabId}`)
      }
    }

    // 显示新的 View
    const newTab = this.tabs.get(tabId)!
    
    // 如果是切换到主应用标签，只需移除其他 view，主应用会自动显示
    if (tabId === 'main_app') {
      // 主应用是 mainWindow 的内容，不需要 addChildView
      // 只需确保没有其他 view 覆盖它
      log.debug('Switched to main app tab (mainWindow.webContents)')
    } else {
      // 其他标签页，添加 view 覆盖在主应用上
      if (newTab.view) {
        this.mainWindow.contentView.addChildView(newTab.view)
        newTab.webContents.focus()
        log.debug(`Added view for tab: ${tabId}`)
      }
    }
    
    newTab.info.isActive = true
    newTab.info.lastActiveAt = Date.now()
    this.activeTabId = tabId

    // 通知前端更新
    this.notifyTabUpdate(tabId)

    log.info(`Activated tab: ${tabId}`)
    return true
  }

  /**
   * 关闭标签页（主应用标签不可关闭）
   */
  async closeTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return false
    }

    // 主应用标签不可关闭
    if (tab.info.isMainApp) {
      log.warn(`⚠️ Cannot close main app tab: ${tabId}`)
      return false
    }

    log.info(`🗑️ Closing tab: ${tabId}`)

    try {
      // 从窗口移除（如果有 view）
      if (this.mainWindow && tab.view) {
        this.mainWindow.contentView.removeChildView(tab.view)
      }

      // 清理 session 数据
      await tab.webContents.session.clearStorageData({
        storages: [
          'cookies',
          'filesystem',
          'indexdb',
          'localstorage',
          'shadercache',
          'websql',
          'serviceworkers',
          'cachestorage',
        ],
      })
      await tab.webContents.session.clearCache()

      // 销毁 WebContents（重要：释放资源）
      ;(tab.webContents as any).destroy()

      // 从映射中移除
      this.tabs.delete(tabId)

      // 通知前端标签已关闭
      this.notifyTabClosed(tabId)

      // 如果关闭的是活跃标签，切换到主应用标签
      if (this.activeTabId === tabId) {
        const mainAppTab = Array.from(this.tabs.values()).find(t => t.info.isMainApp)
        if (mainAppTab) {
          this.activateTab(mainAppTab.info.tabId)
        } else {
          this.activeTabId = null
        }
      }

      log.info(`Tab closed: ${tabId} (remaining: ${this.tabs.size})`)
      return true
    } catch (error) {
      log.error(`Error closing tab ${tabId}:`, error)
      return false
    }
  }

  /**
   * 在指定标签页执行操作
   */
  async executeInTab(tabId: string, operation: (webContents: WebContents) => Promise<any>): Promise<any> {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${tabId}`)
    }

    // 先激活该标签
    this.activateTab(tabId)

    return await operation(tab.webContents)
  }

  /**
   * 获取所有标签列表
   */
  getTabList(): TabInfo[] {
    return Array.from(this.tabs.values()).map(({ info, webContents }) => ({
      ...info,
      url: webContents.getURL(),
      title: webContents.getTitle() || info.title,
    }))
  }

  /**
   * 获取活跃标签
   */
  getActiveTab(): TabInfo | null {
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) {
      return null
    }
    const { info, webContents } = this.tabs.get(this.activeTabId)!
    return {
      ...info,
      url: webContents.getURL(),
      title: webContents.getTitle() || info.title,
    }
  }

  /**
   * 获取标签数量
   */
  getTabCount(): number {
    return this.tabs.size
  }

  /**
   * 关闭所有标签（除了主应用）
   */
  async closeAllTabs(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys()).filter(id => {
      const tab = this.tabs.get(id)
      return tab && !tab.info.isMainApp
    })
    
    for (const tabId of tabIds) {
      await this.closeTab(tabId)
    }
  }

  /**
   * 处理窗口大小变化
   */
  handleResize(): void {
    if (!this.mainWindow) return

    this.tabs.forEach(({ view }) => {
      if (view) {
        this.updateViewBounds(view)
      }
    })
  }

  /**
   * 更新 View 的边界
   */
  private updateViewBounds(view: WebContentsView): void {
    if (!this.mainWindow) return

    const bounds = this.mainWindow.getContentBounds()
    view.setBounds({
      x: 0,
      y: this.tabBarHeight,
      width: bounds.width,
      height: bounds.height - this.tabBarHeight,
    })
  }

  /**
   * 通知前端标签更新
   */
  private notifyTabUpdate(tabId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const tab = this.tabs.get(tabId)
      if (tab) {
        this.mainWindow.webContents.send('tab-updated', {
          tabId,
          title: tab.webContents.getTitle() || tab.info.title,
          url: tab.webContents.getURL() || tab.info.url,
          isActive: tab.info.isActive,
          isMainApp: tab.info.isMainApp,
        })
      }
    }
  }

  /**
   * 通知前端标签已关闭
   */
  private notifyTabClosed(tabId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('tab-closed', {
        tabId,
      })
    }
  }

  /**
   * 获取指定标签的 WebContents
   */
  getWebContents(tabId: string): WebContents | null {
    const tab = this.tabs.get(tabId)
    return tab ? tab.webContents : null
  }

  /**
   * 检查是否为主应用标签
   */
  isMainAppTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    return tab ? tab.info.isMainApp : false
  }
}
