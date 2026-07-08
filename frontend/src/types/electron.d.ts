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
  
  // 窗口管理（新 API - 浏览器自动化窗口）
  createBrowserWindow: (url?: string, metadata?: Record<string, any>) => Promise<{ success: boolean; window?: any }>
  activateBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  closeBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  getBrowserWindows: () => Promise<{ success: boolean; windows?: any[] }>
  onBrowserWindowUpdated: (callback: (event: any, data: any) => void) => void
  onBrowserWindowClosed: (callback: (event: any, data: any) => void) => void
  onBrowserWindowCreated: (callback: (event: any, data: any) => void) => void

  // 浏览器窗口后台/前台模式控制
  hideBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  showBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  toggleBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>
  getBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>

  // 托盘悬浮窗统计推送
  updateTrayStats: (stats: { running: number; unread: number }) => void
  
  // Debug 菜单
  showDebugMenu: () => Promise<void>
  
  // 右键菜单
  showTabContextMenu: (params: { tabId: string; isSplitMode: boolean }) => Promise<void>

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
