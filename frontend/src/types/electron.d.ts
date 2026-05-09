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
  }>
  showNotification: (title: string, body: string) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  toggleDevTools: () => void
  openUserDataFolder: () => void
  openInstallFolder: () => void
  
  // 标签管理
  createTab: (url?: string) => Promise<{ success: boolean; tab?: any }>
  activateTab: (tabId: string) => Promise<{ success: boolean }>
  closeTab: (tabId: string) => Promise<{ success: boolean }>
  getTabs: () => Promise<{ success: boolean; tabs?: any[] }>
  onTabUpdated: (callback: (event: any, data: any) => void) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
