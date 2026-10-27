/** 浏览器自动化窗口句柄（IPC 返回的最小字段集） */
export interface BrowserWindowHandle {
  windowId: string
  [key: string]: unknown
}

/** 更新包下载信息（由官网 check_update 下发） */
export interface UpdateDownloadAsset {
  url: string
  fileName?: string
  sha512?: string
  size?: number
  /** 差量下载所需的 blockmap 直链（可选，客户端会按 URL 规则推导）。 */
  blockmapUrl?: string
}

/** 官网 check_update 返回的更新信息 */
export interface UpdateInfo {
  version?: string
  clientVersion?: string
  description?: string
  publishDate?: string
  mandatory?: boolean
  downloadUrl?: string
  releaseNotes?: string
  downloads?: {
    win?: UpdateDownloadAsset
  }
  [key: string]: unknown
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

/** 自动更新状态推送（主进程 → 前端） */
export interface UpdateStatusPayload {
  status: UpdateStatus | string
  info?: UpdateInfo
  progress?: UpdateProgress
  version?: string
  filePath?: string
  phase?: 'check' | 'download' | 'install'
  error?: string
  [key: string]: unknown
}

/** 标签页右键菜单动作（主进程 → 前端） */
export interface TabMenuActionPayload {
  action: string
  tabId?: string
  [key: string]: unknown
}

/** Webview 创建事件载荷（主进程 → 前端） */
export interface WebviewCreatePayload {
  windowId: string
  partition: string
  url: string
  preloadUrl: string
  metadata?: Record<string, unknown>
}

/** Webview 销毁事件载荷（主进程 → 前端） */
export interface WebviewDestroyPayload {
  windowId: string
}

/** Webview 显隐切换事件载荷（主进程 → 前端） */
export interface WebviewVisibilityPayload {
  windowId: string
  visible: boolean
}

/** Webview 可渲染切换事件载荷（主进程 → 前端） */
export interface WebviewRenderablePayload {
  windowId: string
  renderable: boolean
}

/** Webview 渲染视口变更事件载荷（主进程 → 前端） */
export interface WebviewViewportPayload {
  windowId: string
  width: number
  height: number
}

/** 窗口图标更新事件载荷（主进程 → 前端） */
export interface WindowFaviconPayload {
  windowId: string
  favicon: string
}

/** Webview 指针锁 / 全屏状态（主进程 → 前端） */
export interface BrowserPointerLockPayload {
  windowId: string
  locked: boolean
  fullscreen?: boolean
}

export interface ElectronAPI {
  platform: string
  versions: {
    node: string
    chrome: string
    electron: string
  }
  getAppInfo: () => Promise<{
    platform: string
    version: string
    userDataPath: string
    backendPort: number | null
  }>
  getBackendPort: () => Promise<number | null>
  /** 同步查询后端就绪状态（阻塞，用于 Vue 挂载前确定初始值）；port 为后端实际监听端口（未就绪时为 null） */
  getBackendStatusSync: () => { ready: boolean; port: number | null }
  showNotification: (title: string, body: string) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  isFullScreen: () => Promise<boolean>
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => void
  setWindowControlsColor: (colors: { symbolColor: string }) => void
  toggleDevTools: () => void
  openUserDataFolder: () => void
  openInstallFolder: () => void
  openFolder: (folderPath: string) => Promise<{ success: boolean }>
  showItemInFolder: (filePath: string) => Promise<{ success: boolean }>
  openWithEditor: (targetPath: string, editor: string) => Promise<{ success: boolean; error?: string }>
  selectFolder: () => Promise<string | null>
  selectFile: () => Promise<string | null>

  // 原生剪贴板操作（同步，无需用户授权）
  clipboard: {
    readText: () => string
    writeText: (text: string) => void
    readHTML: () => string
    writeHTML: (html: string) => void
    clear: () => void
  }

  // 剪贴板操作（通过 IPC，更可靠）
  clipboardIPC: {
    writeText: (text: string) => Promise<{ success: boolean; error?: string }>
    readText: () => Promise<{ success: boolean; text?: string; error?: string }>
  }

  // 窗口管理（新 API - 浏览器自动化窗口）
  createBrowserWindow: (url?: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; window?: BrowserWindowHandle; error?: string }>
  activateBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  closeBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  getBrowserWindows: () => Promise<{ success: boolean; windows?: BrowserWindowHandle[] }>

  // 浏览器窗口后台/前台模式控制
  hideBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  showBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  toggleBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>
  getBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>

  // 强制释放 webview 内被页面锁定的鼠标/键盘（Pointer Lock / Fullscreen）
  releaseBrowserInput: (
    windowId: string,
    options?: { focusHost?: boolean },
  ) => Promise<{ success: boolean; error?: string }>

  // Webview 指针锁 / 全屏状态变化（主进程 → 前端）
  onBrowserPointerLockChanged?: (
    callback: (event: unknown, data: BrowserPointerLockPayload) => void,
  ) => void

  // Webview 生命周期事件（主进程 → 前端）
  onCreateWebview?: (callback: (event: unknown, data: WebviewCreatePayload) => void) => void
  onDestroyWebview?: (callback: (event: unknown, data: WebviewDestroyPayload) => void) => void
  onSetWebviewVisibility?: (callback: (event: unknown, data: WebviewVisibilityPayload) => void) => void
  onSetWebviewRenderable?: (callback: (event: unknown, data: WebviewRenderablePayload) => void) => void
  onSetWebviewViewport?: (callback: (event: unknown, data: WebviewViewportPayload) => void) => void
  onWindowFaviconUpdated?: (callback: (event: unknown, data: WindowFaviconPayload) => void) => void

  // 清空所有浏览器自动化 session 数据
  clearBrowserData: () => Promise<{ success: boolean; error?: string }>

  // 桌面 Computer Use 状态与测试
  getComputerUseStatus: () => Promise<{
    available: boolean
    binaryPath?: string
    version?: string
    protocol?: string
    capabilities?: Record<string, unknown>
    error?: string
  }>
  testComputerUse: () => Promise<{
    ok: boolean
    screenshotPath?: string
    width?: number
    height?: number
    treeCount?: number
    version?: string
    error?: string
  }>

  // 托盘悬浮窗统计推送
  updateTrayStats: (stats: { running: number; unread: number }) => void

  // 托盘悬浮窗配置（显隐 + 透明度）
  updateTraySettings: (settings: { enabled: boolean; opacity: number }) => void

  // 防休眠模式（桌面端生效；落盘由后端负责，这里只驱动主进程的 powerSaveBlocker）
  updateKeepAwakeMode: (mode: 'off' | 'busy' | 'always') => void

  // Debug 菜单
  showDebugMenu: () => Promise<void>

  /** 获取 Electron 文件的本地路径（替代 Electron 33+ 已移除的 File.path） */
  getPathForFile: (file: File) => string

  // 右键菜单
  showTabContextMenu: (params: { tabId: string; isSplitMode: boolean }) => Promise<void>
  onTabMenuAction: (callback: (event: unknown, data: TabMenuActionPayload) => void) => void

  // 自动更新相关
  checkForUpdates: () => Promise<{ success: boolean; data?: unknown; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  cancelUpdateDownload: () => Promise<{ success: boolean }>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  getUpdateState: () => Promise<UpdateStatusPayload>
  onUpdateStatus: (callback: (status: UpdateStatusPayload) => void) => void

  // 打开外部链接
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>

  // 后端就绪等待：单次 IPC invoke，后端就绪后返回 { port, error }
  waitBackendReady: () => Promise<{ port: number | null; error?: string | null }>

  // 重启应用（移动访问的监听地址变更需要重启进程才生效）
  relaunchApp: () => Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
