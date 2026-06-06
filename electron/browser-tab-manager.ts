import { BrowserWindow, WebContents, session, Menu, MenuItem } from 'electron'
import * as path from 'path'
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
    shellWebContents: WebContents
    webviewWebContents?: WebContents
    info: WindowInfo
  }>()
  private maxWindows: number = 6 // 默认最多6个窗口
  private defaultWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    frame: false, // 使用自定义标题栏
    show: false,
    titleBarStyle: 'hidden', // macOS 兼容
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // 启用 <webview> 标签
      preload: path.join(__dirname, 'browser-shell-preload.js'),
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

    const shellWC = newWindow.webContents

    // 默认静音外壳（不需要声音）
    shellWC.setAudioMuted(true)
    log.info(`Window ${windowId} audio muted by default`)

    // 监听 webview 挂载事件
    shellWC.on('did-attach-webview', (_event: Electron.Event, webviewWC: WebContents) => {
      log.info(`Webview attached for window ${windowId}, webContentsId: ${webviewWC.id}`)

      const win = this.windows.get(windowId)
      if (!win) return

      win.webviewWebContents = webviewWC

      // 设置 Edge User Agent
      const edgeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0'
      webviewWC.setUserAgent(edgeUserAgent)
      log.info(`Custom User Agent set to Edge for webview ${windowId}`)

      // 拦截新窗口请求，在当前 webview 打开
      webviewWC.setWindowOpenHandler(({ url }: { url: string }) => {
        log.info(`Intercepting new window request: ${url}, loading in current webview`)
        webviewWC.loadURL(url)
        return { action: 'deny' }
      })

      // 监听页面标题变化
      webviewWC.on('page-title-updated', (_event: Electron.Event, title: string) => {
        const w = this.windows.get(windowId)
        if (w) {
          w.info.title = title
          this.notifyWindowUpdate(windowId)
        }
      })

      // 监听导航完成
      webviewWC.on('did-finish-load', () => {
        const w = this.windows.get(windowId)
        if (w) {
          w.info.url = webviewWC.getURL()
          this.notifyWindowUpdate(windowId)
        }
        // 每次页面加载完成后重新注入反检测脚本
        this.injectAntiDetectionScript(webviewWC)
      })

      // 监听加载失败
      webviewWC.on('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
        log.error(`Window ${windowId} webview failed to load: ${errorCode} - ${errorDescription}`)
      })

      // 注入反检测脚本
      this.injectAntiDetectionScript(webviewWC)

      // 为 webview 设置右键菜单
      this.setupContextMenu(webviewWC, windowId)

      // 初始 URL 由外壳页面在设置好 partition 后加载（确保会话隔离）
    })

    // 设置权限请求处理器
    windowSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowedPermissions = ['notifications', 'clipboard-read', 'clipboard-write', 'media']
      callback(allowedPermissions.includes(permission))
    })

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
      shellWebContents: shellWC, 
      info: windowInfo 
    })

    // 加载外壳页面
    try {
      const shellPath = path.join(__dirname, '..', 'browser-shell.html')
      await shellWC.loadFile(shellPath)
      // 发送初始化消息到外壳（包含 sessionId 用于 webview 隔离）
      shellWC.send('shell:init', { targetUrl: url || 'about:blank', windowId, sessionId })
    } catch (err) {
      log.error(`Failed to load browser shell for window ${windowId}:`, err)
    }

    // 不自动显示窗口，保持后台模式
    // newWindow.show() 已移除

    log.info(`Window created: ${windowId} (total: ${this.windows.size})`)

    // 通知前端新窗口已创建（带动画标记）
    this.notifyWindowCreated(windowId)

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
      // 清理 session 数据（优先使用 webview 的 session）
      const wc = win.webviewWebContents && !win.webviewWebContents.isDestroyed()
        ? win.webviewWebContents
        : win.shellWebContents
      if (!wc.isDestroyed()) {
        try {
          await wc.session.clearStorageData({
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
          await wc.session.clearCache()
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
      .filter(({ shellWebContents }) => !shellWebContents.isDestroyed())
      .map(({ info, webviewWebContents, shellWebContents }) => {
        const wc = webviewWebContents && !webviewWebContents.isDestroyed()
          ? webviewWebContents
          : shellWebContents
        return {
          ...info,
          url: wc.getURL(),
          title: wc.getTitle() || info.title,
        }
      })
  }

  /**
   * 获取指定窗口的 WebContents（优先返回 webview，用于自动化操作）
   */
  getWebContents(windowId: string): WebContents | null {
    const win = this.windows.get(windowId)
    if (!win) return null
    if (win.webviewWebContents && !win.webviewWebContents.isDestroyed()) {
      return win.webviewWebContents
    }
    return win.shellWebContents
  }

  /**
   * 获取指定窗口的外壳 WebContents（用于外壳 IPC）
   */
  getShellWebContents(windowId: string): WebContents | null {
    const win = this.windows.get(windowId)
    return win ? win.shellWebContents : null
  }

  /**
   * 根据 WebContents ID 查找对应的窗口 ID
   * 用于 IPC 处理器中通过 event.sender 反查窗口信息
   */
  getWindowIdByWebContentsId(webContentsId: number): string | null {
    for (const [windowId, win] of this.windows.entries()) {
      if (!win.shellWebContents.isDestroyed() && win.shellWebContents.id === webContentsId) {
        return windowId
      }
      if (win.webviewWebContents && !win.webviewWebContents.isDestroyed() && win.webviewWebContents.id === webContentsId) {
        return windowId
      }
    }
    return null
  }

  /**
   * 获取指定窗口的元数据
   */
  getWindowMetadata(windowId: string): Record<string, any> | undefined {
    const win = this.windows.get(windowId)
    return win ? win.info.metadata : undefined
  }
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
   * 通知前端窗口已创建
   */
  private notifyWindowCreated(windowId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const win = this.windows.get(windowId)
      if (win) {
        this.mainWindow.webContents.send('window-created', {
          windowId,
          title: win.info.title,
          url: win.info.url,
          isActive: win.info.isActive,
          isVisible: win.info.isVisible,
          metadata: win.info.metadata,
          animate: true,
        })
      }
    }
  }

  /**
   * 通知前端窗口更新
   */
  private notifyWindowUpdate(windowId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const win = this.windows.get(windowId)
      if (win) {
        const wc = win.webviewWebContents && !win.webviewWebContents.isDestroyed()
          ? win.webviewWebContents
          : win.shellWebContents
        this.mainWindow.webContents.send('window-updated', {
          windowId,
          title: wc.getTitle() || win.info.title,
          url: wc.getURL() || win.info.url,
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
   * 注入反检测脚本，降低被封控识别的可能性
   */
  private injectAntiDetectionScript(webContents: WebContents): void {
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

    webContents.executeJavaScript(antiDetectionScript, true).catch(err => {
      log.warn('Failed to inject anti-detection script:', err);
    });
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

      // 静音/取消静音
      if (windowInfo) {
        const wc = windowInfo.webviewWebContents || windowInfo.shellWebContents
        const isMuted = wc.isAudioMuted()
        menu.append(
          new MenuItem({
            label: isMuted ? '取消静音' : '静音',
            type: 'checkbox',
            checked: isMuted,
            click: (item) => {
              wc.setAudioMuted(item.checked)
              log.info(`Window ${windowId} audio muted: ${item.checked}`)
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
