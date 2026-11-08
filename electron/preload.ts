import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'

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
  showNotification: (payload: { title: string; body?: string; sessionId?: string | null }) =>
    ipcRenderer.invoke('show-notification', payload),
  /** 点击系统通知：主进程回传本次运行的 sessionId，返回取消订阅函数 */
  onNotificationClick: (callback: (payload: { sessionId?: string | null }) => void) => {
    const listener = (_event: unknown, payload: { sessionId?: string | null }) => callback(payload)
    ipcRenderer.on('notification-clicked', listener)
    return () => ipcRenderer.removeListener('notification-clicked', listener)
  },
  
  // 窗口控制（用于无边框窗口拖拽）
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('is-window-maximized'),
  // 全屏状态：macOS 原生全屏会隐藏红绿灯，标题栏需据此取消为其预留的左侧留白
  isFullScreen: () => ipcRenderer.invoke('is-window-fullscreen'),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    ipcRenderer.on('window-fullscreen-changed', (_, isFullscreen) => callback(isFullscreen))
  },
  setWindowControlsColor: (colors: { symbolColor: string }) =>
    ipcRenderer.send('titlebar-overlay-color', colors),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),

  // 自动更新相关
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdateDownload: () => ipcRenderer.invoke('update:cancel-download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
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
  
  // 获取 Electron 文件的本地路径（替代 Electron 33+ 已移除的 File.path）
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

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

  // 强制释放 webview 内被页面锁定的鼠标/键盘（Pointer Lock / Fullscreen）
  releaseBrowserInput: (windowId: string, options?: { focusHost?: boolean }) =>
    ipcRenderer.invoke('browser:release-input', { windowId, ...options }),

  // Webview 指针锁 / 全屏状态变化（主进程 → 前端）
  onBrowserPointerLockChanged: (
    callback: (event: any, data: { windowId: string; locked: boolean; fullscreen?: boolean }) => void
  ) => {
    ipcRenderer.on('browser:pointer-lock-changed', callback)
  },

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
  onSetWebviewViewport: (callback: (event: any, data: { windowId: string; width: number; height: number }) => void) => {
    ipcRenderer.on('browser:set-webview-viewport', callback)
  },
  onWindowFaviconUpdated: (callback: (event: any, data: { windowId: string; favicon: string }) => void) => {
    ipcRenderer.on('window-favicon-updated', callback)
  },

  // 清空所有浏览器自动化 session 数据（cookie、缓存、localStorage 等，不影响主程序）
  clearBrowserData: () =>
    ipcRenderer.invoke('browser:clear-all-data'),

  // 桌面 Computer Use：状态查询与设置页测试
  getComputerUseStatus: () => ipcRenderer.invoke('computer-use:status'),
  testComputerUse: () => ipcRenderer.invoke('computer-use:test'),

  // 桌宠/托盘：推送聚合统计数据（fire-and-forget）
  // 托盘提示、任务栏角标与桌宠状态同源，故一次推送携带全部字段
  updateTrayStats: (stats: {
    running: number
    unread: number
    awaiting?: number
    mode?: 'idle' | 'walk' | 'run' | 'yawn'
    title?: string
    toolLabel?: string
    sessionId?: string | null
    /** 摘要列表（已按 待答>运行中>未读 择优，≤3 条），桌宠气泡列表用 */
    sessions?: Array<{
      sessionId: string
      title: string
      status: 'awaiting' | 'running' | 'unread'
      toolLabel?: string
    }>
  }) => ipcRenderer.send('tray:update-stats', stats),

  // 桌宠：推送配置（形象 + 显隐 + 透明度）
  updatePetSettings: (settings: {
    enabled: boolean
    opacity: number
    avatarId?: string
  }) => ipcRenderer.send('pet:update-settings', settings),

  /** 桌宠：可用形象列表（设置页形象选择器；预览图为 data URL） */
  listPetAvatars: () =>
    ipcRenderer.invoke('pet:list-avatars') as Promise<
      Array<{ id: string; name: string; previewDataUrl: string | null }>
    >,

  /**
   * 桌宠发起的操作回传主窗口渲染层（主进程 → 渲染层）
   *
   * 为什么要绕一圈：桌宠窗是独立进程上下文，没有后端 token，也不能直接调 API。
   * 由主进程转发给主窗口渲染层，后者用既有 apiService 落盘/中断流，
   * 保持「后端是设置的单一真相」。
   */
  onPetAction: (
    callback: (payload: {
      kind: 'toggle-enabled' | 'open-session' | 'stop-session'
      enabled?: boolean
      sessionId?: string | null
    }) => void
  ) => {
    const listener = (_event: unknown, payload: {
      kind: 'toggle-enabled' | 'open-session' | 'stop-session'
      enabled?: boolean
      sessionId?: string | null
    }) => callback(payload)
    ipcRenderer.on('pet:action', listener)
    return () => ipcRenderer.removeListener('pet:action', listener)
  },

  // 防休眠模式：off 不干预 / busy 仅执行任务时 / always 始终（落盘由后端负责）
  updateKeepAwakeMode: (mode: 'off' | 'busy' | 'always') =>
    ipcRenderer.send('power:update-keep-awake-mode', mode),

  // 重启应用（移动访问的监听地址变更需要重启进程才生效）
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),

})
