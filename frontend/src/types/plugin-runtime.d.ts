/**
 * 插件运行时全局对象声明
 *
 * 两个对象由主应用在启动时挂到 window 上：
 * - __GuaDaShared__：main.js 挂载。共享 Vue / ElementPlus 实例、响应式 runtime（用户/会话/语言/主题）、
 *   插件 i18n 字典注册表、apiService 实例，供外部插件产物运行时取用
 * - __GuaDaModuleLoader__：services/plugin-loader.js 挂载。外部插件模块的注册、prepare 与按需加载
 *
 * 均声明为可选：非浏览器环境（单测等）下不存在，消费方须用可选链访问。
 */

import type { User } from '@/types/api'

/** 插件运行时共享数据（main.js 中为 reactive 对象，插件 UI 可响应式读取） */
export interface GuaDaSharedRuntime {
  user?: User | null
  session?: {
    id?: string
    workspaceId?: string
    workspaceName?: string
  }
  locale?: string
  theme?: string
}

/** 插件语言包注册表：register 返回注销函数 */
export interface GuaDaSharedI18n {
  dictionaries: Map<string, Record<string, any>>
  register(pluginId: string, messages: Record<string, any>): () => void
  t(pluginId: string, key: string, params?: Record<string, any>): string
}

export interface GuaDaShared {
  /** 主应用的 Vue 实例（插件产物从这里取，不自行 import） */
  vue: typeof import('vue')
  'element-plus': typeof import('element-plus')
  runtime: GuaDaSharedRuntime
  i18n: GuaDaSharedI18n
  /** 主应用 apiService 实例（含 _request 与各领域 API 方法） */
  pluginApi: typeof import('@/services/ApiService').apiService
}

/** 外部插件模块加载器 */
export interface GuaDaModuleLoader {
  register(id: string, exports: any): void
  prepare(meta: { id: string; url: string; cssUrl?: string }): void
  import(id: string): Promise<any>
  invalidate(id: string): void
  unload(id: string): void
  _debug(): any
}

declare global {
  interface Window {
    __GuaDaShared__?: GuaDaShared
    __GuaDaModuleLoader__?: GuaDaModuleLoader
  }
}
