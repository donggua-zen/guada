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
  console.log('fixFrontendAssetUrl', url, isElectron)
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
