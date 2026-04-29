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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
