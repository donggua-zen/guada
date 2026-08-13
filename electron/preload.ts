import { contextBridge, ipcRenderer, clipboard } from 'electron'

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
  getBackendStatusSync: () => ipcRenderer.sendSync('get-backend-status-sync'),
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
  onUpdateStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('update-status', (_, status) => callback(status))
  },

  // 原生剪贴板操作（无需用户授权）
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => clipboard.writeText(text),
    readHTML: () => clipboard.readHTML(),
    writeHTML: (html: string) => clipboard.writeHTML(html),
    clear: () => clipboard.clear()
  },

  // 显示调试菜单
  showDebugMenu: () => ipcRenderer.invoke('show-debug-menu'),
  
  // 显示标签页右键菜单
  showTabContextMenu: (params: { tabId: string; isSplitMode: boolean }) => 
    ipcRenderer.invoke('show-tab-context-menu', params),
  onTabMenuAction: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('tab-menu-action', callback)
  },

  // 打开目录
  openUserDataFolder: () => ipcRenderer.send('open-user-data-folder'),
  openInstallFolder: () => ipcRenderer.send('open-install-folder'),
  openFolder: (folderPath: string) => ipcRenderer.invoke('open-folder', folderPath),

  // 数据迁移
  migrateData: () => ipcRenderer.invoke('migrate-data'),

  // 在资源管理器中显示并选中文件
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),

  // 用外部编辑器打开文件/目录（如 vscode，后续可扩展）
  openWithEditor: (targetPath: string, editor: string) =>
    ipcRenderer.invoke('open-with-editor', { path: targetPath, editor }),
  
  // 选择文件夹（返回选中的路径）
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // 选择文件（返回选中的路径，用于私钥选择）
  selectFile: () => ipcRenderer.invoke('select-file'),
  
  // 剪贴板操作（通过 IPC，更可靠）
  clipboardIPC: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard-write-text', text),
    readText: () => ipcRenderer.invoke('clipboard-read-text')
  },

  // 打开外部链接（使用系统默认浏览器）
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // 后端就绪等待：单次 IPC invoke，后端就绪后 resolve
  waitBackendReady: () => ipcRenderer.invoke('wait-backend-ready'),

  // 窗口管理（新 API - 浏览器自动化窗口）
  createBrowserWindow: (url?: string, metadata?: Record<string, any>) => 
    ipcRenderer.invoke('browser:create-window', { url, metadata }),
  activateBrowserWindow: (windowId: string) => 
    ipcRenderer.invoke('browser:activate-window', { windowId }),
  closeBrowserWindow: (windowId: string) => 
    ipcRenderer.invoke('browser:close-window', { windowId }),
  getBrowserWindows: () => ipcRenderer.invoke('browser:get-windows'),

  // 浏览器窗口后台/前台模式控制
  hideBrowserWindow: (windowId: string) =>
    ipcRenderer.invoke('browser:hide-window', { windowId }),
  showBrowserWindow: (windowId: string) =>
    ipcRenderer.invoke('browser:show-window', { windowId }),
  toggleBrowserWindowVisibility: (windowId: string) =>
    ipcRenderer.invoke('browser:toggle-window-visibility', { windowId }),
  getBrowserWindowVisibility: (windowId: string) =>
    ipcRenderer.invoke('browser:get-window-visibility', { windowId }),

  // Webview 生命周期事件（主进程 → 前端）
  onCreateWebview: (callback: (event: any, data: { windowId: string; partition: string; url: string; preloadUrl: string; metadata?: any }) => void) => {
    ipcRenderer.on('browser:create-webview', callback)
  },
  onDestroyWebview: (callback: (event: any, data: { windowId: string }) => void) => {
    ipcRenderer.on('browser:destroy-webview', callback)
  },
  onSetWebviewVisibility: (callback: (event: any, data: { windowId: string; visible: boolean }) => void) => {
    ipcRenderer.on('browser:set-webview-visibility', callback)
  },
  onSetWebviewRenderable: (callback: (event: any, data: { windowId: string; renderable: boolean }) => void) => {
    ipcRenderer.on('browser:set-webview-renderable', callback)
  },
  onWindowFaviconUpdated: (callback: (event: any, data: { windowId: string; favicon: string }) => void) => {
    ipcRenderer.on('window-favicon-updated', callback)
  },

  // 清空所有浏览器自动化 session 数据（cookie、缓存、localStorage 等，不影响主程序）
  clearBrowserData: () =>
    ipcRenderer.invoke('browser:clear-all-data'),

  // 托盘悬浮窗：推送聚合统计数据（fire-and-forget）
  updateTrayStats: (stats: { running: number; unread: number }) =>
    ipcRenderer.send('tray:update-stats', stats),

  // 托盘悬浮窗：推送配置（显隐 + 透明度）
  updateTraySettings: (settings: { enabled: boolean; opacity: number }) =>
    ipcRenderer.send('tray:update-settings', settings),

})
