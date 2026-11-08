import { useRouter } from 'vue-router'

import { apiService } from '@/services/ApiService'
import { usePluginPanels } from '@/stores/pluginPanels'

/**
 * 插件宿主桥（v3）
 *
 * 统一注入给 `main` / `conversation.side.panel` 等容器型 slot 组件，
 * 避免每个插件各自实现一遍"调后端 / 开面板 / 拼 URL / 读数据"。
 */
export interface PluginHost {
  /** 调用插件 RPC（= POST /plugins/:id/rpc/:method） */
  call: <T = unknown>(pluginId: string, method: string, args?: unknown) => Promise<T>
  /** 读写插件数据（plugin:<id>） */
  getData: (pluginId: string) => Promise<Record<string, unknown>>
  setValue: (pluginId: string, key: string, value: unknown) => Promise<void>
  /** 插件自定义 HTTP 路由的完整 URL */
  url: (pluginId: string, path: string) => string
  /** 打开对话右侧面板（按 slotKey 选择组件） */
  openPanel: (pluginId: string, slotKey: string) => void
  closePanel: () => void
  /** 跳到插件全页工作台 */
  openPage: (pluginId: string, slotKey?: string) => void
}

/** 拼插件 HTTP 路由 URL（与后端 `/plugins/:id/http/*` 对齐） */
export function pluginHttpUrl(pluginId: string, path: string): string {
  const base = String((apiService as any).baseURL || '/api/v1').replace(/\/$/, '')
  const rel = String(path || '').replace(/^\/+/, '')
  return `${base}/plugins/${pluginId}/http/${rel}`
}

export function usePluginHost(): PluginHost {
  const router = useRouter()
  const panels = usePluginPanels()

  return {
    call: (pluginId, method, args) => apiService.call(pluginId, method, args) as any,
    getData: (pluginId) => apiService.getPluginData(pluginId) as any,
    setValue: (pluginId, key, value) =>
      apiService.setPluginData(pluginId, key, value) as any,
    url: pluginHttpUrl,
    openPanel: (pluginId, slotKey) => panels.open(pluginId, slotKey),
    closePanel: () => panels.close(),
    openPage: (pluginId, slotKey) => {
      void router.push({
        name: 'PluginPage',
        params: { pluginId, slotKey: slotKey || '' },
      })
    },
  }
}
