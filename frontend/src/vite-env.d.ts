/// <reference types="vite/client" />

/* eslint-disable @typescript-eslint/no-empty-object-type -- *.vue 兜底声明与无类型三方库声明里 DefineComponent<{}, {}> 的 {} 是社区惯例写法（组件内部数据不可知，按 unknown 处理） */

// 全局 Vue 类型声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, unknown>
  export default component
}

// 第三方库类型声明（没有官方类型定义的）
declare module 'simplebar-vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, unknown>
  export default component
}

declare module 'splitpanes' {
  import type { DefineComponent } from 'vue'
  export const Splitpanes: DefineComponent<{}, {}, unknown>
  export const Pane: DefineComponent<{}, {}, unknown>
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

// Electron API 类型声明已统一至 src/types/electron.d.ts

// ── 非标准 / 浏览器专有 API 类型补充 ──

/** Electron <webview> 自定义元素 */
interface ElectronWebviewElement extends HTMLElement {
  isReady?: boolean
  canGoBack: boolean
  canGoForward: boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  loadURL(url: string): Promise<void>
  setAudioMuted(muted: boolean): void
}

/** Electron <webview> did-navigate / did-navigate-in-page 事件载荷（DOM Event 附加字段） */
interface ElectronWebviewNavigateEvent extends Event {
  url: string
  /** 仅 did-navigate-in-page 携带：是否主框架内导航 */
  isMainFrame?: boolean
}

/** Electron <webview> page-title-updated 事件载荷 */
interface ElectronWebviewTitleUpdatedEvent extends Event {
  title: string
}

/** Chrome 专有 performance.memory */
interface Performance {
  memory?: {
    jsHeapSizeLimit: number
    totalJSHeapSize: number
    usedJSHeapSize: number
  }
}
