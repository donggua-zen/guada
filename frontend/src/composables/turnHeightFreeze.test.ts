import { afterEach, describe, expect, it } from 'vitest'
import { freezeTurnHeights, releaseTurnHeights } from './turnHeightFreeze'

/**
 * 回合高度冻结：拖拽/缩放前把每个回合的真实高度写进内联 contain-intrinsic-size，
 * 让 `content-visibility` 生效时布局高度完全不变。
 *
 * 这些用例用最小 DOM 桩覆盖：
 * - 读高度用 getBoundingClientRect（一遍读完再写，避免读写交替触发多次强制布局）
 * - 释放时清掉内联属性
 * - 没有回合 / 没有 document 时不抛错
 */

interface FakeTurn {
  height: number
  style: {
    containIntrinsicSize: string
    removeProperty: (name: string) => void
  }
  getBoundingClientRect: () => { height: number }
}

function makeTurn(height: number): FakeTurn {
  const style = {
    containIntrinsicSize: '',
    removeProperty(name: string) {
      if (name === 'contain-intrinsic-size') style.containIntrinsicSize = ''
    },
  }
  return {
    height,
    style,
    getBoundingClientRect: () => ({ height }),
  }
}

function installDocument(turns: FakeTurn[], onQuery?: () => void): void {
  ;(globalThis as { document?: unknown }).document = {
    querySelectorAll(selector: string) {
      onQuery?.()
      return selector === '.turn-wrapper' ? turns : []
    },
  }
}

describe('freezeTurnHeights / releaseTurnHeights', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document
  })

  it('把每个回合的实测高度写进 contain-intrinsic-size', () => {
    const turns = [makeTurn(1486), makeTurn(402.5), makeTurn(1733)]
    installDocument(turns)

    freezeTurnHeights()

    expect(turns[0].style.containIntrinsicSize).toBe('1486px')
    expect(turns[1].style.containIntrinsicSize).toBe('402.5px')
    expect(turns[2].style.containIntrinsicSize).toBe('1733px')
  })

  it('先全部读、再全部写：读与写不交替（避免每个元素各触发一次强制布局）', () => {
    const events: string[] = []
    const turns = [0, 1, 2].map((i) => {
      const t = makeTurn(100 + i)
      const original = t.getBoundingClientRect
      t.getBoundingClientRect = () => {
        events.push(`read${i}`)
        return original()
      }
      const csSetter = Object.getOwnPropertyDescriptor(t.style, 'containIntrinsicSize')
      let value = ''
      Object.defineProperty(t.style, 'containIntrinsicSize', {
        get: () => value,
        set: (v: string) => {
          events.push(`write${i}`)
          value = v
        },
        configurable: true,
        ...(csSetter ? {} : {}),
      })
      return t
    })
    installDocument(turns)

    freezeTurnHeights()

    // 关键：三个 read 全部排在 write 之前
    expect(events).toEqual(['read0', 'read1', 'read2', 'write0', 'write1', 'write2'])
  })

  it('释放时清掉内联属性', () => {
    const turns = [makeTurn(1000), makeTurn(1200)]
    installDocument(turns)
    freezeTurnHeights()
    expect(turns[0].style.containIntrinsicSize).toBe('1000px')

    releaseTurnHeights()

    expect(turns[0].style.containIntrinsicSize).toBe('')
    expect(turns[1].style.containIntrinsicSize).toBe('')
  })

  it('没有回合时不做事，也不抛错', () => {
    installDocument([])
    expect(() => freezeTurnHeights()).not.toThrow()
    expect(() => releaseTurnHeights()).not.toThrow()
  })

  it('没有 document（SSR / node 环境）时不抛错', () => {
    expect(typeof document).toBe('undefined')
    expect(() => freezeTurnHeights()).not.toThrow()
    expect(() => releaseTurnHeights()).not.toThrow()
  })
})
