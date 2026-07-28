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
  /** 同步查询后端就绪状态（阻塞，用于 Vue 挂载前确定初始值） */
  getBackendStatusSync: () => { ready: boolean }
  showNotification: (title: string, body: string) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  toggleDevTools: () => void
  openUserDataFolder: () => void
  openInstallFolder: () => void
  openFolder: (folderPath: string) => Promise<{ success: boolean }>
  showItemInFolder: (filePath: string) => Promise<{ success: boolean }>
  openWithEditor: (targetPath: string, editor: string) => Promise<{ success: boolean; error?: string }>
  selectFolder: () => Promise<string | null>

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
  createBrowserWindow: (url?: string, metadata?: Record<string, any>) => Promise<{ success: boolean; window?: any; error?: string }>
  activateBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  closeBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  getBrowserWindows: () => Promise<{ success: boolean; windows?: any[] }>

  // 浏览器窗口后台/前台模式控制
  hideBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  showBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  toggleBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>
  getBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>

  // Webview 生命周期事件（主进程 → 前端）
  onCreateWebview?: (callback: (event: any, data: { windowId: string; partition: string; url: string; preloadUrl: string; metadata?: any }) => void) => void
  onDestroyWebview?: (callback: (event: any, data: { windowId: string }) => void) => void
  onSetWebviewVisibility?: (callback: (event: any, data: { windowId: string; visible: boolean }) => void) => void
  onSetWebviewRenderable?: (callback: (event: any, data: { windowId: string; renderable: boolean }) => void) => void
  onWindowFaviconUpdated?: (callback: (event: any, data: { windowId: string; favicon: string }) => void) => void

  // 清空所有浏览器自动化 session 数据
  clearBrowserData: () => Promise<{ success: boolean; error?: string }>

  // 托盘悬浮窗统计推送
  updateTrayStats: (stats: { running: number; unread: number }) => void

  // 托盘悬浮窗配置（显隐 + 透明度）
  updateTraySettings: (settings: { enabled: boolean; opacity: number }) => void

  // Debug 菜单
  showDebugMenu: () => Promise<void>

  // 右键菜单
  showTabContextMenu: (params: { tabId: string; isSplitMode: boolean }) => Promise<void>
  onTabMenuAction: (callback: (event: any, data: any) => void) => void

  // 自动更新相关
  checkForUpdates: () => Promise<{ success: boolean; data?: any; error?: string }>
  onUpdateStatus: (callback: (status: any) => void) => void

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
