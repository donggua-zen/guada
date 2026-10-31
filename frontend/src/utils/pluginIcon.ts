import { apiService } from '@/services/ApiService'

/**
 * 插件图标 URL。
 *
 * 图标统一由后端 `GET /plugins/:pluginId/icon` 出图：内置插件读 STATIC_DIR，
 * 外部插件读插件目录，manifest 里的 data:/http URL 由后端 302 转发。
 *
 * 必须基于 `apiService.baseURL` 拼接：Electron 生产环境页面是 file://，
 * 硬编码 `/api/v1` 会被解析成 `file:///api/v1/...` 而加载失败。
 * 与 pluginSlots / ModelsProviderList 的插件资源 URL 规则保持一致。
 *
 * `rev` 来自后端 `/plugins/query` 的 `iconRev`（文件 mtime）：替换图标文件后
 * URL 随之变化，避免浏览器/Electron 按旧 URL 命中长缓存而看不到新图。
 */
export function resolvePluginIconUrl(
  pluginId?: string | null,
  rev?: string | null,
): string | null {
  if (!pluginId) return null
  const base = String(apiService.baseURL || '/api/v1').replace(/\/$/, '')
  const suffix = rev ? `?rev=${encodeURIComponent(rev)}` : ''
  return `${base}/plugins/${encodeURIComponent(pluginId)}/icon${suffix}`
}
