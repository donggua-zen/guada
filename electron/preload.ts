import { contextBridge, ipcRenderer } from 'electron'

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  
  // IPC 通信方法
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  showNotification: (title: string, body: string) => 
    ipcRenderer.invoke('show-notification', { title, body }),
  
  // 窗口控制（用于无边框窗口拖拽）
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('is-window-maximized'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),

  // 自动更新相关
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  startDownloadUpdate: () => ipcRenderer.invoke('start-download-update'),
  installAndRestart: () => ipcRenderer.send('install-and-restart'),
  onUpdateStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('update-status', (_, status) => callback(status))
  }
})
