import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginResizeActivity,
  isResizeActivityActive,
  resetResizeActivity,
  RESIZE_ACTIVITY_CLASS,
  RESIZE_ACTIVITY_TAIL_MS,
} from './useResizeActivity'

/**
 * 这些用例覆盖「引用计数 + 尾延迟」的核心语义。
 *
 * 测试环境是 node（见 vite.config.ts 的 test.environment），没有 DOM；这里装一个最小
 * document 桩，只实现本模块用到的 documentElement.classList.toggle。
 */

/** 记录 class 挂载状态的极简 DOM 桩 */
function installDocumentStub(): { hasClass: () => boolean } {
  const classes = new Set<string>()
  const stub = {
    documentElement: {
      classList: {
        toggle(name: string, force?: boolean) {
          const on = force ?? !classes.has(name)
          if (on) classes.add(name)
          else classes.delete(name)
          return on
        },
      },
    },
  }
  ;(globalThis as { document?: unknown }).document = stub
  return { hasClass: () => classes.has(RESIZE_ACTIVITY_CLASS) }
}

/**
 * 模块级绑定窗口 resize 的回归测试。
 *
 * 背景：最初 `bindWindowResize()` 只在 `useResizeActivity()` 里调用，但全项目消费方
 * 都只 import `beginResizeActivity` / `isResizeActivityActive`，没有一个组件调用
 * `useResizeActivity()` —— 窗口缩放时 `gd-resizing` 从不挂上，拖分割条正常、
 * 拖窗口毫无降级。现在改为模块加载即绑定。
 *
 * 这里用 `vi.resetModules()` + 重新 import 来验证「仅仅 import 模块」就完成绑定，
 * 不调用任何导出函数。
 */
describe('模块加载即绑定 window resize（回归）', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { document?: unknown }).document
  })

  it('仅 import 模块就会注册 resize 监听，且事件能激活调整态', async () => {
    vi.useFakeTimers()
    const listeners = new Map<string, Array<() => void>>()
    ;(globalThis as { window?: unknown }).window = {
      addEventListener(name: string, fn: () => void) {
        if (!listeners.has(name)) listeners.set(name, [])
        listeners.get(name)!.push(fn)
      },
    }
    // rAF 桩：同步执行回调（模块用 rAF 合并 resize 事件）
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (fn: (t: number) => void) => {
      fn(0)
      return 1
    }
    const doc = installDocumentStub()

    // 只 import，不调用任何导出函数
    vi.resetModules()
    const mod = await import('./useResizeActivity')

    const resizeListeners = listeners.get('resize') ?? []
    expect(resizeListeners.length).toBeGreaterThan(0)
    expect(doc.hasClass()).toBe(false)

    // 触发 resize：rAF 合并后应进入调整态并挂上 class
    for (const fn of resizeListeners) fn()
    expect(mod.isResizeActivityActive()).toBe(true)
    expect(doc.hasClass()).toBe(true)

    // 尾延迟后自动退出
    await vi.advanceTimersByTimeAsync(mod.RESIZE_ACTIVITY_TAIL_MS)
    expect(mod.isResizeActivityActive()).toBe(false)
    expect(doc.hasClass()).toBe(false)
  })
})

describe('useResizeActivity', () => {
  let hasClass: () => boolean

  beforeEach(() => {
    vi.useFakeTimers()
    hasClass = installDocumentStub().hasClass
    resetResizeActivity()
  })

  afterEach(() => {
    resetResizeActivity()
    vi.useRealTimers()
    delete (globalThis as { document?: unknown }).document
  })

  it('进入后立即激活，并挂上 html class', () => {
    const release = beginResizeActivity()
    expect(isResizeActivityActive()).toBe(true)
    expect(hasClass()).toBe(true)
    release()
  })

  it('释放后不立即退出：走尾延迟', () => {
    const release = beginResizeActivity()
    release()

    // 尾延迟内仍处于调整态（吸收后续事件）
    expect(isResizeActivityActive()).toBe(true)
    expect(hasClass()).toBe(true)

    vi.advanceTimersByTime(RESIZE_ACTIVITY_TAIL_MS)

    expect(isResizeActivityActive()).toBe(false)
    expect(hasClass()).toBe(false)
  })

  it('嵌套持有时内层释放不退出（外层仍占用）', () => {
    const outer = beginResizeActivity()
    const inner = beginResizeActivity()

    inner()
    vi.advanceTimersByTime(RESIZE_ACTIVITY_TAIL_MS * 3)

    expect(isResizeActivityActive()).toBe(true)
    expect(hasClass()).toBe(true)

    outer()
    vi.advanceTimersByTime(RESIZE_ACTIVITY_TAIL_MS)

    expect(isResizeActivityActive()).toBe(false)
    expect(hasClass()).toBe(false)
  })

  it('释放函数幂等：重复调用不会把计数减成负数', () => {
    const release = beginResizeActivity()
    const other = beginResizeActivity()

    release()
    release()
    release()

    // 另一个持有者还在，必须仍处于调整态
    expect(isResizeActivityActive()).toBe(true)

    other()
    vi.advanceTimersByTime(RESIZE_ACTIVITY_TAIL_MS)
    expect(isResizeActivityActive()).toBe(false)
  })

  it('尾延迟内再次进入会续期，不会中途闪退', () => {
    const first = beginResizeActivity()
    first()
    vi.advanceTimersByTime(RESIZE_ACTIVITY_TAIL_MS - 10)

    const second = beginResizeActivity()
    vi.advanceTimersByTime(10)

    // 原尾延迟到点，但新活动已续期
    expect(isResizeActivityActive()).toBe(true)

    second()
    vi.advanceTimersByTime(RESIZE_ACTIVITY_TAIL_MS)
    expect(isResizeActivityActive()).toBe(false)
  })

  it('reset 立即退出（不等待尾延迟）', () => {
    beginResizeActivity()
    resetResizeActivity()

    expect(isResizeActivityActive()).toBe(false)
    expect(hasClass()).toBe(false)
  })
})
