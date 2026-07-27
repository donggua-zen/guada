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
    apply(element: Element, diff: any[]): Element | false
    remove(element: Element, diff: any[]): Element | false
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

/** Chrome 专有 performance.memory */
interface Performance {
  memory?: {
    jsHeapSizeLimit: number
    totalJSHeapSize: number
    usedJSHeapSize: number
  }
}
