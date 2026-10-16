import { describe, it, expect } from 'vitest'
import {
  FLOATING_CHAT_CONTENT_DRAG_ROW_H,
  FLOATING_CHAT_DEFAULT_H,
  FLOATING_CHAT_DEFAULT_W,
  FLOATING_CHAT_MARGIN,
  FLOATING_CHAT_MIN_H,
  FLOATING_CHAT_MIN_W,
  FLOATING_CHAT_TITLEBAR_H,
  clampAnchor,
  clampSize,
  fromRelative,
  panelFits,
  resolveResize,
  resolveTopReserve,
  toRelative,
  usableArea,
  type FloatingRect,
  type FloatingResizeEdge,
} from './useFloatingChatPanel'

/**
 * 悬浮对话面板几何约束测试
 *
 * 这些函数是从 FloatingChatPanel.vue 抽出来的：旧实现把它们内联在组件里，
 * 而「尺寸下限」在样式（min-width）与 JS（放不下判定）各写了一份，两边不一致
 * 导致窄窗口下把面板推出屏幕。下面第 2、4 组用例专门锁这个回归。
 */

const V = (w: number, h: number) => ({ w, h })
const S = (w: number, h: number) => ({ w, h })

/** 常见桌面视口：1920x1080，无标题栏预留 */
const DESKTOP = V(1920, 1080)

/** 默认停车位：面板 430x700 贴在 1920x1080 视口的右下角 */
const PARKED: FloatingRect = {
  left: DESKTOP.w - FLOATING_CHAT_MARGIN - FLOATING_CHAT_DEFAULT_W,
  top: DESKTOP.h - FLOATING_CHAT_MARGIN - FLOATING_CHAT_DEFAULT_H,
  right: DESKTOP.w - FLOATING_CHAT_MARGIN,
  bottom: DESKTOP.h - FLOATING_CHAT_MARGIN,
}

/** 返回结果矩形，便于断言"哪条边动了、哪条边没动" */
function resize(
  edge: FloatingResizeEdge,
  dx: number,
  dy: number,
  start: FloatingRect = PARKED,
  reserveTop = 0,
): FloatingRect {
  const { size, anchor } = resolveResize(edge, { x: dx, y: dy }, start, DESKTOP, reserveTop)
  return {
    left: anchor.x - size.w,
    top: anchor.y - size.h,
    right: anchor.x,
    bottom: anchor.y,
  }
}

describe('usableArea', () => {
  it('四周留白，顶部再让开标题栏', () => {
    expect(usableArea(DESKTOP, 0)).toEqual({
      left: FLOATING_CHAT_MARGIN,
      top: FLOATING_CHAT_MARGIN,
      right: 1920 - FLOATING_CHAT_MARGIN,
      bottom: 1080 - FLOATING_CHAT_MARGIN,
    })
    expect(usableArea(DESKTOP, FLOATING_CHAT_TITLEBAR_H).top).toBe(
      FLOATING_CHAT_MARGIN + FLOATING_CHAT_TITLEBAR_H,
    )
  })

  it('视口小于两倍留白时右/下边界不倒退到左/上边界之前', () => {
    const area = usableArea(V(4, 4), 0)
    expect(area.right).toBeGreaterThanOrEqual(area.left)
    expect(area.bottom).toBeGreaterThanOrEqual(area.top)
  })
})

describe('clampSize', () => {
  it('放得下时原样保留', () => {
    expect(clampSize(S(FLOATING_CHAT_DEFAULT_W, FLOATING_CHAT_DEFAULT_H), DESKTOP, 0)).toEqual({
      w: FLOATING_CHAT_DEFAULT_W,
      h: FLOATING_CHAT_DEFAULT_H,
    })
  })

  it('小于下限时抬到下限', () => {
    expect(clampSize(S(100, 100), DESKTOP, 0)).toEqual({
      w: FLOATING_CHAT_MIN_W,
      h: FLOATING_CHAT_MIN_H,
    })
  })

  it('大于可用区域时收到可用区域', () => {
    expect(clampSize(S(5000, 5000), V(1024, 768), 0)).toEqual({ w: 1024 - 16, h: 768 - 16 })
  })

  it('视口比下限还小时以「不溢出」为准（旧实现溢出屏幕的回归）', () => {
    // 300x400：可用区 284x384。宽度必须收到 284 而不是坚持 320；
    // 高度下限 320 < 384，所以 700 的默认高被压到 384
    const size = clampSize(S(FLOATING_CHAT_DEFAULT_W, FLOATING_CHAT_DEFAULT_H), V(300, 400), 0)
    expect(size.w).toBe(300 - FLOATING_CHAT_MARGIN * 2)
    expect(size.w).toBeLessThan(FLOATING_CHAT_MIN_W)
    expect(size.h).toBe(400 - FLOATING_CHAT_MARGIN * 2)
  })

  it('预留标题栏时高度上限随之收紧', () => {
    const size = clampSize(S(430, 5000), V(1024, 800), FLOATING_CHAT_TITLEBAR_H)
    expect(size.h).toBe(800 - FLOATING_CHAT_MARGIN * 2 - FLOATING_CHAT_TITLEBAR_H)
  })

  it('结果一律是整 CSS px', () => {
    const size = clampSize(S(430.6, 700.4), V(1000.5, 900.5), 0)
    expect(Number.isInteger(size.w)).toBe(true)
    expect(Number.isInteger(size.h)).toBe(true)
  })
})

describe('panelFits', () => {
  it('可用区域恰好等于下限时判定放得下', () => {
    expect(panelFits(V(FLOATING_CHAT_MIN_W + FLOATING_CHAT_MARGIN * 2, 900), 0)).toBe(true)
    expect(panelFits(V(FLOATING_CHAT_MIN_W + FLOATING_CHAT_MARGIN * 2 - 1, 900), 0)).toBe(false)
  })

  it('高度不足时判定放不下', () => {
    expect(panelFits(V(1920, FLOATING_CHAT_MIN_H + FLOATING_CHAT_MARGIN * 2), 0)).toBe(true)
    expect(panelFits(V(1920, FLOATING_CHAT_MIN_H + FLOATING_CHAT_MARGIN * 2 - 1), 0)).toBe(false)
  })

  it('标题栏预留会吃掉高度预算', () => {
    const h = FLOATING_CHAT_MIN_H + FLOATING_CHAT_MARGIN * 2
    expect(panelFits(V(1920, h), 0)).toBe(true)
    expect(panelFits(V(1920, h), FLOATING_CHAT_TITLEBAR_H)).toBe(false)
  })
})

describe('clampAnchor', () => {
  it('越界锚点回推到右下角', () => {
    const anchor = clampAnchor({ x: 99999, y: 99999 }, S(430, 700), DESKTOP, 0)
    expect(anchor).toEqual({ x: 1920 - FLOATING_CHAT_MARGIN, y: 1080 - FLOATING_CHAT_MARGIN })
  })

  it('越界锚点回推到左上角，并让开标题栏', () => {
    const anchor = clampAnchor({ x: -999, y: -999 }, S(430, 700), DESKTOP, 0)
    expect(anchor).toEqual({
      x: FLOATING_CHAT_MARGIN + 430,
      y: FLOATING_CHAT_MARGIN + 700,
    })
    const withTitlebar = clampAnchor({ x: -999, y: -999 }, S(430, 700), DESKTOP, FLOATING_CHAT_TITLEBAR_H)
    expect(withTitlebar.y).toBe(FLOATING_CHAT_MARGIN + FLOATING_CHAT_TITLEBAR_H + 700)
  })

  it('锚点在可用区域内时保持不动', () => {
    expect(clampAnchor({ x: 1000, y: 800 }, S(430, 700), DESKTOP, 0)).toEqual({ x: 1000, y: 800 })
  })

  it('视口比面板还窄时锚点仍不出界（right/bottom 非负）', () => {
    const viewport = V(300, 900)
    const size = S(FLOATING_CHAT_DEFAULT_W, FLOATING_CHAT_DEFAULT_H)
    const anchor = clampAnchor({ x: 300, y: 900 }, size, viewport, 0)
    // 旧实现此处算出 right: -28px，把面板推到屏幕外
    expect(viewport.w - anchor.x).toBeGreaterThanOrEqual(0)
    expect(viewport.h - anchor.y).toBeGreaterThanOrEqual(0)
    // 同时左上角也不能出界
    expect(anchor.x - clampSize(size, viewport, 0).w).toBeGreaterThanOrEqual(0)
    expect(anchor.y - clampSize(size, viewport, 0).h).toBeGreaterThanOrEqual(0)
  })

  it('传入的尺寸小于面板下限时不被抬到下限（钳位只管边界，不管面板策略）', () => {
    const viewport = V(1920, 1080)
    const small = { w: 104, h: 32 }
    expect(clampAnchor({ x: 0, y: 0 }, small, viewport, 0)).toEqual({
      x: FLOATING_CHAT_MARGIN + small.w,
      y: FLOATING_CHAT_MARGIN + small.h,
    })
  })
})

describe('toRelative / fromRelative', () => {
  it('像素锚点与相对坐标可往返', () => {
    const anchor = { x: 1200, y: 900 }
    const rel = toRelative(anchor, DESKTOP)
    expect(rel).toEqual({ rx: 1200 / 1920, ry: 900 / 1080 })
    expect(fromRelative(rel, DESKTOP)).toEqual({ x: 1200, y: 900 })
  })

  it('窗口尺寸变化后按比例跟随', () => {
    const rel = toRelative({ x: 960, y: 540 }, V(1920, 1080))
    expect(fromRelative(rel, V(1280, 720))).toEqual({ x: 640, y: 360 })
  })

  it('脏值一律收敛回右下角默认', () => {
    const fallback = { x: DESKTOP.w, y: DESKTOP.h }
    expect(fromRelative(null, DESKTOP)).toEqual(fallback)
    expect(fromRelative(undefined, DESKTOP)).toEqual(fallback)
    expect(fromRelative({ rx: Number.NaN, ry: Number.NaN }, DESKTOP)).toEqual(fallback)
  })

  it('相对坐标越界时夹回 0~1（localStorage 是外部输入）', () => {
    expect(fromRelative({ rx: 5, ry: -3 }, DESKTOP)).toEqual({ x: DESKTOP.w, y: 0 })
    expect(toRelative({ x: 99999, y: -99999 }, DESKTOP)).toEqual({ rx: 1, ry: 0 })
  })

  it('视口为 0 时 toRelative 不回落到 NaN', () => {
    expect(toRelative({ x: 100, y: 100 }, V(0, 0))).toEqual({ rx: 1, ry: 1 })
  })
})

describe('resolveTopReserve', () => {
  it('Windows / Linux：预留独立标题栏行，内容区不再是拖拽区', () => {
    expect(resolveTopReserve({ isElectron: true, isMac: false })).toBe(FLOATING_CHAT_TITLEBAR_H)
  })

  it('macOS：无独立标题栏行，预留内容首行（那一行保留 drag-region）', () => {
    expect(resolveTopReserve({ isElectron: true, isMac: true })).toBe(FLOATING_CHAT_CONTENT_DRAG_ROW_H)
  })

  it('Web：app-region 无效，不预留', () => {
    expect(resolveTopReserve({ isElectron: false, isMac: false })).toBe(0)
  })

  it('mac 预留比 Windows 标题栏高（内容首行 40 > h-9）', () => {
    expect(FLOATING_CHAT_CONTENT_DRAG_ROW_H).toBeGreaterThan(FLOATING_CHAT_TITLEBAR_H)
  })

  it('预留带生效后浮窗顶边落在拖拽区之下', () => {
    const reserve = resolveTopReserve({ isElectron: true, isMac: true })
    const start: FloatingRect = {
      left: 1482, top: 372, right: 1912, bottom: 1072,
    }
    // 上缘一路拖到顶：顶边仍须 >= 留白 + 预留带
    const rect = resize('top', 0, -99999, start, reserve)
    expect(rect.top).toBeGreaterThanOrEqual(reserve)
  })
})

describe('resolveResize', () => {
  it('右缘向右拖：右缘跟随光标，左缘不动', () => {
    // 面板已贴右边距，无处可长 → 右缘停在边距上，尺寸不变
    expect(resize('right', 100, 0).right).toBe(PARKED.right)
    expect(resize('right', 100, 0).left).toBe(PARKED.left)

    // 先把面板挪离右边缘，再向右拖就是"变大"
    const moved: FloatingRect = { ...PARKED, right: PARKED.right - 300, left: PARKED.left - 300 }
    const grown = resize('right', 120, 0, moved)
    expect(grown.right).toBe(moved.right + 120)
    expect(grown.left).toBe(moved.left)
  })

  it('右缘向左拖：缩小，且左缘保持不动（方向不能反）', () => {
    const narrowed = resize('right', -100, 0)
    expect(narrowed.right).toBe(PARKED.right - 100)
    expect(narrowed.left).toBe(PARKED.left)
  })

  it('右缘向左拖过下限：右缘停下，左缘仍然不动', () => {
    const narrowed = resize('right', -9999, 0)
    expect(narrowed.left).toBe(PARKED.left)
    expect(narrowed.right - narrowed.left).toBe(FLOATING_CHAT_MIN_W)
  })

  it('左缘向左拖：变大，右缘不动', () => {
    const grown = resize('left', -100, 0)
    expect(grown.left).toBe(PARKED.left - 100)
    expect(grown.right).toBe(PARKED.right)
  })

  it('左缘向右拖过下限：左缘停下，右缘仍然不动', () => {
    const narrowed = resize('left', 9999, 0)
    expect(narrowed.right).toBe(PARKED.right)
    expect(narrowed.right - narrowed.left).toBe(FLOATING_CHAT_MIN_W)
  })

  it('左缘拖到视口左边界为止', () => {
    const grown = resize('left', -9999, 0)
    expect(grown.left).toBe(FLOATING_CHAT_MARGIN)
    expect(grown.right).toBe(PARKED.right)
  })

  it('上缘向上拖：变高，下缘不动；下缘向下拖：变高，上缘不动', () => {
    const byTop = resize('top', 0, -100)
    expect(byTop.top).toBe(PARKED.top - 100)
    expect(byTop.bottom).toBe(PARKED.bottom)

    const byBottom = resize('bottom', 0, 9999)
    expect(byBottom.top).toBe(PARKED.top)
    expect(byBottom.bottom).toBe(PARKED.bottom)
  })

  it('上缘不能越过标题栏禁入区', () => {
    const grown = resize('top', 0, -9999, PARKED, FLOATING_CHAT_TITLEBAR_H)
    expect(grown.top).toBe(FLOATING_CHAT_MARGIN + FLOATING_CHAT_TITLEBAR_H)
  })

  it('拖一条边不影响另一轴的边与尺寸', () => {
    const byRight = resize('right', -100, 9999)
    expect(byRight.top).toBe(PARKED.top)
    expect(byRight.bottom).toBe(PARKED.bottom)

    const byBottom = resize('bottom', 9999, -100)
    expect(byBottom.left).toBe(PARKED.left)
    expect(byBottom.right).toBe(PARKED.right)
  })

  it('右下角拖向左上：右下两缘跟随光标，左上角不动', () => {
    const shrunk = resize('bottom-right', -100, -100)
    expect(shrunk.left).toBe(PARKED.left)
    expect(shrunk.top).toBe(PARKED.top)
    expect(shrunk.right).toBe(PARKED.right - 100)
    expect(shrunk.bottom).toBe(PARKED.bottom - 100)
  })

  it('左上角拖向左上：变大，对角（右下角）不动', () => {
    const grown = resize('top-left', -100, -100)
    expect(grown.right).toBe(PARKED.right)
    expect(grown.bottom).toBe(PARKED.bottom)
    expect(grown.left).toBe(PARKED.left - 100)
    expect(grown.top).toBe(PARKED.top - 100)
  })

  it('任何手柄 + 任意极端位移都不得越出可用区域或跌破下限', () => {
    const edges: FloatingResizeEdge[] = [
      'top', 'right', 'bottom', 'left',
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
    ]
    const deltas = [
      { x: -9999, y: -9999 },
      { x: 9999, y: 9999 },
      { x: -9999, y: 9999 },
      { x: 9999, y: -9999 },
    ]

    for (const edge of edges) {
      for (const delta of deltas) {
        const rect = resize(edge, delta.x, delta.y, PARKED, FLOATING_CHAT_TITLEBAR_H)
        const area = usableArea(DESKTOP, FLOATING_CHAT_TITLEBAR_H)
        const label = `${edge} ${JSON.stringify(delta)}`

        expect(rect.left, label).toBeGreaterThanOrEqual(area.left)
        expect(rect.top, label).toBeGreaterThanOrEqual(area.top)
        expect(rect.right, label).toBeLessThanOrEqual(area.right)
        expect(rect.bottom, label).toBeLessThanOrEqual(area.bottom)
        expect(rect.right - rect.left, label)
          .toBeGreaterThanOrEqual(Math.min(FLOATING_CHAT_MIN_W, area.right - area.left))
        expect(rect.bottom - rect.top, label)
          .toBeGreaterThanOrEqual(Math.min(FLOATING_CHAT_MIN_H, area.bottom - area.top))
      }
    }
  })
})
