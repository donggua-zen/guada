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
 * 存储引用为相对路径（uploads/...，self-contained 契约），展示时按运行环境还原：
 * - Electron：用后端动态端口拼完整 URL（端口随启动变化，不能硬编码；进程内缓存）
 * - Web：同源相对路径（dev 由 Vite /uploads 代理，生产同源部署天然可达）
 * - 已是 http(s)/data:/blob: 的引用原样返回
 */
let cachedBackendOrigin: string | null = null;

export function toResourceUrl(storagePath?: string | null): string {
  if (!storagePath) return ''
  if (/^(https?:\/\/|data:|blob:)/i.test(storagePath)) return storagePath

  const path = storagePath.startsWith('/') ? storagePath : `/${storagePath}`
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!electronAPI) return path

  if (cachedBackendOrigin === null) {
    const status = electronAPI.getBackendStatusSync?.()
    cachedBackendOrigin = status?.port ? `http://localhost:${status.port}` : ''
  }
  return cachedBackendOrigin ? `${cachedBackendOrigin}${path}` : path
}
