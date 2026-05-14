import { BrowserWindow, WebContents, session, Menu, MenuItem } from 'electron'
import log from 'electron-log/main'

/**
 * 窗口信息接口
 */
export interface WindowInfo {
  windowId: string
  title: string
  url: string
  favicon?: string
  createdAt: number
  lastActiveAt: number
  isActive: boolean
  isMainApp: boolean
  isVisible: boolean // 窗口是否可见（前台/后台模式）
  metadata?: Record<string, any> // 元数据支持（用于 session 隔离和作用域标识）
}

/**
 * 浏览器窗口管理器（基于独立 BrowserWindow）
 * 
 * 每个自动化窗口都是独立的 BrowserWindow，与主窗口完全隔离
 * 支持元数据传递、Session 隔离、悬浮窗格等功能
 */
export class BrowserWindowManager {
  private mainWindow: BrowserWindow | null = null
  private windows = new Map<string, {
    window: BrowserWindow
    webContents: WebContents
    info: WindowInfo
  }>()
  private maxWindows: number = 6 // 默认最多6个窗口
  private defaultWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    frame: true, // 保留系统标题栏
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }

  constructor(mainWindow: BrowserWindow, maxWindows: number = 6) {
    this.mainWindow = mainWindow
    this.maxWindows = maxWindows
  }

  /**
   * 创建新的独立窗口
   * @param url - 初始 URL
   * @param metadata - 元数据（可选，用于 session 隔离和作用域标识）
   */
  async createWindow(
    url?: string, 
    metadata?: Record<string, any>
  ): Promise<WindowInfo> {
    if (!this.mainWindow) {
      throw new Error('Main window not initialized')
    }

    // 检查窗口数限制
    if (this.windows.size >= this.maxWindows) {
      throw new Error(`窗口数量已达上限（最多 ${this.maxWindows} 个）`)
    }

    const windowId = `win_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    log.info(`Creating new independent window: ${windowId}`)

    // 创建独立的 session（基于 metadata.scope 或默认）
    const scope = metadata?.scope || 'default'
    const sessionId = `persist:window_${scope}_${windowId}`
    const windowSession = session.fromPartition(sessionId, { cache: true })

    // 合并窗口选项
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      ...this.defaultWindowOptions,
      webPreferences: {
        ...this.defaultWindowOptions.webPreferences,
        session: windowSession,
      },
    }

    // 创建独立窗口
    const newWindow = new BrowserWindow(windowOptions)

    const wc = newWindow.webContents

    // 设置 Edge User Agent
    const edgeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0'
    wc.setUserAgent(edgeUserAgent)
    log.info(`Custom User Agent set to Edge for window ${windowId}`)

    // 拦截新窗口请求，在当前窗口打开
    wc.setWindowOpenHandler(({ url }: { url: string }) => {
      log.info(`Intercepting new window request: ${url}, loading in current window`)
      wc.loadURL(url)
      return { action: 'deny' }
    })

    // 监听页面标题变化
    wc.on('page-title-updated', (_event: Electron.Event, title: string) => {
      const win = this.windows.get(windowId)
      if (win) {
        win.info.title = title
        this.notifyWindowUpdate(windowId)
      }
    })

    // 监听导航完成
    wc.on('did-finish-load', () => {
      const win = this.windows.get(windowId)
      if (win) {
        win.info.url = wc.getURL()
        this.notifyWindowUpdate(windowId)
      }
    })

    // 监听加载失败
    wc.on('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
      log.error(`Window ${windowId} failed to load: ${errorCode} - ${errorDescription}`)
    })

    // 为窗口设置右键菜单
    this.setupContextMenu(wc, windowId)

    // 窗口关闭时自动清理
    newWindow.on('closed', () => {
      log.info(`Window closed: ${windowId}`)
      this.windows.delete(windowId)
      this.notifyWindowClosed(windowId)
    })

    const now = Date.now()
    const windowInfo: WindowInfo = {
      windowId,
      title: url || 'New Window',
      url: url || 'about:blank',
      createdAt: now,
      lastActiveAt: now,
      isActive: false,
      isMainApp: false,
      isVisible: false, // 默认隐藏（后台模式）
      metadata, // 保存元数据
    }

    this.windows.set(windowId, { 
      window: newWindow, 
      webContents: wc, 
      info: windowInfo 
    })

    // 异步加载 URL
    if (url && url !== 'about:blank') {
      wc.loadURL(url).catch(err => {
        log.error(`Failed to load URL in window ${windowId}:`, err)
      })
    }

    // 不自动显示窗口，保持后台模式
    // newWindow.show() 已移除

    log.info(`Window created: ${windowId} (total: ${this.windows.size})`)
    return windowInfo
  }



  /**
   * 关闭窗口
   */
  async closeWindow(windowId: string): Promise<boolean> {
    const win = this.windows.get(windowId)
    if (!win) {
      return false
    }

    log.info(`🗑️ Closing window: ${windowId}`)

    try {
      // 清理 session 数据
      if (!win.webContents.isDestroyed()) {
        try {
          await win.webContents.session.clearStorageData({
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
          await win.webContents.session.clearCache()
        } catch (error) {
          log.warn(`Failed to clear session data for window ${windowId}:`, error)
        }
      }

      // 关闭窗口（会触发 closed 事件）
      if (!win.window.isDestroyed()) {
        win.window.close()
      }

      return true
    } catch (error) {
      log.error(`Error closing window ${windowId}:`, error)
      return false
    }
  }

  /**
   * 获取所有窗口列表
   */
  getWindowList(): WindowInfo[] {
    return Array.from(this.windows.values())
      .filter(({ webContents }) => !webContents.isDestroyed())
      .map(({ info, webContents }) => ({
        ...info,
        url: webContents.getURL(),
        title: webContents.getTitle() || info.title,
      }))
  }

  /**
   * 获取指定窗口的 WebContents
   */
  getWebContents(windowId: string): WebContents | null {
    const win = this.windows.get(windowId)
    return win ? win.webContents : null
  }

  /**
   * 关闭所有窗口
   */
  async closeAllWindows(): Promise<void> {
    const windowIds = Array.from(this.windows.keys())
    
    for (const windowId of windowIds) {
      await this.closeWindow(windowId)
    }
  }

  /**
   * 设置窗口为置顶悬浮模式（可选功能）
   */
  setAlwaysOnTop(windowId: string, alwaysOnTop: boolean): void {
    const win = this.windows.get(windowId)
    if (win && !win.window.isDestroyed()) {
      win.window.setAlwaysOnTop(alwaysOnTop, 'floating')
      win.window.setSkipTaskbar(alwaysOnTop)
      log.info(`Window ${windowId} alwaysOnTop set to: ${alwaysOnTop}`)
    }
  }

  /**
   * 隐藏窗口（后台模式）
   */
  hideWindow(windowId: string): void {
    const win = this.windows.get(windowId)
    if (win && !win.window.isDestroyed()) {
      win.window.hide()
      win.info.isVisible = false
      this.notifyWindowUpdate(windowId)
      log.info(`Window ${windowId} hidden (background mode)`)
    }
  }

  /**
   * 显示窗口（前台模式）
   */
  showWindow(windowId: string): void {
    const win = this.windows.get(windowId)
    if (win && !win.window.isDestroyed()) {
      if (win.window.isMinimized()) {
        win.window.restore()
      }
      win.window.show()
      win.window.focus()
      win.info.isVisible = true
      this.notifyWindowUpdate(windowId)
      log.info(`Window ${windowId} shown (foreground mode)`)
    }
  }

  /**
   * 切换窗口显示状态
   */
  toggleWindowVisibility(windowId: string): boolean {
    const win = this.windows.get(windowId)
    if (win && !win.window.isDestroyed()) {
      if (win.info.isVisible) {
        this.hideWindow(windowId)
        return false
      } else {
        this.showWindow(windowId)
        return true
      }
    }
    return false
  }

  /**
   * 获取窗口可见性状态
   */
  isWindowVisible(windowId: string): boolean {
    const win = this.windows.get(windowId)
    if (win && !win.window.isDestroyed()) {
      return win.window.isVisible()
    }
    return false
  }

  /**
   * 通知前端窗口更新
   */
  private notifyWindowUpdate(windowId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const win = this.windows.get(windowId)
      if (win) {
        this.mainWindow.webContents.send('window-updated', {
          windowId,
          title: win.webContents.getTitle() || win.info.title,
          url: win.webContents.getURL() || win.info.url,
          isActive: win.info.isActive,
          isVisible: win.window.isVisible(), // 使用实际窗口状态
          metadata: win.info.metadata,
        })
      }
    }
  }

  /**
   * 通知前端窗口已关闭
   */
  private notifyWindowClosed(windowId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('window-closed', {
        windowId,
      })
    }
  }

  /**
   * 为窗口设置右键菜单
   */
  private setupContextMenu(webContents: WebContents, windowId: string): void {
    webContents.on('context-menu', (_event, params) => {
      // 创建右键菜单
      const menu = new Menu()

      // 后退
      menu.append(
        new MenuItem({
          label: '后退',
          enabled: webContents.canGoBack(),
          click: () => {
            if (webContents.canGoBack()) {
              webContents.goBack()
            }
          },
        })
      )

      // 前进
      menu.append(
        new MenuItem({
          label: '前进',
          enabled: webContents.canGoForward(),
          click: () => {
            if (webContents.canGoForward()) {
              webContents.goForward()
            }
          },
        })
      )

      // 刷新
      menu.append(
        new MenuItem({
          label: '刷新',
          click: () => {
            webContents.reload()
          },
        })
      )

      menu.append(new MenuItem({ type: 'separator' }))

      // 打开开发者工具
      menu.append(
        new MenuItem({
          label: '打开开发者工具',
          click: () => {
            webContents.openDevTools({ mode: 'right' })
          },
        })
      )

      menu.append(new MenuItem({ type: 'separator' }))

      // 设为悬浮窗口
      const windowInfo = this.windows.get(windowId)
      const isAlwaysOnTop = windowInfo ? windowInfo.window.isAlwaysOnTop() : false
      menu.append(
        new MenuItem({
          label: isAlwaysOnTop ? '取消悬浮' : '设为悬浮窗口',
          type: 'checkbox',
          checked: isAlwaysOnTop,
          click: (item) => {
            this.setAlwaysOnTop(windowId, item.checked)
          },
        })
      )

      // 隐藏/显示窗口（后台/前台模式）
      if (windowInfo) {
        const isVisible = windowInfo.window.isVisible()
        menu.append(
          new MenuItem({
            label: isVisible ? '隐藏窗口（后台模式）' : '显示窗口（前台模式）',
            click: () => {
              if (isVisible) {
                this.hideWindow(windowId)
              } else {
                this.showWindow(windowId)
              }
            },
          })
        )
      }

      // 显示菜单
      menu.popup({ window: this.windows.get(windowId)?.window })
    })
  }
}

// 保持向后兼容的导出
export { BrowserWindowManager as BrowserTabManager }
export type { WindowInfo as TabInfo }
