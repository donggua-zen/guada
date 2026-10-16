import { describe, expect, it } from 'vitest'
import {
  anchorActionAfterContentChange,
  BOTTOM_ANCHOR_EPSILON_PX,
  distanceToBottom,
  initialFollowing,
  isAtBottom,
  keyboardScrollIntent,
  reconcileFollowingForContentAnchor,
  resolveFollowingAfterScroll,
  shouldShowBackToBottom,
  shouldTriggerLoadOlder,
  touchScrollIntent,
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

describe('anchorActionAfterContentChange', () => {
  it('跟随中 → 贴底', () => {
    expect(anchorActionAfterContentChange(true)).toBe('stickToBottom')
  })

  it('已解除 → 保持阅读位置', () => {
    expect(anchorActionAfterContentChange(false)).toBe('hold')
  })

  it('宽度变化中（拖拽分割条）→ 即便是跟随也先保持（等稳定窗后只贴一次）', () => {
    expect(anchorActionAfterContentChange(true, true)).toBe('hold')
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
