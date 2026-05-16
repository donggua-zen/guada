/// <reference types="vite/client" />

// 全局 Vue 类型声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 第三方库类型声明（没有官方类型定义的）
declare module 'diff-dom' {
  export class DiffDOM {
    constructor(options?: any)
    apply(element: Element, diff: any[]): Element
    remove(element: Element, diff: any[]): Element
  }
  export default DiffDOM
}

declare module 'simplebar-vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'splitpanes' {
  import type { DefineComponent } from 'vue'
  export const Splitpanes: DefineComponent<{}, {}, any>
  export const Pane: DefineComponent<{}, {}, any>
}

// 图片资源声明
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.jpeg' {
  const src: string
  export default src
}

declare module '*.gif' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

// 环境变量声明
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_BASE_URL: string
  // 更多环境变量...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Electron API 类型声明
interface ElectronAPI {
  platform: string
  versions: {
    node: string
    chrome: string
    electron: string
  }
  getAppInfo: () => Promise<any>
  showNotification: (title: string, body: string) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  checkForUpdates: () => Promise<{ success: boolean; error?: string }>
  startDownloadUpdate: () => Promise<void>
  installAndRestart: () => void
  onUpdateStatus: (callback: (status: any) => void) => void
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
  toggleDevTools: () => void
  openUserDataFolder: () => void
  openInstallFolder: () => void
  openFolder: (folderPath: string) => Promise<void>
  
  // 窗口管理（新 API - 浏览器自动化窗口）
  createBrowserWindow: (url?: string, metadata?: Record<string, any>) => Promise<{ success: boolean; window?: any }>
  activateBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  closeBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  getBrowserWindows: () => Promise<{ success: boolean; windows?: any[] }>
  onBrowserWindowUpdated: (callback: (event: any, data: any) => void) => void
  onBrowserWindowClosed: (callback: (event: any, data: any) => void) => void
  
  // 浏览器窗口后台/前台模式控制
  hideBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  showBrowserWindow: (windowId: string) => Promise<{ success: boolean }>
  toggleBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>
  getBrowserWindowVisibility: (windowId: string) => Promise<{ success: boolean; isVisible?: boolean }>
  
  // 调试菜单
  showDebugMenu: () => Promise<void>
  
  // 右键菜单
  showTabContextMenu: (params: { tabId: string; isSplitMode: boolean }) => Promise<void>
}

interface Window {
  electronAPI?: ElectronAPI
}
