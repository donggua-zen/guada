import { contextBridge, ipcRenderer } from 'electron'

/**
 * Browser Shell 专用 Preload 脚本
 *
 * 仅向外壳页面暴露最小化的安全 API：窗口控制、初始化消息监听。
 * 注意：preload 执行时 document 可能尚未就绪，禁止在此访问 DOM。
 */

contextBridge.exposeInMainWorld('shellAPI', {
  // 接收初始化数据（targetUrl, windowId, sessionId）
  onInit: (callback: (data: { targetUrl: string; windowId: string; sessionId: string }) => void) => {
    ipcRenderer.on('shell:init', (_event, data) => callback(data))
  },

  // 窗口控制
  minimize: () => ipcRenderer.send('shell:window-minimize'),
  maximize: () => ipcRenderer.send('shell:window-maximize'),
  close: () => ipcRenderer.send('shell:window-hide'), // 关闭按钮实际是隐藏窗口（后台运行）
})
