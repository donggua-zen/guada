// composables/useFloatingChatPanel.ts
import { computed, type ComputedRef } from 'vue'
import { useWindowSize } from '@vueuse/core'

/**
 * 工作目录全屏时的悬浮对话面板：几何计算与约束。
 *
 * 这里只放「可测的纯逻辑 + 视口尺寸订阅」，鼠标拖拽/缩放留在组件里（需要模板 ref 与 DOM 读写）。
 * 抽出来的动机：旧实现把这些内联在组件中，只能靠手测——样式里的 min-width 与 JS 的
 * 「放不下」判定各写一份，两边不一致直接把面板推出屏幕，就是这么漏过去的。
 *
 * 单位一律 CSS px；对外暴露的锚点坐标全部取整（浮窗整体在合成层上，right/bottom 带小数
 * 会让整窗文字按小数位置重采样发虚）。
 */

/** 与视口边缘的最小留白 */
export const FLOATING_CHAT_MARGIN = 8
/** 展开态面板下限。JS 是唯一真相：样式里不再写 min-width/min-height */
export const FLOATING_CHAT_MIN_W = 320
export const FLOATING_CHAT_MIN_H = 320
/** 展开态面板默认尺寸 */
export const FLOATING_CHAT_DEFAULT_W = 430
export const FLOATING_CHAT_DEFAULT_H = 700
/**
 * Windows/Linux 顶部自定义标题栏行高度（CustomTitlebar 为 h-9）。
 * 面板不得越过它，否则会盖住窗口控制按钮。
 */
export const FLOATING_CHAT_TITLEBAR_H = 36
/**
 * macOS 内容首行高度（页头 / 工作区工具栏均为 h-10）。
 * mac 无独立标题栏行，这一行承担窗口拖拽，面板同样不得压住。
 */
export const FLOATING_CHAT_CONTENT_DRAG_ROW_H = 40

/**
 * 顶部禁入带高度：面板、悬浮球、恢复条都不得压住窗口拖拽区。
 *
 * 这一条不是美观问题而是功能问题：Electron 的拖拽区按**布局**计算，不看层叠顺序
 * （`-webkit-app-region: drag` 的元素即使被别的元素盖住，那片区域照样拖窗口）。
 * 浮窗一旦被拖进那条带子里，它自己的鼠标事件就再也收不到 —— 抓手拖不动，
 * 只剩窗口被拖走，表现为「拖上去就回不来了」。
 *
 * - Windows/Linux：有独立标题栏行（h-9）承担拖拽，内容区不再有拖拽区
 * - macOS：无独立标题栏行，内容首行（h-10）承担拖拽
 * - Web：`-webkit-app-region` 无效，无需预留
 */
export function resolveTopReserve(platform: { isElectron: boolean; isMac: boolean }): number {
  if (!platform.isElectron) return 0
  return platform.isMac ? FLOATING_CHAT_CONTENT_DRAG_ROW_H : FLOATING_CHAT_TITLEBAR_H
}

export interface FloatingSize {
  w: number
  h: number
}

export interface FloatingViewport {
  w: number
  h: number
}

/** 面板/悬浮球的**右下角**锚点像素坐标（右下角定位：宽度变化向左长、高度变化向上长） */
export interface FloatingPoint {
  x: number
  y: number
}

/**
 * 锚点在视口中的比例位置（0~1）。rx=1/ry=1 即右下角。
 * 存相对值而非像素：窗口尺寸变化后按比例跟随，不需要额外的 resize 纠正
 */
export interface FloatingRelative {
  rx: number
  ry: number
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function toFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 可用区域：四周留白，顶部再让开标题栏 */
export function usableArea(viewport: FloatingViewport, reserveTop: number): {
  left: number
  top: number
  right: number
  bottom: number
} {
  return {
    left: FLOATING_CHAT_MARGIN,
    top: FLOATING_CHAT_MARGIN + Math.max(0, reserveTop),
    right: Math.max(FLOATING_CHAT_MARGIN, viewport.w - FLOATING_CHAT_MARGIN),
    bottom: Math.max(FLOATING_CHAT_MARGIN, viewport.h - FLOATING_CHAT_MARGIN),
  }
}

/** 可用区域的尺寸上限 */
function areaMax(viewport: FloatingViewport, reserveTop: number): FloatingSize {
  const area = usableArea(viewport, reserveTop)
  return {
    w: Math.max(1, Math.round(area.right - area.left)),
    h: Math.max(1, Math.round(area.bottom - area.top)),
  }
}

/**
 * 面板尺寸钳制：先满足下限、再保证不溢出可用区域。
 *
 * 两者冲突（视口比面板下限还小）时以「不溢出视口」为准——下限是体验问题，溢出是可用性问题。
 */
export function clampSize(size: FloatingSize, viewport: FloatingViewport, reserveTop: number): FloatingSize {
  const max = areaMax(viewport, reserveTop)
  return {
    w: Math.min(Math.max(Math.round(size.w), Math.min(FLOATING_CHAT_MIN_W, max.w)), max.w),
    h: Math.min(Math.max(Math.round(size.h), Math.min(FLOATING_CHAT_MIN_H, max.h)), max.h),
  }
}

/**
 * 只按可用区域封顶，**不施加面板下限**。
 * 悬浮球/恢复条的尺寸由调用方定死（40px 的球不该被抬到 320px），但边界要共用同一套。
 */
function capToArea(size: FloatingSize, viewport: FloatingViewport, reserveTop: number): FloatingSize {
  const max = areaMax(viewport, reserveTop)
  return {
    w: Math.min(Math.max(1, Math.round(size.w)), max.w),
    h: Math.min(Math.max(1, Math.round(size.h)), max.h),
  }
}

/** 视口是否容得下面板下限；容不下就整块自动隐藏，避免浮窗占满屏幕 */
export function panelFits(viewport: FloatingViewport, reserveTop: number): boolean {
  const area = usableArea(viewport, reserveTop)
  return Math.round(area.right - area.left) >= FLOATING_CHAT_MIN_W
    && Math.round(area.bottom - area.top) >= FLOATING_CHAT_MIN_H
}

/** 右下角锚点钳制：锚点本身与左上角都要落在可用区域内，结果落整 CSS px */
export function clampAnchor(
  anchor: FloatingPoint,
  size: FloatingSize,
  viewport: FloatingViewport,
  reserveTop: number,
): FloatingPoint {
  const area = usableArea(viewport, reserveTop)
  const { w, h } = capToArea(size, viewport, reserveTop)
  // 面板比可用区域还大时，min 会大于 area.right；先夹一次再作为下界使用
  const minX = Math.min(area.left + w, area.right)
  const minY = Math.min(area.top + h, area.bottom)
  return {
    x: Math.round(Math.min(Math.max(anchor.x, minX), area.right)),
    y: Math.round(Math.min(Math.max(anchor.y, minY), area.bottom)),
  }
}

/** 按下缩放把手那一刻的矩形（视口坐标，已取整） */
export interface FloatingRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 缩放入口：四条边 + 四个角 */
export type FloatingResizeEdge =
  | 'top' | 'right' | 'bottom' | 'left'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** 每条边/角抓的是哪条边（角抓的是"拐角两侧"，因此对角那条永远不动） */
function grabbedEdges(edge: FloatingResizeEdge): {
  grabLeft: boolean
  grabRight: boolean
  grabTop: boolean
  grabBottom: boolean
} {
  return {
    grabLeft: edge === 'left' || edge === 'top-left' || edge === 'bottom-left',
    grabRight: edge === 'right' || edge === 'top-right' || edge === 'bottom-right',
    grabTop: edge === 'top' || edge === 'top-left' || edge === 'top-right',
    grabBottom: edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right',
  }
}

/**
 * 单轴求解：抓取的那条边跟随光标，另一条**原地不动**。
 *
 * 尺寸触底时让抓取边停下（而不是挤走另一条边），这样"不动的永远是非抓取边"这条
 * 不变量在任何钳制下都成立——否则左缘会被挤出去，看起来就是方向反了。
 */
function resolveAxis(
  low: number,
  high: number,
  delta: number,
  limitLow: number,
  limitHigh: number,
  min: number,
  grabLow: boolean,
  grabHigh: boolean,
): { low: number; high: number } {
  const minSize = Math.max(1, min)
  if (grabHigh) {
    // high - low >= minSize → high 有下界；同时不能越过 limitHigh
    const lower = Math.min(limitHigh, low + minSize)
    return { low, high: Math.round(Math.min(Math.max(high + delta, lower), limitHigh)) }
  }
  if (grabLow) {
    // high - low >= minSize → low 有上界；同时不能越过 limitLow
    const upper = Math.max(limitLow, high - minSize)
    return { low: Math.round(Math.min(Math.max(low + delta, limitLow), upper)), high }
  }
  return { low, high }
}

/**
 * 缩放几何。
 *
 * 面板靠 right/bottom 定位（锚在右下角），所以缩放时**锚点必须与尺寸同向同步移动**：
 * 只改尺寸会让抓取边原地不动、反而推着对面的边跑，手感正好相反
 * （拖右缘向右，面板却从左边缩进去）。
 *
 * 返回的 anchor 恒为矩形的右下角，与 fixed 定位的 right/bottom 语义一致。
 *
 * @param delta 光标相对按下点的位移（CSS px）
 * @param start 按下时的矩形
 */
export function resolveResize(
  edge: FloatingResizeEdge,
  delta: FloatingPoint,
  start: FloatingRect,
  viewport: FloatingViewport,
  reserveTop: number,
): { size: FloatingSize; anchor: FloatingPoint } {
  const area = usableArea(viewport, reserveTop)
  const { grabLeft, grabRight, grabTop, grabBottom } = grabbedEdges(edge)

  const x = resolveAxis(
    start.left, start.right, delta.x,
    area.left, area.right, FLOATING_CHAT_MIN_W, grabLeft, grabRight,
  )
  const y = resolveAxis(
    start.top, start.bottom, delta.y,
    area.top, area.bottom, FLOATING_CHAT_MIN_H, grabTop, grabBottom,
  )

  return {
    size: { w: x.high - x.low, h: y.high - y.low },
    anchor: { x: x.high, y: y.high },
  }
}

/** 锚点像素 → 相对坐标 */
export function toRelative(anchor: FloatingPoint, viewport: FloatingViewport): FloatingRelative {
  return {
    rx: viewport.w > 0 ? clamp01(anchor.x / viewport.w) : 1,
    ry: viewport.h > 0 ? clamp01(anchor.y / viewport.h) : 1,
  }
}

/**
 * 相对坐标 → 锚点像素。宽松读取（localStorage 是用户可改的外部输入）：
 * 缺字段/非数字/NaN 一律收敛回右下角默认，不抛错也不出界。
 */
export function fromRelative(
  rel: FloatingRelative | null | undefined,
  viewport: FloatingViewport,
): FloatingPoint {
  const rx = clamp01(toFiniteNumber(rel?.rx, 1))
  const ry = clamp01(toFiniteNumber(rel?.ry, 1))
  return { x: rx * viewport.w, y: ry * viewport.h }
}

/**
 * 视口尺寸订阅。几何全部由它驱动，组件侧因此不需要任何 resize 分支。
 *
 * 走 vueuse 的 useWindowSize 而不是自己挂 resize 监听：布局 store 判定「视口是否放得下
 * 面板＝是否自动隐藏」用的是同一份来源，两处尺寸必须同源，否则工具栏开关的显示状态
 * 会和面板实际是否可见对不上。
 */
export function useFloatingChatViewport(): { viewport: ComputedRef<FloatingViewport> } {
  const { width, height } = useWindowSize()
  const viewport = computed<FloatingViewport>(() => ({ w: width.value, h: height.value }))
  return { viewport }
}
