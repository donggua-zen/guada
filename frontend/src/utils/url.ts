/**
 * URL 工具函数
 */

/**
 * 修正前端资源 URL（自适应 Web 和 Electron 环境）
 * - Electron 环境：使用相对路径（如 images/models/xxx.svg）
 * - Web 环境：使用绝对路径（如 /images/models/xxx.svg）
 * 
 * @param url 原始 URL（如 /images/models/xxx.svg）
 * @returns 适配后的 URL
 */
export function fixFrontendAssetUrl(url: string): string {
  if (!url) return url
  
  // 检查是否是 Electron 环境
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
  
  // 如果是绝对 URL（http:// 或 https://），直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  // Electron 环境：去除开头的 /
  if (isElectron && url.startsWith('/')) {
    return url.substring(1)
  }
  
  // Web 环境：保持原样（带 / 的绝对路径）
  return url
}

/**
 * 修正静态资源 URL
 * - Web 环境：保持原样（使用相对路径，由 Vite dev server 代理）
 * - Electron 环境：转换为完整的 HTTP URL
 *
 * @param url 原始 URL（如 /static/images/xxx.svg）
 * @returns 修正后的 URL
 */
export function fixStaticUrl(url: string): string {
  if (!url) return url

  // 检查是否是 Electron 环境
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

  // 如果是绝对 URL（http:// 或 https://），直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // Electron 环境：将相对路径转换为完整的 HTTP URL
  if (isElectron && url.startsWith('/')) {
    return `http://localhost:3000${url}`
  }

  // Web 环境：保持原样
  return url
}

/**
 * 后端上传资源绝对化（FileRef.url / previewUrl 展示用）。
 *
 * 存储引用为相对路径（uploads/... 或自包含的 sessions/<id>/...），展示时按运行环境还原：
 * - Electron：用后端动态端口拼完整 URL（端口随启动变化，不能硬编码；进程内缓存）
 * - Web：同源相对路径（dev 由 Vite 代理，生产同源部署天然可达）
 * - 已是 http(s)/data:/blob: 的引用原样返回
 *
 * 会话附件（refType='session'，随会话数据目录存储、不再经 /uploads 静态挂载）
 * 走鉴权取图端点：`<apiBase>/sessions/<id>/attachments/raw-file?path=..&token=..`。
 * url 自包含（内嵌 sessionId），此处无需调用方传会话上下文。
 */
let cachedBackendOrigin: string | null = null;

/** Electron 下取后端源（进程内缓存动态端口）；Web 返回空串（同源相对路径） */
function resolveBackendOrigin(): string {
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!electronAPI) return ''
  if (cachedBackendOrigin === null) {
    const status = electronAPI.getBackendStatusSync?.()
    cachedBackendOrigin = status?.port ? `http://localhost:${status.port}` : ''
  }
  return cachedBackendOrigin
}

/** 会话附件取图 URL；非 sessions/<id>/... 形态返回 null */
function buildSessionAttachmentUrl(
  storagePath: string,
  origin: string,
): string | null {
  const match = storagePath.match(/^sessions\/([^/]+)\/(.+)$/)
  if (!match) return null
  const [, id, rel] = match
  // <img> 带不上 Authorization 头，走 ?token= 查询通道（与 workspace raw-file 同款）
  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('token') || localStorage.getItem('token') || ''
      : ''
  const apiPath =
    `/api/v1/sessions/${encodeURIComponent(id)}/attachments/raw-file` +
    `?path=${encodeURIComponent(rel)}&token=${encodeURIComponent(token)}`
  return origin ? `${origin}${apiPath}` : apiPath
}

export function toResourceUrl(storagePath?: string | null): string {
  if (!storagePath) return ''
  if (/^(https?:\/\/|data:|blob:)/i.test(storagePath)) return storagePath

  const origin = resolveBackendOrigin()

  // 会话附件自包含引用 → 鉴权取图端点
  const sessionUrl = buildSessionAttachmentUrl(storagePath, origin)
  if (sessionUrl) return sessionUrl

  const path = storagePath.startsWith('/') ? storagePath : `/${storagePath}`
  return origin ? `${origin}${path}` : path
}
