import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOTTOM_ANCHOR_EPSILON_PX,
  distanceToBottom,
  initialFollowing,
  isAtBottom,
  keyboardScrollIntent,
  reconcileFollowingForContentAnchor,
  resolveFollowingAfterContentShrink,
  resolveFollowingAfterScroll,
  shouldShowBackToBottom,
  shouldTriggerLoadOlder,
  touchScrollIntent,
  useScrollAnchor,
  wheelScrollIntent,
  type ScrollMetrics,
} from './useScrollAnchor'

/** 构造滚动指标：距底距离 = distanceToBottomPx。 */
function metricsAt(distanceFromBottomPx: number, viewportHeight = 600): ScrollMetrics {
  const contentHeight = 2000
  return {
    contentHeight,
    viewportHeight,
    scrollTop: contentHeight - viewportHeight - distanceFromBottomPx,
  }
}

describe('distanceToBottom / isAtBottom', () => {
  it('距底距离按 contentHeight - viewportHeight - scrollTop 计算', () => {
    expect(distanceToBottom({ scrollTop: 100, viewportHeight: 400, contentHeight: 1000 })).toBe(500)
  })

  it('内容不足一屏时距离下限为 0（不出现负数）', () => {
    expect(distanceToBottom({ scrollTop: 0, viewportHeight: 900, contentHeight: 500 })).toBe(0)
  })

  it('epsilon 边界：47 算贴底、48 算贴底、49 不算', () => {
    expect(isAtBottom(metricsAt(BOTTOM_ANCHOR_EPSILON_PX - 1))).toBe(true)
    expect(isAtBottom(metricsAt(BOTTOM_ANCHOR_EPSILON_PX))).toBe(true)
    expect(isAtBottom(metricsAt(BOTTOM_ANCHOR_EPSILON_PX + 1))).toBe(false)
  })

  it('自定义 epsilon 生效', () => {
    expect(isAtBottom(metricsAt(10), 5)).toBe(false)
    expect(isAtBottom(metricsAt(4), 5)).toBe(true)
  })
})

describe('resolveFollowingAfterScroll', () => {
  it('布局/程序化滚动不得改变用户意图（跟随保持跟随）', () => {
    expect(
      resolveFollowingAfterScroll({ following: true, metrics: metricsAt(500), source: 'layout' }),
    ).toBe(true)
  })

  it('布局/程序化滚动不得改变用户意图（解除保持解除）', () => {
    expect(
      resolveFollowingAfterScroll({ following: false, metrics: metricsAt(0), source: 'layout' }),
    ).toBe(false)
  })

  it('用户滚到离底 → 解除跟随', () => {
    expect(
      resolveFollowingAfterScroll({ following: true, metrics: metricsAt(120), source: 'user' }),
    ).toBe(false)
  })

  it('用户滚回贴底 → 恢复跟随', () => {
    expect(
      resolveFollowingAfterScroll({ following: false, metrics: metricsAt(10), source: 'user' }),
    ).toBe(true)
  })
})

describe('reconcileFollowingForContentAnchor', () => {
  it('明确上滚意图 → 立即解除（同帧布局 commit 必须让位）', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metricsAt(0),
        lastObservedScrollTop: 1400,
        userScrollIntent: 'awayFromBottom',
      }),
    ).toBe(false)
  })

  it('无用户输入 → 原样保持（布局导致的 scrollTop 回退不算上滚）', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metricsAt(800),
        lastObservedScrollTop: 1200,
        userScrollIntent: 'none',
      }),
    ).toBe(true)
  })

  it('意图未知但落点在底 → 恢复跟随', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: false,
        metrics: metricsAt(0),
        lastObservedScrollTop: 1400,
        userScrollIntent: 'unknown',
      }),
    ).toBe(true)
  })

  it('意图未知且 scrollTop 明显回退 → 按未观察上滚解除', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: { scrollTop: 500, viewportHeight: 600, contentHeight: 3000 },
        lastObservedScrollTop: 900,
        userScrollIntent: 'unknown',
      }),
    ).toBe(false)
  })

  it('viewportShrank：容器缩小把 scrollTop 向下钳制，不算用户上滚（保持跟随）', () => {
    // 视口从 900 缩到 600，scrollTop 被钳到 1300 → 仍贴底
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: { scrollTop: 1300, viewportHeight: 600, contentHeight: 2200 },
        lastObservedScrollTop: 1500,
        userScrollIntent: 'unknown',
        viewportShrank: true,
      }),
    ).toBe(true)
  })

  it('viewportShrank 只豁免该轮：容器未再变小时仍按上滚解除', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: { scrollTop: 500, viewportHeight: 600, contentHeight: 3000 },
        lastObservedScrollTop: 900,
        userScrollIntent: 'unknown',
        viewportShrank: false,
      }),
    ).toBe(false)
  })

  it('意图未知且回退在亚像素容差内 → 保持', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: { scrollTop: 899, viewportHeight: 600, contentHeight: 3000 },
        lastObservedScrollTop: 900,
        userScrollIntent: 'unknown',
      }),
    ).toBe(true)
  })

  it('意图向下（towardBottom）且尚未落底 → 保持既有状态', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: false,
        metrics: metricsAt(300),
        lastObservedScrollTop: 900,
        userScrollIntent: 'towardBottom',
      }),
    ).toBe(false)
  })

  it('省略意图时按未知来源对账（调用方漏传不炸）', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metricsAt(0),
        lastObservedScrollTop: 1400,
      }),
    ).toBe(true)
  })

  it('账目基线为 null（本模块自身写入）→ 跳过未观察上滚检测，方向任意都不解除', () => {
    // 落点低于上次账目值，但属于程序化写入，不能当用户上滚
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: { scrollTop: 200, viewportHeight: 600, contentHeight: 3000 },
        lastObservedScrollTop: null,
        userScrollIntent: 'none',
      }),
    ).toBe(true)
    // 落点高于上次账目值同样保持
    expect(
      reconcileFollowingForContentAnchor({
        following: false,
        metrics: { scrollTop: 1200, viewportHeight: 600, contentHeight: 3000 },
        lastObservedScrollTop: null,
        userScrollIntent: 'unknown',
      }),
    ).toBe(false)
  })

  it('账目基线为 null 且落点在底 → 仍按落点恢复跟随', () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: false,
        metrics: metricsAt(0),
        lastObservedScrollTop: null,
        userScrollIntent: 'unknown',
      }),
    ).toBe(true)
  })
})

describe('resolveFollowingAfterContentShrink', () => {
  it('收缩 + 钳制落点在底 → 恢复跟随（回到底部按钮随之消失）', () => {
    // 内容从 3000 收缩到 2600，scrollTop 被钳到 2000 → 距底 0
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: { scrollTop: 2000, viewportHeight: 600, contentHeight: 2600 },
        heightDelta: -400,
      }),
    ).toBe(true)
  })

  it('收缩落点距底在 epsilon 内也算贴底（47/48/49 边界）', () => {
    // 内容收缩到 2000、视口 600：scrollTop 1351/1352/1353 → 距底 49/48/47
    const metricsAtDistance = (distance: number) => ({
      scrollTop: 2000 - 600 - distance,
      viewportHeight: 600,
      contentHeight: 2000,
    })
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: metricsAtDistance(BOTTOM_ANCHOR_EPSILON_PX - 1),
        heightDelta: -300,
      }),
    ).toBe(true)
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: metricsAtDistance(BOTTOM_ANCHOR_EPSILON_PX),
        heightDelta: -300,
      }),
    ).toBe(true)
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: metricsAtDistance(BOTTOM_ANCHOR_EPSILON_PX + 1),
        heightDelta: -300,
      }),
    ).toBe(false)
  })

  it('收缩 + 距底仍远（折叠的是视口下方的组）→ 保持解除', () => {
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: metricsAt(500),
        heightDelta: -200,
      }),
    ).toBe(false)
  })

  it('增长（heightDelta >= 0）→ 不对账，保持既有状态（流式增高不得把跟随判回来）', () => {
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: metricsAt(500),
        heightDelta: 200,
      }),
    ).toBe(false)
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: metricsAt(0),
        heightDelta: 0,
      }),
    ).toBe(false)
  })

  it('已跟随 → 恒为 true（收缩不影响跟随态）', () => {
    expect(
      resolveFollowingAfterContentShrink({
        following: true,
        metrics: metricsAt(500),
        heightDelta: -400,
      }),
    ).toBe(true)
  })

  it('收缩后内容不足一屏（距底 0）→ 恢复跟随', () => {
    expect(
      resolveFollowingAfterContentShrink({
        following: false,
        metrics: { scrollTop: 0, viewportHeight: 900, contentHeight: 500 },
        heightDelta: -2500,
      }),
    ).toBe(true)
  })
})

describe('滚动意图解码器', () => {
  it('wheel：deltaY 与 scrollTop 同向', () => {
    expect(wheelScrollIntent(-1)).toBe('awayFromBottom')
    expect(wheelScrollIntent(1)).toBe('towardBottom')
    expect(wheelScrollIntent(0)).toBe('none')
  })

  it('touch：手指下移表示阅读更早内容', () => {
    expect(touchScrollIntent(100, 140)).toBe('awayFromBottom')
    expect(touchScrollIntent(140, 100)).toBe('towardBottom')
    expect(touchScrollIntent(100, 100)).toBe('none')
  })

  it('键盘：翻页/方向键/空格按方向映射', () => {
    const base = { shiftKey: false, editableTarget: false }
    expect(keyboardScrollIntent({ ...base, key: 'ArrowUp' })).toBe('awayFromBottom')
    expect(keyboardScrollIntent({ ...base, key: 'PageUp' })).toBe('awayFromBottom')
    expect(keyboardScrollIntent({ ...base, key: 'Home' })).toBe('awayFromBottom')
    expect(keyboardScrollIntent({ ...base, key: 'ArrowDown' })).toBe('towardBottom')
    expect(keyboardScrollIntent({ ...base, key: 'End' })).toBe('towardBottom')
    expect(keyboardScrollIntent({ ...base, key: ' ' })).toBe('towardBottom')
    expect(keyboardScrollIntent({ ...base, key: ' ', shiftKey: true })).toBe('awayFromBottom')
    expect(keyboardScrollIntent({ ...base, key: 'a' })).toBe('none')
  })

  it('键盘：输入控件内的按键不是滚动意图（写作区就在滚动容器内）', () => {
    expect(
      keyboardScrollIntent({ key: 'PageUp', shiftKey: false, editableTarget: true }),
    ).toBe('none')
  })
})

describe('initialFollowing / shouldShowBackToBottom', () => {
  it('初次绑定默认跟随（打开会话定位到最新消息）', () => {
    expect(initialFollowing()).toBe(true)
  })

  it('按钮只在解除跟随且有内容时显示', () => {
    expect(shouldShowBackToBottom(false, 3)).toBe(true)
    expect(shouldShowBackToBottom(true, 3)).toBe(false)
    expect(shouldShowBackToBottom(false, 0)).toBe(false)
  })
})

describe('shouldTriggerLoadOlder', () => {
  it('到顶且可拉且非在途才触发', () => {
    expect(
      shouldTriggerLoadOlder({ scrollTop: 10, canLoadOlder: true, loadingOlder: false }),
    ).toBe(true)
    expect(
      shouldTriggerLoadOlder({ scrollTop: 10, canLoadOlder: false, loadingOlder: false }),
    ).toBe(false)
    expect(
      shouldTriggerLoadOlder({ scrollTop: 10, canLoadOlder: true, loadingOlder: true }),
    ).toBe(false)
    expect(
      shouldTriggerLoadOlder({ scrollTop: 200, canLoadOlder: true, loadingOlder: false }),
    ).toBe(false)
  })

  it('默认阈值 80px，可覆盖', () => {
    expect(
      shouldTriggerLoadOlder({ scrollTop: 81, canLoadOlder: true, loadingOlder: false }),
    ).toBe(false)
    expect(
      shouldTriggerLoadOlder({ scrollTop: 81, canLoadOlder: true, loadingOlder: false, triggerPx: 100 }),
    ).toBe(true)
  })
})

// ── DOM 接线区：内容尺寸变化的运行时行为 ──────────────────────────
//
// 背景：拖拽分割条把聊天区压窄时，内容会逐帧重排变高。旧实现在宽度变化时进入
// 120ms 稳定窗、窗内暂停贴底，导致「滚动条脱离底部 → 停下 → 突然跳回」。
// 这些用例是把 ResizeObserver 回调直接喂给状态机，锁定「跟随态当帧贴底」的语义。

interface FakeScrollElement {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  addEventListener: () => void
  removeEventListener: () => void
}

/** 最小滚动元素桩：scrollTop 赋值按浏览器的上下限钳制。 */
function makeScrollElement(input: {
  viewportHeight: number
  contentHeight: number
  scrollTop?: number
}): FakeScrollElement {
  let scrollTop = input.scrollTop ?? 0
  const element: FakeScrollElement = {
    get scrollTop() {
      return scrollTop
    },
    set scrollTop(value: number) {
      const max = Math.max(0, element.scrollHeight - element.clientHeight)
      scrollTop = Math.max(0, Math.min(value, max))
    },
    clientHeight: input.viewportHeight,
    scrollHeight: input.contentHeight,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return element
}

/** ResizeObserverEntry 桩：状态机只读 contentRect.width 与 target.scrollHeight。 */
function contentResize(width: number, contentHeight: number): ResizeObserverEntry {
  return {
    contentRect: { width, height: 0 },
    target: { scrollHeight: contentHeight },
  } as unknown as ResizeObserverEntry
}

function distanceOf(element: FakeScrollElement): number {
  return distanceToBottom({
    scrollTop: element.scrollTop,
    viewportHeight: element.clientHeight,
    contentHeight: element.scrollHeight,
  })
}

describe('handleContentResize：跟随态贴底不受宽度变化抑制', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('挤压导致的重排当帧贴底，不需要等稳定窗', () => {
    const el = makeScrollElement({ viewportHeight: 500, contentHeight: 1000 })
    const anchor = useScrollAnchor()
    anchor.attach(el as unknown as HTMLElement)

    // 首帧建立账目；跟随态立即贴底
    anchor.handleContentResize(contentResize(800, 1000))
    expect(el.scrollTop).toBe(500)

    // 拖窄 → 内容变高：旧实现会在这里暂停贴底
    el.scrollHeight = 1400
    anchor.handleContentResize(contentResize(600, 1400))
    expect(el.scrollTop).toBe(900)
    expect(distanceOf(el)).toBe(0)
  })

  it('连续挤压的每一帧都保持置底', () => {
    const el = makeScrollElement({ viewportHeight: 500, contentHeight: 1000 })
    const anchor = useScrollAnchor()
    anchor.attach(el as unknown as HTMLElement)

    for (let frame = 0; frame < 5; frame += 1) {
      el.scrollHeight = 1000 + frame * 120
      anchor.handleContentResize(contentResize(800 - frame * 50, el.scrollHeight))
      expect(distanceOf(el)).toBe(0)
    }
  })

  it('没有残留的延迟贴底（旧实现的 120ms 定时器会在用户上滚后把人拽回底部）', () => {
    vi.useFakeTimers()
    const el = makeScrollElement({ viewportHeight: 500, contentHeight: 1000 })
    const anchor = useScrollAnchor()
    anchor.attach(el as unknown as HTMLElement)

    anchor.handleContentResize(contentResize(800, 1000))
    el.scrollHeight = 1400
    anchor.handleContentResize(contentResize(600, 1400))
    expect(el.scrollTop).toBe(900)

    // 模拟用户此刻上滚：若还有稳定窗定时器，它会在 120ms 后把视图拉回底部
    el.scrollTop = 300
    vi.advanceTimersByTime(500)
    expect(el.scrollTop).toBe(300)
  })

  it('离底态：挤压导致内容变高时不拉回底部', () => {
    const el = makeScrollElement({ viewportHeight: 500, contentHeight: 1000, scrollTop: 300 })
    const anchor = useScrollAnchor()
    anchor.attach(el as unknown as HTMLElement)
    anchor.setFollowing(false)

    anchor.handleContentResize(contentResize(800, 1000))
    el.scrollHeight = 1400
    anchor.handleContentResize(contentResize(600, 1400))

    expect(el.scrollTop).toBe(300)
    expect(anchor.following.value).toBe(false)
  })

  it('离底态：宽度不变的内容收缩钳到贴底 → 恢复跟随（折叠/删除语义保留）', () => {
    const el = makeScrollElement({ viewportHeight: 500, contentHeight: 1000, scrollTop: 500 })
    const anchor = useScrollAnchor()
    anchor.attach(el as unknown as HTMLElement)
    anchor.setFollowing(false)

    anchor.handleContentResize(contentResize(800, 1000))
    el.scrollHeight = 600
    el.scrollTop = 100 // 浏览器把越界位置钳到底
    anchor.handleContentResize(contentResize(800, 600))

    expect(distanceOf(el)).toBe(0)
    expect(anchor.following.value).toBe(true)
  })

  it('离底态：宽度变化引起的高度收缩不参与对账（不因钳制落点夺回跟随）', () => {
    const el = makeScrollElement({ viewportHeight: 500, contentHeight: 1000, scrollTop: 500 })
    const anchor = useScrollAnchor()
    anchor.attach(el as unknown as HTMLElement)
    anchor.setFollowing(false)

    anchor.handleContentResize(contentResize(800, 1000))
    el.scrollHeight = 600
    el.scrollTop = 100
    anchor.handleContentResize(contentResize(900, 600))

    expect(anchor.following.value).toBe(false)
  })
})
