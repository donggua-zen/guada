/**
 * 浏览器默认渲染视口（设置中心"默认渲染视口"）
 *
 * 默认所有 webview 使用固定渲染视口渲染（默认 1280×720）：后台渲染、截图、
 * CDP 坐标均基于该视口，不随预览面板尺寸/可见性跳变；前台预览区显示时由
 * BrowserWebviewLayer 做合成器层面的等比缩放（留白居中），不影响真实页面。
 *
 * 也可选择「自适应」：布局盒直接跟随预览面板实测尺寸，页面随面板实时重排
 * （面板隐藏时使用最后一次有效尺寸）。自适应可设为全局默认，也可在预览
 * 工具栏按网页临时覆盖。
 *
 * 职责划分：
 * - 全局默认视口/模式：此处管理，后端 `browser` 设置分组持久化，作用于所有未覆盖的网页
 * - 单个网页覆盖：browserWebview store 的 viewportOverrides（预览工具栏入口），
 *   仅内存保存、按网页隔离、不持久化，关闭标签即失效
 *
 * 本模块同时承载 `browser` 分组的启动期唯一读取入口 `loadBrowserSettings()`
 * （视口/模式 + 链接打开方式 + 侧边栏自动展开同组下发，只发一次请求）。
 */

import {
  useBrowserWebviewStore,
  type ViewportMode,
  type ViewportSize,
} from '@/stores/browserWebview'
import {
  setAutoShowSidebar,
  setLinkOpenMode,
  type LinkOpenMode,
} from '@/utils/workspacePreview'

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

/** 归一化后的 browser 分组设置（缺省 = 后端未给或值非法，保持调用方现状） */
export interface BrowserGroupSettings {
  viewport?: ViewportSize
  viewportMode?: ViewportMode
  linkOpenMode?: LinkOpenMode
  autoShowSidebar?: boolean
}

/** 链接打开方式合法取值 */
const LINK_OPEN_MODES: readonly string[] = ['internal', 'external', 'ask']

/**
 * 纯函数：把 browser 分组响应归一化为可应用的分组。
 * 非法/缺失的值一律不产出，避免把脏值写进 store 与 localStorage 缓存。
 */
export function extractBrowserSettings(
  response: Record<string, unknown> | null | undefined,
): BrowserGroupSettings {
  const result: BrowserGroupSettings = {}

  const width = Number(response?.viewportWidth)
  const height = Number(response?.viewportHeight)
  if (isValidViewportSize(width, height)) {
    result.viewport = { width: Math.round(width), height: Math.round(height) }
  }

  const viewportMode = response?.viewportMode
  if (viewportMode === 'adaptive' || viewportMode === 'fixed') {
    result.viewportMode = viewportMode
  } else if (result.viewport) {
    // 老配置没有 viewportMode 字段：存在合法固定尺寸即视为固定模式
    result.viewportMode = 'fixed'
  }

  const mode = response?.linkOpenMode
  if (typeof mode === 'string' && LINK_OPEN_MODES.includes(mode)) {
    result.linkOpenMode = mode as LinkOpenMode
  }

  if (typeof response?.autoShowSidebar === 'boolean') {
    result.autoShowSidebar = response.autoShowSidebar
  }

  return result
}

/** 应用归一化结果（视口/模式 → store，其余两项 → localStorage 缓存） */
export function applyBrowserSettings(settings: BrowserGroupSettings): void {
  if (settings.viewport) {
    useBrowserWebviewStore().setViewportSize(settings.viewport.width, settings.viewport.height)
  }
  if (settings.viewportMode) {
    useBrowserWebviewStore().setViewportAdaptive(settings.viewportMode === 'adaptive')
  }
  if (settings.linkOpenMode) {
    setLinkOpenMode(settings.linkOpenMode)
  }
  if (settings.autoShowSidebar !== undefined) {
    setAutoShowSidebar(settings.autoShowSidebar)
  }
}

/** 最近一次成功拉取并归一化的分组（设置页表单复用这份 payload，不再二次请求） */
let appliedSettings: BrowserGroupSettings | null = null

/** 在途请求：并发调用（启动加载 + 设置页挂载）复用同一个 Promise */
let pendingLoad: Promise<BrowserGroupSettings | null> | null = null

/** 读取最近一次成功拉取的分组（尚未成功时为 null） */
export function getBrowserSettings(): BrowserGroupSettings | null {
  return appliedSettings
}

/**
 * 应用启动时调用一次：加载后端保存的 browser 分组并应用（失败保持内置默认值与本地缓存）。
 * 由 main.js 在后端就绪后调用；设置页也调它复用同一份结果（幂等，同一启动内只真正请求一次）。
 *
 * @returns 归一化后的分组；失败（后端不可用）返回 null，调用方退回默认值
 */
export function loadBrowserSettings(): Promise<BrowserGroupSettings | null> {
  if (!pendingLoad) {
    pendingLoad = fetchBrowserSettings().then((result) => {
      // 失败不留缓存：下次调用（如稍后打开设置页）重新尝试
      if (!result) pendingLoad = null
      return result
    })
  }
  return pendingLoad
}

async function fetchBrowserSettings(): Promise<BrowserGroupSettings | null> {
  try {
    const { apiService } = await import('@/services/ApiService')
    const response = await apiService.fetchGroupSettings(SETTINGS_GROUP)
    const extracted = extractBrowserSettings(response)
    appliedSettings = extracted
    applyBrowserSettings(extracted)
    return extracted
  } catch {
    // 后端不可用时保持 store 默认值 + localStorage 缓存
    return null
  }
}

/** 设置中心保存默认渲染视口：立即生效（store），并异步落盘后端（同时切回固定模式） */
export async function saveDefaultViewport(width: number, height: number): Promise<void> {
  if (!isValidViewportSize(width, height)) {
    throw new Error(`invalid viewport size: ${width}x${height}`)
  }
  useBrowserWebviewStore().setViewportSize(Math.round(width), Math.round(height))
  useBrowserWebviewStore().setViewportAdaptive(false)
  try {
    const { apiService } = await import('@/services/ApiService')
    await apiService.updateGroupSettings(SETTINGS_GROUP, {
      viewportWidth: Math.round(width),
      viewportHeight: Math.round(height),
      viewportMode: 'fixed',
    })
  } catch (error) {
    console.error('[browserViewport] 保存默认渲染视口失败:', error)
    throw error
  }
}

/** 设置中心切换默认渲染视口模式：立即生效（store），并异步落盘后端 */
export async function saveDefaultViewportMode(mode: ViewportMode): Promise<void> {
  useBrowserWebviewStore().setViewportAdaptive(mode === 'adaptive')
  try {
    const { apiService } = await import('@/services/ApiService')
    await apiService.updateGroupSettings(SETTINGS_GROUP, { viewportMode: mode })
  } catch (error) {
    console.error('[browserViewport] 保存默认渲染视口模式失败:', error)
    throw error
  }
}
