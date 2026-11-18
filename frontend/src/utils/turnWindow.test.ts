import { describe, it, expect } from 'vitest'
import {
  distanceToViewport,
  planTurnWindow,
  resolvePlaceholderHeight,
  type MountedTurnGeometry,
} from './turnWindow'

/** 构造一个顶部在 top、高 height 的回合几何 */
function turn(id: string, top: number, height = 1000): MountedTurnGeometry {
  return { id, top, bottom: top + height, height }
}

const VIEWPORT = 800

describe('distanceToViewport', () => {
  it('视口内相交时为 0', () => {
    expect(distanceToViewport(turn('a', 100), VIEWPORT)).toBe(0)
    expect(distanceToViewport(turn('a', -500, 1000), VIEWPORT)).toBe(0)
  })

  it('上方离屏返回到视口顶的距离', () => {
    expect(distanceToViewport(turn('a', -1000, 400), VIEWPORT)).toBe(600)
  })

  it('下方离屏返回到视口底的距离', () => {
    expect(distanceToViewport(turn('a', 1800, 400), VIEWPORT)).toBe(1000)
  })
})

describe('planTurnWindow', () => {
  it('滞回区内的回合不卸载', () => {
    const entries = [
      turn('above', -1000), // 视口上方 1000px，仍在 2400 滞回区内
      turn('in', 0),
      turn('below', 3000), // 视口下方 2200px，仍在滞回区内
    ]
    const plan = planTurnWindow(entries, {
      viewportHeight: VIEWPORT,
      keepMarginPx: 2400,
      maxMounted: 24,
    })
    expect(plan.unmount).toHaveLength(0)
    expect(plan.remaining).toBe(3)
  })

  it('完全离开滞回区的回合被卸载', () => {
    const entries = [
      turn('far-above', -5000),
      turn('in', 0),
      turn('far-below', 6000),
    ]
    const plan = planTurnWindow(entries, {
      viewportHeight: VIEWPORT,
      keepMarginPx: 2400,
      maxMounted: 24,
    })
    expect(plan.unmount.map((e) => e.id)).toEqual(['far-below', 'far-above'])
    expect(plan.remaining).toBe(1)
  })

  it('保护区（尾部/流式回合）永不卸载，即使离视口很远', () => {
    const entries = [turn('far-above', -9000), turn('in', 0), turn('tail', 20000)]
    const plan = planTurnWindow(entries, {
      viewportHeight: VIEWPORT,
      keepMarginPx: 2400,
      maxMounted: 24,
      protectedIds: new Set(['tail']),
    })
    expect(plan.unmount.map((e) => e.id)).toEqual(['far-above'])
    expect(plan.remaining).toBe(2)
  })

  it('全部落在滞回区内时按上限从最远处卸载，保证有界', () => {
    // 20 个 1000px 回合紧挨着排布，滞回区足够大、但上限是 6
    const entries = Array.from({ length: 20 }, (_, i) => turn(`t${i}`, i * 1000))
    const plan = planTurnWindow(entries, {
      viewportHeight: VIEWPORT,
      keepMarginPx: 100000,
      maxMounted: 6,
    })
    expect(plan.remaining).toBe(6)
    expect(plan.unmount).toHaveLength(14)
    // 视口内（t0）必须保留
    expect(plan.unmount.some((e) => e.id === 't0')).toBe(false)
  })

  it('上限不足以覆盖保护区时，保护区仍全部保留', () => {
    const entries = [turn('a', -9000), turn('b', 9000), turn('c', 18000)]
    const plan = planTurnWindow(entries, {
      viewportHeight: VIEWPORT,
      keepMarginPx: 2400,
      maxMounted: 1,
      protectedIds: new Set(['a', 'b', 'c']),
    })
    expect(plan.unmount).toHaveLength(0)
    expect(plan.remaining).toBe(3)
  })

  it('卸载列表按离视口由远到近排序', () => {
    // 两者都已离开 2400px 滞回区（近处底边 -2000 - 1000 = -3000 < -2400）
    const entries = [turn('near', -4000), turn('far', -12000)]
    const plan = planTurnWindow(entries, {
      viewportHeight: VIEWPORT,
      keepMarginPx: 2400,
      maxMounted: 24,
    })
    expect(plan.unmount.map((e) => e.id)).toEqual(['far', 'near'])
  })

  it('空列表不产生卸载', () => {
    const plan = planTurnWindow([], {
      viewportHeight: VIEWPORT,
      keepMarginPx: 2400,
      maxMounted: 24,
    })
    expect(plan).toEqual({ unmount: [], remaining: 0 })
  })
})

describe('resolvePlaceholderHeight', () => {
  it('有实测值时使用实测值', () => {
    expect(resolvePlaceholderHeight(1732.6, 800)).toBe(1733)
  })

  it('没有实测值时回落到估算值', () => {
    expect(resolvePlaceholderHeight(undefined, 800)).toBe(800)
  })

  it('实测值非法时回落到估算值', () => {
    expect(resolvePlaceholderHeight(0, 160)).toBe(160)
    expect(resolvePlaceholderHeight(Number.NaN, 160)).toBe(160)
    expect(resolvePlaceholderHeight(-10, 160)).toBe(160)
  })
})
