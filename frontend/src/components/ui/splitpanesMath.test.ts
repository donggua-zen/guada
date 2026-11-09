import { describe, expect, it } from 'vitest'
import {
  computePercentModeWidths,
  computePixelModeWidths,
  SPLITTER_SIZE,
} from './splitpanesMath'

/**
 * 分栏宽度计算的不变式：
 * 1. p1Px + p2Px 恒等于「容器宽 - 分割条」（不留缝、不溢出）；
 * 2. 两者都非负；
 * 3. 收起义必须能真正收到 0（不被最小宽钳回来）。
 */
describe('computePixelModeWidths', () => {
  it('pane2 定宽、pane1 吃剩余，两者相加等于可用宽', () => {
    const { p1Px, p2Px } = computePixelModeWidths(1000, 260)
    expect(p2Px).toBe(260)
    expect(p1Px).toBe(1000 - SPLITTER_SIZE - 260)
  })

  it('pane2 给 0 是收起信号：绕过 minPane2Size 完全收到 0', () => {
    // 这是「收起目录树、diff 占满」的关键路径：若被 min 顶回 160，收起就永远失效
    const { p1Px, p2Px } = computePixelModeWidths(1000, 0, { minPane2Size: 160 })
    expect(p2Px).toBe(0)
    expect(p1Px).toBe(1000 - SPLITTER_SIZE)
  })

  it('pane2 小于下限时被抬到 minPane2Size', () => {
    const { p2Px } = computePixelModeWidths(1000, 50, { minPane2Size: 160 })
    expect(p2Px).toBe(160)
  })

  it('容器放不下时优先保证 pane1 最小宽，pane2 让位', () => {
    // 容器 400：pane1 至少要 300 → pane2 最多 99
    const { p1Px, p2Px } = computePixelModeWidths(400, 260, { minPane1Size: 300 })
    expect(p2Px).toBe(99)
    expect(p1Px).toBe(300)
  })

  it('min 大于 max 时不会算出负数或溢出', () => {
    // 容器 300：pane1 至少要 280 → pane2 上限 19，但 minPane2Size 要 200
    const { p1Px, p2Px } = computePixelModeWidths(300, 260, {
      minPane1Size: 280,
      minPane2Size: 200,
    })
    expect(p2Px).toBe(19)
    expect(p1Px).toBe(280)
    expect(p1Px + p2Px).toBe(300 - SPLITTER_SIZE)
  })

  it('容器宽为 0 或负数时两个 pane 都是 0', () => {
    expect(computePixelModeWidths(0, 260)).toEqual({ p1Px: 0, p2Px: 0 })
    expect(computePixelModeWidths(1, 260)).toEqual({ p1Px: 0, p2Px: 0 })
    expect(computePixelModeWidths(-50, 260)).toEqual({ p1Px: 0, p2Px: 0 })
  })

  it('容器宽带小数时落整（避免文字按小数位置重采样）', () => {
    const { p1Px, p2Px } = computePixelModeWidths(1000.7, 260)
    expect(Number.isInteger(p1Px)).toBe(true)
    expect(Number.isInteger(p2Px)).toBe(true)
    expect(p1Px + p2Px).toBe(Math.round(1000.7) - SPLITTER_SIZE)
  })

  it('窗口缩放时 pane2 像素宽不变（固定侧不动）', () => {
    const wide = computePixelModeWidths(1400, 260)
    const narrow = computePixelModeWidths(900, 260)
    expect(wide.p2Px).toBe(260)
    expect(narrow.p2Px).toBe(260)
    expect(wide.p1Px).toBeGreaterThan(narrow.p1Px)
  })
})

describe('computePercentModeWidths', () => {
  it('按百分比分配，两者相加等于可用宽', () => {
    const { p1Px, p2Px } = computePercentModeWidths(1000, 75, { snapPane2ToEven: false })
    expect(p1Px).toBe(749)
    expect(p2Px).toBe(250)
    expect(p1Px + p2Px).toBe(1000 - SPLITTER_SIZE)
  })

  it('pane2 取偶数（让 .chat-column 的 mx-auto 余量为偶数）', () => {
    // 1001 - 1 = 1000 可用；75% = 750 → p2 = 250（已偶）
    // 用奇数可用宽触发修正：容器 1002 → available 1001，75% = 751 → p2 = 250
    const { p2Px } = computePercentModeWidths(1002, 75)
    expect(p2Px % 2).toBe(0)
  })

  it('应用 pane1 最小/最大百分比约束', () => {
    const { p1Px, p2Px } = computePercentModeWidths(1000, 10, { minSize: 30, maxSize: 85 })
    // 原始 10% 被抬到 30% 下限（≈300），随后偶数修正把 ±1px 让给 pane1
    expect(p1Px).toBeGreaterThanOrEqual(Math.round(999 * 0.3))
    expect(p1Px).toBeLessThanOrEqual(Math.round(999 * 0.85))
    expect(p2Px % 2).toBe(0)
    expect(p1Px + p2Px).toBe(999)
  })

  it('应用 pane2 像素最小约束', () => {
    const { p2Px } = computePercentModeWidths(1000, 95, { minPane2Size: 320 })
    expect(p2Px).toBeGreaterThanOrEqual(320)
  })

  it('折叠态（applyConstraints=false）不应用约束，可以完全折叠', () => {
    const collapsed = computePercentModeWidths(1000, 100, { applyConstraints: false })
    expect(collapsed.p2Px).toBe(0)
    expect(collapsed.p1Px).toBe(999)
  })

  it('容器宽为 0 时两个 pane 都是 0', () => {
    expect(computePercentModeWidths(0, 75)).toEqual({ p1Px: 0, p2Px: 0 })
  })
})
