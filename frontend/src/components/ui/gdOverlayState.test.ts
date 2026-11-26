import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireOverlayZIndex, lockBodyScroll, unlockBodyScroll } from './gdOverlayState'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('浮层共享状态', () => {
  it('不同实例及重复打开共用层级序列', () => {
    const detail = acquireOverlayZIndex()
    const reopenedDetail = acquireOverlayZIndex()
    const install = acquireOverlayZIndex()
    const drawer = acquireOverlayZIndex()
    expect(reopenedDetail).toBeGreaterThan(detail)
    expect(install).toBeGreaterThan(reopenedDetail)
    expect(drawer).toBeGreaterThan(install)
  })

  it.each(['', 'auto', 'clip'])('最后一个浮层退出后恢复原 overflow=%j', (overflow) => {
    const body = { style: { overflow } }
    vi.stubGlobal('document', { body })
    lockBodyScroll()
    lockBodyScroll()
    expect(body.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(body.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(body.style.overflow).toBe(overflow)
    // 多余的释放不能用上一次的状态覆盖页面样式。
    body.style.overflow = 'scroll'
    unlockBodyScroll()
    expect(body.style.overflow).toBe('scroll')
  })

  it('无 DOM 时可以安全调用', () => {
    vi.stubGlobal('document', undefined)
    expect(() => {
      lockBodyScroll()
      unlockBodyScroll()
    }).not.toThrow()
  })
})
