import { ref, type Ref } from 'vue'

/**
 * 聊天滚动底部锚定：(following) 表达用户滚动权，不是瞬时几何快照。
 *
 * 语义对齐参考实现 zcode 的 v4 timeline 滚动状态机
 * （packages/ui/src/v4/timelineScrollAnchor.ts + ConversationTimeline.tsx）：
 * - 用户位于底部 → following=true，新内容（流式 delta / 测高变化 / 新回合）自动贴底；
 * - 用户上滚离底 → following=false，流式增量不得拉回阅读位置，回到底部按钮出现；
 * - 用户手动滚回底部（或点按钮）→ 恢复跟随。
 *
 * 只有**真实用户滚动输入**可以改变 following；程序化贴底、布局重排和加载更多的
 * 高度补偿产生的 scroll 事件只更新几何账目。这条约束是本模块存在的唯一理由——
 * 旧实现用「scroll 事件里 scrollTop 回退超 10px」反推用户上滚，而内容增高的瞬间
 * ResizeObserver 会抢先贴底，用户上滚与内容增高落在同一帧时启发式直接失效。
 *
 * 本文件与参考实现的两处刻意的简化（本列表未虚拟化）：
 * - 无 virtualizer：不需要测高补偿裁决、prepend 虚拟锚点、live tail 分离；
 * - scroll 事件来源只分 user / layout 两类：prepend 平移、会话恢复、跳转校正都由
 *   本模块自己写入且立刻回读入账，不存在「第三方程序化滚动」需要单独归类。
 */

// ── 纯函数区（无 DOM 依赖，可直接单测） ──

/** 离底判定容差：小于该距离视为「在底部」。取值覆盖亚像素滚动与最后一行 padding。 */
export const BOTTOM_ANCHOR_EPSILON_PX = 48

/** 未观察滚动的判定容差：小于该值的 scrollTop 回退视为亚像素抖动，不算用户上滚。 */
export const UNOBSERVED_SCROLL_EPSILON_PX = 2

/** 用户滚动意图的存活窗口：wheel/touch/key 登记后超过该时长不再视为活跃意图。 */
export const USER_SCROLL_INTENT_TTL_MS = 1200

/** 布局滚动保护窗：本模块自身写入 scrollTop 时标记，窗内的 scroll 事件不改变 following。 */
export const LAYOUT_SCROLL_GUARD_MS = 250

/** 宽度变化的稳定窗：拖拽分割条/窗口缩放会连续触发多轮重排，窗内暂停贴底，结束后只贴一次。 */
export const CONTENT_WIDTH_RESIZE_SETTLE_MS = 120

export interface ScrollMetrics {
  /** 滚动容器 scrollTop。 */
  scrollTop: number
  /** 滚动容器可视高度（clientHeight）。 */
  viewportHeight: number
  /** 内容总高度（scrollHeight）。 */
  contentHeight: number
}

/** 距底部的剩余可滚动距离（内容不足一屏时为 0）。 */
export function distanceToBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.contentHeight - metrics.viewportHeight - metrics.scrollTop)
}

export function isAtBottom(
  metrics: ScrollMetrics,
  epsilonPx: number = BOTTOM_ANCHOR_EPSILON_PX,
): boolean {
  return distanceToBottom(metrics) <= epsilonPx
}

export type ScrollEventSource = 'user' | 'layout'

/**
 * scroll 事件后的滚动权裁决。布局/程序化 scroll 不得改变用户意图；只有用户输入
 * 才按最终落点决定是否跟随（落点在底部 ⇔ 跟随，无需区分上滚还是滚回）。
 */
export function resolveFollowingAfterScroll(input: {
  following: boolean
  metrics: ScrollMetrics
  source: ScrollEventSource
  epsilonPx?: number
}): boolean {
  if (input.source !== 'user') return input.following
  return isAtBottom(input.metrics, input.epsilonPx)
}

export type UserScrollIntent = 'none' | 'awayFromBottom' | 'towardBottom' | 'unknown'

/**
 * 内容变化 commit 贴底前，对账用户滚动意图。
 *
 * 跟随态由 scroll 事件驱动，但 scroll 事件在滚动发生后的下一渲染帧才派发：
 * 用户上滚（wheel）之后、事件派发之前，若恰好落进一个内容撑高的 commit
 * （流式 delta、ResizeObserver 测高修正、输入区尺寸变化），贴底动作会拿着
 * **过期的 following=true** 把 scrollTop 拽回底部，且回弹落点让随后的 scroll 事件
 * 把跟随判回 true——用户的上滚被整体吞掉（「resize/测高 commit 夺走滚动权」）。
 *
 * 对账规则（贴底动作之前执行，输入为 commit 时刻的实时指标）：
 * 1. 明确向上滚动 → 立即解除跟随，同帧布局 commit 也必须让位；
 * 2. 没有用户输入 → 原样保持 following，布局导致 scrollTop 回退不算上滚；
 * 3. 方向未知或向下的用户输入 → 落点在底则恢复跟随，明显回退则解除，其余保持。
 */
export function reconcileFollowingForContentAnchor(input: {
  following: boolean
  metrics: ScrollMetrics
  /** 组件最近一次「已账目」的 scrollTop——scroll 事件读取值，或程序化写入后的回读值；
   *  传 null 表示本次变化是本模块自身写入引起的，跳过未观察上滚检测。 */
  lastObservedScrollTop: number | null
  /** 当前 commit 前捕获到的用户滚动意图；省略时按旧的未知来源对账。 */
  userScrollIntent?: UserScrollIntent
  /** 记账以来视口是否变小（clientHeight 下降）：容器缩小会把 scrollTop 向下钳制，
   *  那不是用户上滚——直接把该轮变化排除出未观察上滚检测。 */
  viewportShrank?: boolean
  bottomEpsilonPx?: number
  scrollEpsilonPx?: number
}): boolean {
  const userScrollIntent = input.userScrollIntent ?? 'unknown'
  if (userScrollIntent === 'awayFromBottom') return false
  if (userScrollIntent === 'none') return input.following
  if (isAtBottom(input.metrics, input.bottomEpsilonPx ?? BOTTOM_ANCHOR_EPSILON_PX)) {
    return true
  }
  const unobservedUpscroll =
    !input.viewportShrank &&
    input.lastObservedScrollTop !== null &&
    input.metrics.scrollTop <
      input.lastObservedScrollTop - (input.scrollEpsilonPx ?? UNOBSERVED_SCROLL_EPSILON_PX)
  if (unobservedUpscroll) return false
  return input.following
}

/**
 * 内容变化（新行追加 / 流式 delta 撑高 / 动态展开）后的动作：
 * 跟随中 → 贴底；已解除或宽度变化中 → 保持阅读位置（绝不拉回）。
 */
export function anchorActionAfterContentChange(
  following: boolean,
  contentWidthChanging: boolean = false,
): 'stickToBottom' | 'hold' {
  return following && !contentWidthChanging ? 'stickToBottom' : 'hold'
}

/** wheel 的 deltaY 与 scrollTop 同向：负值阅读更早内容，正值靠近底部。 */
export function wheelScrollIntent(deltaY: number): UserScrollIntent {
  if (deltaY < 0) return 'awayFromBottom'
  if (deltaY > 0) return 'towardBottom'
  return 'none'
}

/** touch 手指位移与 scrollTop 反向：手指下移表示阅读更早内容。 */
export function touchScrollIntent(previousClientY: number, nextClientY: number): UserScrollIntent {
  if (nextClientY > previousClientY) return 'awayFromBottom'
  if (nextClientY < previousClientY) return 'towardBottom'
  return 'none'
}

/** 键盘滚动意图；输入控件内的光标按键不属于滚动容器的滚动（写作区就在本容器内）。 */
export function keyboardScrollIntent(input: {
  key: string
  shiftKey: boolean
  editableTarget: boolean
}): UserScrollIntent {
  if (input.editableTarget) return 'none'
  if (input.key === 'ArrowUp' || input.key === 'PageUp' || input.key === 'Home') {
    return 'awayFromBottom'
  }
  if (input.key === 'ArrowDown' || input.key === 'PageDown' || input.key === 'End') {
    return 'towardBottom'
  }
  if (input.key === ' ') {
    return input.shiftKey ? 'awayFromBottom' : 'towardBottom'
  }
  return 'none'
}

/** 会话切换 / 首次绑定：重置为跟随（打开会话定位到最新消息）。 */
export function initialFollowing(): boolean {
  return true
}

/** 「回到底部」按钮可见性：仅在解除跟随且确实存在内容时展示。 */
export function shouldShowBackToBottom(following: boolean, rowCount: number): boolean {
  return !following && rowCount > 0
}

/** 顶部触发阈值：距顶小于该距离视为「到顶」，自动拉取更早一页。 */
export const LOAD_OLDER_TRIGGER_PX = 80

/** scroll 事件是否应触发 loadOlder（到顶 + 可拉 + 非在途）。 */
export function shouldTriggerLoadOlder(input: {
  scrollTop: number
  canLoadOlder: boolean
  loadingOlder: boolean
  triggerPx?: number
}): boolean {
  return (
    input.canLoadOlder &&
    !input.loadingOlder &&
    input.scrollTop <= (input.triggerPx ?? LOAD_OLDER_TRIGGER_PX)
  )
}

// ── DOM 接线区 ──

function isEditableScrollTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

/**
 * 元素自身（而非其后代）是否是可滚动盒子。
 * 用于把嵌套滚动框（思考框 column-reverse、工具结果框、代码块）排除出容器级意图：
 * 在嵌套框里滚轮时，容器 scrollTop 不变，登记上滚会误解除聊天区的跟随。
 */
function isScrollableBox(element: Element): boolean {
  if (element.scrollHeight - element.clientHeight <= 1) return false
  const overflowY = getComputedStyle(element).overflowY
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
}

/** wheel 事件是否最终由本容器消费（向上寻找最近的可滚动祖先）。 */
function wheelConsumedByContainer(target: EventTarget | null, container: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node) {
    if (node === container) return true
    if (isScrollableBox(node)) return false
    node = node.parentElement
  }
  return false
}

export interface ScrollAnchorOptions {
  /** following 变化回调：父组件据此驱动「回到底部」按钮与自动贴底开关。 */
  onFollowingChange?: (following: boolean) => void
  /** 到顶回调：父组件据此拉取更早一页。 */
  onNearTop?: () => void
  /** 内容尺寸变化并完成对账后回调：父组件用于恢复会话滚动位置的重试。 */
  onContentResize?: (entry: ResizeObserverEntry) => void
  /** 到顶阈值（px），默认 LOAD_OLDER_TRIGGER_PX。 */
  nearTopThreshold?: number
}

export function useScrollAnchor(options: ScrollAnchorOptions = {}) {
  const following = ref(initialFollowing())
  const scrollElementRef = ref<HTMLElement | null>(null)

  let userScrollIntent: { intent: UserScrollIntent; observedAt: number } = {
    intent: 'none',
    observedAt: 0,
  }
  let touchClientY: number | null = null
  let scrollbarPointerId: number | null = null
  let layoutScrollGuardUntil = 0
  /** 组件「已账目」的 scrollTop——scroll 事件读取值或本模块写入后的回读值。 */
  let lastObservedScrollTop = 0
  /** 上一次账目的视口高度：用于区分「容器变小 clamp」与「用户上滚」。 */
  let lastObservedViewportHeight = 0
  let lastContentWidth = 0
  let contentWidthChanging = false
  let widthSettleTimer: ReturnType<typeof setTimeout> | null = null

  function commitFollowing(next: boolean): void {
    if (following.value === next) return
    following.value = next
    options.onFollowingChange?.(next)
  }

  function markLayoutScroll(): void {
    layoutScrollGuardUntil = Date.now() + LAYOUT_SCROLL_GUARD_MS
  }

  function getActiveUserScrollIntent(): UserScrollIntent {
    const interactionActive = touchClientY !== null || scrollbarPointerId !== null
    if (interactionActive) {
      return userScrollIntent.intent === 'none' ? 'unknown' : userScrollIntent.intent
    }
    return Date.now() - userScrollIntent.observedAt <= USER_SCROLL_INTENT_TTL_MS
      ? userScrollIntent.intent
      : 'none'
  }

  function clearUserScrollIntent(): void {
    userScrollIntent = { intent: 'none', observedAt: 0 }
    touchClientY = null
    scrollbarPointerId = null
  }

  function markUserScrollIntent(intent: UserScrollIntent): void {
    if (intent === 'none') return
    userScrollIntent = { intent, observedAt: Date.now() }
    const element = scrollElementRef.value
    // 明确上滚必须在 scroll 事件派发之前先拿走滚动权：否则同帧的内容增高 commit
    // 会拿着过期的 following=true 把人拽回底部，且回弹落点把随后的 scroll 事件
    // 判回「贴底」——用户的上滚被整体吞掉。
    if (intent === 'awayFromBottom' && element && element.scrollHeight > element.clientHeight) {
      commitFollowing(false)
    }
  }

  function getScrollMetrics(): ScrollMetrics | null {
    const element = scrollElementRef.value
    if (!element) return null
    return {
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight,
      contentHeight: element.scrollHeight,
    }
  }
  /** 程序化写入 scrollTop 后回读入账（写入不经过 scroll 事件分类）。 */
  function recordScrollTop(top: number): void {
    lastObservedScrollTop = top
  }

  /** 立即贴底：写入后回读入账（浏览器会把赋值钳到最大可滚动距离）。 */
  function scrollToBottomImmediate(): void {
    const element = scrollElementRef.value
    if (!element) return
    markLayoutScroll()
    element.scrollTop = element.scrollHeight
    lastObservedScrollTop = element.scrollTop
  }

  /**
   * 平滑贴底。已贴底才跳过（幂等）——不能按「scrollHeight 是否变化」守卫：
   * 内容没增长时（用户向上滚一下再点回到底部）高度与上次相同，会让第二次点击空转。
   */
  function scrollToBottomSmooth(): void {
    const element = scrollElementRef.value
    if (!element) return
    if (isAtBottom({
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight,
      contentHeight: element.scrollHeight,
    })) {
      return
    }
    markLayoutScroll()
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }

  /**
   * 内容尺寸变化（ResizeObserver on 内容元素）：
   * - 宽度变化 → 进稳定窗，窗内暂停贴底，结束后只贴一次（拖拽分割条/窗口缩放场景）；
   * - 宽度未变且仍在跟随 → 贴底（图片加载、流式正文、展开折叠等异步高度增长）。
   * 宽度判定用条目自身的 contentRect，不在回调里读布局。
   */
  function handleContentResize(entry: ResizeObserverEntry): void {
    const width = entry.contentRect.width
    const reflowedByWidth = lastContentWidth > 0 && Math.abs(width - lastContentWidth) > 0.5
    lastContentWidth = width
    if (reflowedByWidth) {
      contentWidthChanging = true
      if (widthSettleTimer !== null) clearTimeout(widthSettleTimer)
      widthSettleTimer = setTimeout(() => {
        widthSettleTimer = null
        contentWidthChanging = false
        if (following.value) scrollToBottomImmediate()
      }, CONTENT_WIDTH_RESIZE_SETTLE_MS)
    } else if (following.value && !contentWidthChanging) {
      scrollToBottomImmediate()
    }
    options.onContentResize?.(entry)
  }

  /** scroll 事件入口。分类规则见文件头注释：只有真实用户输入能改变 following。 */
  function handleScroll(): void {
    const element = scrollElementRef.value
    if (!element) return
    const metrics: ScrollMetrics = {
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight,
      contentHeight: element.scrollHeight,
    }
    const intent = getActiveUserScrollIntent()
    const source: ScrollEventSource = intent === 'none' ? 'layout' : 'user'
    // 对账要用「事件之前的账目值」，先算再记账
    const previousObservedScrollTop = lastObservedScrollTop
    // 容器变小会把 scrollTop 向下钳制：那不是用户上滚（旧实现的「容器变小导致的滚动
    // 不应该视为向上滚动」注释同意）。比较上一次账目的视口高度，事件到达时
    // clientHeight 已是缩小后的值。
    const viewportShrank = lastObservedViewportHeight > 0 && metrics.viewportHeight < lastObservedViewportHeight

    const next = resolveFollowingAfterScroll({ following: following.value, metrics, source })
    if (source === 'user') {
      commitFollowing(next)
    } else {
      // 无意图的 scroll：可能是布局回退 / clamp，也可能是本模块刚写入而浏览器尚未派发的
      // 上一轮「布局滚动」。后者不能按未观察上滚处理（点击回到底部的平滑滚动被打断等
      // 情况，落点确实低于账目值）。用 layoutScrollGuardUntil 消费掉这一轮写入。
      const pendingLayoutWrite = Date.now() <= layoutScrollGuardUntil
      if (pendingLayoutWrite) layoutScrollGuardUntil = 0
      commitFollowing(
        reconcileFollowingForContentAnchor({
          following: following.value,
          metrics,
          // 本模块刚写入 scrollTop 后派发的那次事件：账目基线置空，跳过未观察上滚检测
          lastObservedScrollTop: pendingLayoutWrite ? null : previousObservedScrollTop,
          userScrollIntent: 'none',
          viewportShrank,
        }),
      )
    }
    lastObservedScrollTop = metrics.scrollTop
    lastObservedViewportHeight = metrics.viewportHeight

    // 到顶补页只在用户滚到位时触发：恢复位置、贴底 clamp、prepend 补偿这些
    // 程序化滚动不应冒充「用户拉取历史」。
    if (
      source === 'user' &&
      options.onNearTop &&
      shouldTriggerLoadOlder({
        scrollTop: metrics.scrollTop,
        canLoadOlder: true,
        loadingOlder: false,
        triggerPx: options.nearTopThreshold,
      })
    ) {
      // canLoadOlder / loadingOlder 由父组件在回调内判定（它持有分页游标与在途标记），
      // 这里的入口条件只负责「到顶」这一几何事实。
      options.onNearTop()
    }
  }

  function handleWheel(event: WheelEvent): void {
    const container = scrollElementRef.value
    if (container && !wheelConsumedByContainer(event.target, container)) return
    if (isEditableScrollTarget(event.target) && !isScrollableBox(event.target as Element)) return
    markUserScrollIntent(wheelScrollIntent(event.deltaY))
  }

  function handleTouchStart(event: TouchEvent): void {
    touchClientY = event.touches[0]?.clientY ?? null
  }

  function handleTouchMove(event: TouchEvent): void {
    const nextClientY = event.touches[0]?.clientY
    const previousClientY = touchClientY
    if (nextClientY === undefined || previousClientY === null) return
    markUserScrollIntent(touchScrollIntent(previousClientY, nextClientY))
    touchClientY = nextClientY
  }

  function handleTouchEnd(): void {
    touchClientY = null
  }

  function handleKeyDown(event: KeyboardEvent): void {
    markUserScrollIntent(
      keyboardScrollIntent({
        key: event.key,
        shiftKey: event.shiftKey,
        editableTarget: isEditableScrollTarget(event.target),
      }),
    )
  }

  function handlePointerDown(event: PointerEvent): void {
    // 内容区点击（发送、展开卡片）不是滚动意图；只有命中滚动容器自身
    //（空白或滚动条）时才登记未知方向，随后由真实 scroll 落点裁决。
    if (event.target !== event.currentTarget) return
    scrollbarPointerId = event.pointerId
    markUserScrollIntent('unknown')
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (scrollbarPointerId === event.pointerId) scrollbarPointerId = null
  }

  /** 挂载：capture 阶段监听，保证早于 scroll 事件拿到用户意图。 */
  function attach(element: HTMLElement): void {
    detach()
    scrollElementRef.value = element
    lastObservedScrollTop = element.scrollTop
    lastObservedViewportHeight = element.clientHeight
    lastContentWidth = 0
    const capture = { capture: true } as const
    element.addEventListener('wheel', handleWheel, capture)
    element.addEventListener('touchstart', handleTouchStart, capture)
    element.addEventListener('touchmove', handleTouchMove, capture)
    element.addEventListener('touchend', handleTouchEnd, capture)
    element.addEventListener('touchcancel', handleTouchEnd, capture)
    element.addEventListener('keydown', handleKeyDown, capture)
    element.addEventListener('pointerdown', handlePointerDown, capture)
    element.addEventListener('pointerup', handlePointerEnd, capture)
    element.addEventListener('pointercancel', handlePointerEnd, capture)
  }

  function detach(): void {
    const element = scrollElementRef.value
    if (element) {
      const capture = { capture: true } as const
      element.removeEventListener('wheel', handleWheel, capture)
      element.removeEventListener('touchstart', handleTouchStart, capture)
      element.removeEventListener('touchmove', handleTouchMove, capture)
      element.removeEventListener('touchend', handleTouchEnd, capture)
      element.removeEventListener('touchcancel', handleTouchEnd, capture)
      element.removeEventListener('keydown', handleKeyDown, capture)
      element.removeEventListener('pointerdown', handlePointerDown, capture)
      element.removeEventListener('pointerup', handlePointerEnd, capture)
      element.removeEventListener('pointercancel', handlePointerEnd, capture)
    }
    if (widthSettleTimer !== null) {
      clearTimeout(widthSettleTimer)
      widthSettleTimer = null
    }
    contentWidthChanging = false
    clearUserScrollIntent()
  }

  function setFollowing(next: boolean): void {
    commitFollowing(next)
  }

  /**
   * 登记用户滚动意图（点击「回到底部」按钮等组件级用户输入入口调用）。
   * 按钮触发的平滑滚动要按用户滚动处理，否则滚动途中的 scroll 事件会被当成
   * 布局滚动，回到底部按钮整段动画都消不掉。
   */
  function markUserIntent(intent: UserScrollIntent): void {
    markUserScrollIntent(intent)
  }

  return {
    following: following as Ref<boolean>,
    attach,
    detach,
    handleScroll,
    handleContentResize,
    markLayoutScroll,
    scrollToBottomImmediate,
    scrollToBottomSmooth,
    getScrollMetrics,
    recordScrollTop,
    setFollowing,
    markUserIntent,
  }
}
