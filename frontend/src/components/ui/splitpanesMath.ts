/**
 * 分栏像素宽度计算（纯函数，无 Vue/DOM 依赖，便于单测）。
 *
 * 从 GdSplitpanes 抽出：两种模式的计算都是「容器可用宽 → 两个 pane 的整像素宽」，
 * 逻辑密度高且边界多（收起、最小宽、放不下时让位），单独成模块才能被测试覆盖。
 */

/** 分割条厚度（px）：两个 pane 之外固定占位，必须从可用宽里扣掉。 */
export const SPLITTER_SIZE = 1

export interface PaneWidths {
  /** pane1（通常是弹性侧）的整像素宽 */
  p1Px: number
  /** pane2（通常是固定侧）的整像素宽 */
  p2Px: number
}

export interface PixelModeConstraints {
  /** pane1 最小像素宽：pane2 让位以保证它不被压没 */
  minPane1Size?: number
  /** pane2 最小像素宽 */
  minPane2Size?: number
}

/**
 * 像素模式：pane2 定宽、pane1 吃剩余空间。
 *
 * 与百分比模式的差异只在「谁是自变量」：这里 pane2 是输入，pane1 由剩余空间推出，
 * 因此窗口缩放时固定侧纹丝不动、弹性侧自然伸缩——父组件不需要把像素换算成百分比
 * 再喂回来（那会形成 containerWidth → pct → width 的每帧往返）。
 *
 * 边界约定：
 * - `pane2Px <= 0` 是**收起**信号，必须绕过 `minPane2Size`（否则最小宽会把 0 顶回来，
 *   「收起右侧栏、左侧占满」永远失效）；
 * - 容器放不下时优先保证 pane1 的最小宽，宁可压窄 pane2 也不溢出容器；
 * - 结果恒满足 `p1Px + p2Px === available`，不留缝、不溢出。
 */
export function computePixelModeWidths(
  containerWidth: number,
  pane2Px: number,
  constraints: PixelModeConstraints = {},
): PaneWidths {
  const available = Math.round(containerWidth) - SPLITTER_SIZE
  if (available <= 0) return { p1Px: 0, p2Px: 0 }

  // 收起信号：绕开最小宽钳制
  if (Math.round(pane2Px) <= 0) return { p1Px: available, p2Px: 0 }

  const minPane1 = Math.max(0, Math.round(constraints.minPane1Size ?? 0))
  const minPane2 = Math.max(0, Math.round(constraints.minPane2Size ?? 0))

  // 上限：给 pane1 留出最小宽度
  const p2Max = Math.max(0, available - minPane1)
  // 下限先被上限钳制，避免 min > max 时算出负数
  const p2Min = Math.min(minPane2, p2Max)

  const p2 = Math.min(Math.max(Math.round(pane2Px), p2Min), p2Max)

  return { p1Px: Math.max(0, available - p2), p2Px: Math.max(0, p2) }
}

/**
 * 百分比模式：按 pane1 百分比计算，全程取整。
 *
 * 全程取整的理由：ResizeObserver 在缩放/DPI 下给的容器宽带小数，若 pane 宽跟着小数，
 * pane2（对话列所在）内的 .chat-column 是 mx-auto 居中（max-width 744）→ 左边缘落在
 * 小数 x 上，整列文字与图标都会按小数位置重采样。所有中间量先落整 CSS px，
 * 尾部再用「pane2 = available − pane1」保证两者相加恒等于可用宽。
 */
export function computePercentModeWidths(
  containerWidth: number,
  pane1Percent: number,
  options: {
    /** 是否应用约束（折叠状态时不应用，否则无法完全折叠） */
    applyConstraints?: boolean
    minSize?: number
    maxSize?: number
    minPane2Size?: number
    /** pane2 取偶数的理由见 GdSplitpanes 原注释；默认开启 */
    snapPane2ToEven?: boolean
  } = {},
): PaneWidths {
  const available = Math.round(containerWidth) - SPLITTER_SIZE
  if (available <= 0) return { p1Px: 0, p2Px: 0 }

  let p1Px = Math.round((available * pane1Percent) / 100)
  let p2Px = available - p1Px

  if (options.applyConstraints !== false) {
    const maxSize = options.maxSize ?? 100
    const minSize = options.minSize ?? 0

    // pane2 最小约束：百分比（来自 maxSize）+ 像素
    let p2Min = 0
    const p2MinPct = 100 - maxSize
    if (p2MinPct > 0) p2Min = Math.max(p2Min, Math.round((available * p2MinPct) / 100))
    if ((options.minPane2Size ?? 0) > 0) p2Min = Math.max(p2Min, Math.round(options.minPane2Size!))

    if (p2Min > 0 && p2Px < p2Min) {
      p2Px = Math.min(p2Min, available)
      p1Px = available - p2Px
    }

    // pane1 最小/最大约束
    const p1Min = Math.round((available * minSize) / 100)
    const p1Max = Math.round((available * maxSize) / 100)
    if (p1Px < p1Min) {
      p1Px = p1Min
      p2Px = available - p1Px
    }
    if (p1Px > p1Max) {
      p1Px = p1Max
      p2Px = available - p1Px
    }

    // pane2 取偶数：px-5（40）、避让占位（268）、列宽（744）都是偶数，只有 pane2 偶数
    // 才能让 .chat-column 的 mx-auto 余量为偶数、左边缘落整像素。±1px 修正，
    // 两侧都触界时保持原值（硬约束优先于奇偶）。
    if ((options.snapPane2ToEven ?? true) && p2Px % 2 !== 0) {
      if (available - (p1Px + 1) >= p2Min && p1Px + 1 <= p1Max) p1Px += 1
      else if (p1Px - 1 >= p1Min) p1Px -= 1
      p2Px = available - p1Px
    }
  }

  return { p1Px: Math.max(0, p1Px), p2Px: Math.max(0, p2Px) }
}
