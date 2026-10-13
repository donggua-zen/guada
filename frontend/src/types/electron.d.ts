/** 浏览器自动化窗口句柄（IPC 返回的最小字段集） */
export interface BrowserWindowHandle {
  windowId: string
  [key: string]: unknown
}

/** 自动更新状态推送（主进程 → 前端；status 取值对齐 electron-updater 事件名） */
export interface UpdateStatusPayload {
  status: string
  info?: { version?: string; [key: string]: unknown }
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

/** 窗口图标更新事件载荷（主进程 → 前端） */
export interface WindowFaviconPayload {
  windowId: string
  favicon: string
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
    migration: {
      status: 'available' | 'migrated' | 'new_install' | 'skipped' | 'env_override'
      oldPath: string
      newPath: string
    }
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

  // Webview 生命周期事件（主进程 → 前端）
  onCreateWebview?: (callback: (event: unknown, data: WebviewCreatePayload) => void) => void
  onDestroyWebview?: (callback: (event: unknown, data: WebviewDestroyPayload) => void) => void
  onSetWebviewVisibility?: (callback: (event: unknown, data: WebviewVisibilityPayload) => void) => void
  onSetWebviewRenderable?: (callback: (event: unknown, data: WebviewRenderablePayload) => void) => void
  onWindowFaviconUpdated?: (callback: (event: unknown, data: WindowFaviconPayload) => void) => void

  // 清空所有浏览器自动化 session 数据
  clearBrowserData: () => Promise<{ success: boolean; error?: string }>

  // 托盘悬浮窗统计推送
  updateTrayStats: (stats: { running: number; unread: number }) => void

  // 托盘悬浮窗配置（显隐 + 透明度）
  updateTraySettings: (settings: { enabled: boolean; opacity: number }) => void

  // Debug 菜单
  showDebugMenu: () => Promise<void>

  /** 获取 Electron 文件的本地路径（替代 Electron 33+ 已移除的 File.path） */
  getPathForFile: (file: File) => string

  // 右键菜单
  showTabContextMenu: (params: { tabId: string; isSplitMode: boolean }) => Promise<void>
  onTabMenuAction: (callback: (event: unknown, data: TabMenuActionPayload) => void) => void

  // 自动更新相关
  checkForUpdates: () => Promise<{ success: boolean; data?: unknown; error?: string }>
  onUpdateStatus: (callback: (status: UpdateStatusPayload) => void) => void

  // 打开外部链接
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>

  // 数据迁移
  migrateData: () => Promise<{ success: boolean; message: string }>

  // 后端就绪等待：单次 IPC invoke，后端就绪后返回 { port, error }
  waitBackendReady: () => Promise<{ port: number | null; error?: string | null }>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
