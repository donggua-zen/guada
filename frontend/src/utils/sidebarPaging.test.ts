import { describe, expect, it } from 'vitest'
import { resolveSidebarPageSize } from './sidebarPaging'

describe('resolveSidebarPageSize', () => {
  it('少量分组保持每组 10 条', () => {
    expect(resolveSidebarPageSize(1)).toBe(10)
    expect(resolveSidebarPageSize(3)).toBe(10)
  })

  it('4~6 个分组收敛到 7 条', () => {
    expect(resolveSidebarPageSize(4)).toBe(7)
    expect(resolveSidebarPageSize(5)).toBe(7)
    expect(resolveSidebarPageSize(6)).toBe(7)
  })

  it('7 个及以上分组收敛到 5 条', () => {
    expect(resolveSidebarPageSize(7)).toBe(5)
    expect(resolveSidebarPageSize(20)).toBe(5)
    expect(resolveSidebarPageSize(500)).toBe(5)
  })

  it('分界点两侧取值互不重叠', () => {
    expect(resolveSidebarPageSize(3)).toBeGreaterThan(resolveSidebarPageSize(4))
    expect(resolveSidebarPageSize(6)).toBeGreaterThan(resolveSidebarPageSize(7))
  })

  it('非法输入兜底为最大档位（宁可多显示也不显示 0 条）', () => {
    expect(resolveSidebarPageSize(0)).toBe(10)
    expect(resolveSidebarPageSize(-3)).toBe(10)
    expect(resolveSidebarPageSize(Number.NaN)).toBe(10)
    expect(resolveSidebarPageSize(Number.POSITIVE_INFINITY)).toBe(10)
  })

  it('小数向下取整后按整数档位判定', () => {
    expect(resolveSidebarPageSize(3.9)).toBe(10)
    expect(resolveSidebarPageSize(4.1)).toBe(7)
    expect(resolveSidebarPageSize(6.9)).toBe(7)
  })
})
