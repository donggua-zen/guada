/**
 * 浏览器默认渲染视口（设置中心"默认渲染视口"）
 *
 * 所有 webview 恒定使用固定渲染视口渲染（默认 1280×720）：后台渲染、截图、
 * CDP 坐标均基于该视口，不随预览面板尺寸/可见性跳变；前台预览区显示时由
 * BrowserWebviewLayer 做合成器层面的等比缩放（留白居中），不影响真实页面。
 *
 * 职责划分：
 * - 全局默认视口：此处管理，后端 `browser` 设置分组持久化，作用于所有未覆盖的网页
 * - 单个网页覆盖：browserWebview store 的 viewportOverrides（预览工具栏入口），
 *   仅内存保存、按网页隔离、不持久化，关闭标签即失效
 */

import { useBrowserWebviewStore, type ViewportSize } from '@/stores/browserWebview'

/** 预设尺寸（含竖屏，适配竖长预览面板） */
export const VIEWPORT_PRESETS: ReadonlyArray<ViewportSize> = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 720, height: 1280 },
  { width: 390, height: 844 },
]

export const DEFAULT_VIEWPORT: ViewportSize = { width: 1280, height: 720 }

/** 自定义尺寸合法范围 */
export const VIEWPORT_MIN: ViewportSize = { width: 320, height: 240 }
export const VIEWPORT_MAX: ViewportSize = { width: 3840, height: 2160 }

const SETTINGS_GROUP = 'browser'

/** 尺寸合法性校验（整数、范围内，供设置中心与工具栏保存前调用） */
export function isValidViewportSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= VIEWPORT_MIN.width &&
    width <= VIEWPORT_MAX.width &&
    height >= VIEWPORT_MIN.height &&
    height <= VIEWPORT_MAX.height
  )
}

/** 应用启动时调用：加载后端保存的默认渲染视口并同步到 store（失败保持内置默认值） */
export async function loadDefaultViewport(): Promise<void> {
  try {
    const { apiService } = await import('@/services/ApiService')
    const response = await apiService.fetchGroupSettings(SETTINGS_GROUP)
    const width = Number(response?.viewportWidth)
    const height = Number(response?.viewportHeight)
    if (isValidViewportSize(width, height)) {
      useBrowserWebviewStore().setViewportSize(Math.round(width), Math.round(height))
    }
  } catch {
    // 后端不可用时保持 store 默认值
  }
}

/** 设置中心保存默认渲染视口：立即生效（store），并异步落盘后端 */
export async function saveDefaultViewport(width: number, height: number): Promise<void> {
  if (!isValidViewportSize(width, height)) {
    throw new Error(`invalid viewport size: ${width}x${height}`)
  }
  useBrowserWebviewStore().setViewportSize(Math.round(width), Math.round(height))
  try {
    const { apiService } = await import('@/services/ApiService')
    await apiService.updateGroupSettings(SETTINGS_GROUP, {
      viewportWidth: Math.round(width),
      viewportHeight: Math.round(height),
    })
  } catch (error) {
    console.error('[browserViewport] 保存默认渲染视口失败:', error)
    throw error
  }
}
