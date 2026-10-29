// stores/browserWebview.ts
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'

/**
 * Webview 状态接口
 */
export interface WebviewState {
  windowId: string
  url: string
  title: string
  favicon?: string
  partition: string
  preloadUrl: string
  isVisible: boolean
  metadata?: Record<string, unknown>
}

/**
 * 预览占位区域坐标
 */
export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 渲染视口尺寸
 */
export interface ViewportSize {
  width: number
  height: number
}

/** 渲染视口模式：固定尺寸 / 自适应预览面板 */
export type ViewportMode = 'fixed' | 'adaptive'

/** 单个网页的视口覆盖：固定尺寸或自适应 */
export type ViewportOverride = ViewportSize | 'adaptive'

/**
 * 浏览器 Webview 全局状态 Store
 *
 * 管理 webview 元素生命周期、活跃窗口、预览坐标。
 * Webview 实际 DOM 元素由 BrowserWebviewLayer 组件管理（挂载在 MainLayout 级别）。
 * 预览占位坐标由 BrowserPreviewPlaceholder 组件通过 ResizeObserver 实时报告。
 */
export const useBrowserWebviewStore = defineStore('browserWebview', () => {
  /** 所有 webview 状态（windowId → WebviewState） */
  const webviews = ref<Map<string, WebviewState>>(new Map())

  /** 当前活跃（可见）的 webview windowId */
  const activeWindowId = ref<string | null>(null)

  /** 预览占位区域坐标（null 表示占位区不存在/已隐藏） */
  const previewRect = ref<PreviewRect | null>(null)

  /** 当前会话 ID（用于过滤窗口列表） */
  const currentSessionId = ref<string | null>(null)

  /** 分割面板拖拽中标志（拖拽时屏蔽 webview 指针事件） */
  const isDragging = ref(false)

  /** 截图等操作临时需要渲染的 webview（窗口内 0,0 + opacity 0.001，不参与命中测试），不改变 activeWindowId */
  const renderableOverrides = ref<Set<string>>(new Set())

  /** 当前被网页 Pointer Lock 锁定的 webview（windowId 集合） */
  const pointerLockedWindows = ref<Set<string>>(new Set())

  /**
   * 全局默认渲染视口（默认 1280×720，来源：设置中心，utils/browserViewport.ts）。
   * 默认所有 webview 恒定使用固定视口渲染，保证 window.innerWidth/innerHeight
   * 与截图输出不随预览面板尺寸、可见性跳变；前台显示由 BrowserWebviewLayer
   * 做合成器层面的等比缩放。
   */
  const viewportWidth = ref(1280)
  const viewportHeight = ref(720)

  /** 全局默认是否自适应预览面板（设置中心「默认渲染视口」，持久化到 browser 分组） */
  const viewportAdaptive = ref(false)

  /**
   * 预览面板最近一次有效尺寸（自适应视口的来源）。
   * 面板隐藏（v-show）时 ResizeObserver 会报 0×0，此时保留最后一次有效值，
   * 保证后台渲染、截图与 AI 操作仍基于一个稳定尺寸。
   */
  const lastAdaptiveSize = ref<ViewportSize | null>(null)

  /**
   * 自适应网页最后一次处于前台时的视口尺寸（windowId → size）。
   * 后台页面保持该尺寸，重新激活时才跟随当前面板尺寸，
   * 避免面板拖拽/窗口缩放导致所有后台页面反复重排。
   */
  const frozenAdaptiveSizes = ref<Map<string, ViewportSize>>(new Map())

  /**
   * 按网页（windowId）单独覆盖的渲染视口（预览工具栏入口，DevTools 风格）。
   * 仅内存保存、按网页隔离：关闭标签即失效，不持久化；
   * 未覆盖的网页跟随全局默认（viewportAdaptive / viewportWidth/Height）。
   */
  const viewportOverrides = ref<Map<string, ViewportOverride>>(new Map())

  /** 活跃 webview 的导航状态（由 BrowserWebviewLayer 从 webview 事件同步） */
  const canGoBack = ref(false)
  const canGoForward = ref(false)
  const isLoading = ref(false)

  /** 活跃 webview 是否静音（默认静音，避免突然播放声音吓人） */
  const isMuted = ref(true)

  /** 活跃 webview 的 DOM 元素引用（shallowRef 避免 Vue 对 DOM 做深层响应式） */
  const activeWebviewEl = shallowRef<HTMLElement | null>(null)

  // ── Actions ──

  function addWebview(state: WebviewState): void {
    webviews.value.set(state.windowId, { ...state })
  }

  function removeWebview(windowId: string): void {
    webviews.value.delete(windowId)
    // 清理该网页的视口覆盖（仅内存数据，随标签关闭失效）
    if (viewportOverrides.value.has(windowId)) {
      const next = new Map(viewportOverrides.value)
      next.delete(windowId)
      viewportOverrides.value = next
    }
    // 清理该网页的自适应冻结尺寸
    if (frozenAdaptiveSizes.value.has(windowId)) {
      const next = new Map(frozenAdaptiveSizes.value)
      next.delete(windowId)
      frozenAdaptiveSizes.value = next
    }
    // 清理该网页的指针锁状态
    if (pointerLockedWindows.value.has(windowId)) {
      const next = new Set(pointerLockedWindows.value)
      next.delete(windowId)
      pointerLockedWindows.value = next
    }
    // 清理截图临时渲染标记（主进程租约可能晚一步释放，前端先摘掉避免残留）
    if (renderableOverrides.value.has(windowId)) {
      const next = new Set(renderableOverrides.value)
      next.delete(windowId)
      renderableOverrides.value = next
    }
    // 不自动清除 activeWindowId —— 由调用方通过 setActive 控制切换，
    // 避免关闭标签时中间态 null → preview-close → 再 setActive → preview-open 造成闪烁
    if (activeWindowId.value === windowId) {
      activeWebviewEl.value = null
    }
  }

  function updateWebview(windowId: string, patch: Partial<WebviewState>): void {
    const wv = webviews.value.get(windowId)
    if (wv) {
      Object.assign(wv, patch)
    }
  }

  /** 记录当前前台网页的最新尺寸，供它转后台时冻结 */
  function rememberActiveAdaptiveSize(size: ViewportSize): void {
    const activeId = activeWindowId.value
    if (!activeId) return
    const frozen = frozenAdaptiveSizes.value.get(activeId)
    if (frozen && frozen.width === size.width && frozen.height === size.height) return
    const next = new Map(frozenAdaptiveSizes.value)
    next.set(activeId, { ...size })
    frozenAdaptiveSizes.value = next
  }

  function setActive(windowId: string | null): void {
    activeWindowId.value = windowId
    // 同步更新 isVisible 状态
    for (const [id, wv] of webviews.value.entries()) {
      wv.isVisible = id === windowId
    }
    // 前台分支不使用截图 override；提前清掉，避免它转后台后残留成隐形可点层
    if (windowId && renderableOverrides.value.has(windowId)) {
      const next = new Set(renderableOverrides.value)
      next.delete(windowId)
      renderableOverrides.value = next
    }
    // 新前台网页先按最近面板尺寸记录，避免切回后面板未变化时沿用更早的冻结值
    if (windowId && lastAdaptiveSize.value) {
      rememberActiveAdaptiveSize(lastAdaptiveSize.value)
    }
    // 清空活跃 webview 元素引用（BrowserWebviewLayer 会重新设置）
    if (!windowId) {
      activeWebviewEl.value = null
      canGoBack.value = false
      canGoForward.value = false
      isLoading.value = false
    }
  }

  function setPreviewRect(rect: PreviewRect | null): void {
    previewRect.value = rect
    // 面板隐藏时 ResizeObserver 会报 0×0：忽略无效尺寸，保留最后一次有效值
    if (rect && rect.width >= 1 && rect.height >= 1) {
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      const last = lastAdaptiveSize.value
      if (!last || last.width !== width || last.height !== height) {
        lastAdaptiveSize.value = { width, height }
      }
      rememberActiveAdaptiveSize({ width, height })
    }
  }

  function setCurrentSession(sessionId: string | null): void {
    currentSessionId.value = sessionId
    // 会话切换时隐藏活跃窗口（webview 不销毁，仅视觉隐藏）
    activeWindowId.value = null
    previewRect.value = null
    activeWebviewEl.value = null
    renderableOverrides.value.clear()
    renderableOverrides.value = new Set()
    pointerLockedWindows.value = new Set()
  }

  function setDragging(val: boolean): void {
    isDragging.value = val
  }

  function setRenderableOverride(windowId: string, renderable: boolean): void {
    if (renderable) {
      renderableOverrides.value.add(windowId)
    } else {
      renderableOverrides.value.delete(windowId)
    }
    // 触发响应式
    renderableOverrides.value = new Set(renderableOverrides.value)
  }

  /** 更新某网页的 Pointer Lock 状态 */
  function setPointerLocked(windowId: string, locked: boolean): void {
    const next = new Set(pointerLockedWindows.value)
    if (locked) {
      next.add(windowId)
    } else {
      next.delete(windowId)
    }
    pointerLockedWindows.value = next
  }

  /** 设置渲染视口尺寸（所有 webview 立即按新尺寸重排，来源见 utils/browserViewport.ts） */
  function setViewportSize(width: number, height: number): void {
    viewportWidth.value = width
    viewportHeight.value = height
  }

  /** 设置全局默认是否自适应预览面板（来源：设置中心） */
  function setViewportAdaptive(adaptive: boolean): void {
    viewportAdaptive.value = adaptive
  }

  /**
   * 自适应视口：
   * - 前台网页：跟随最近一次有效面板尺寸
   * - 后台网页：保持最后一次处于前台时的尺寸
   * - 从未测量/从未激活：退回全局固定尺寸
   */
  function getAdaptiveViewportSize(windowId: string): ViewportSize {
    const fixedFallback = (): ViewportSize => ({
      width: viewportWidth.value,
      height: viewportHeight.value,
    })

    if (windowId === activeWindowId.value) {
      return lastAdaptiveSize.value ? { ...lastAdaptiveSize.value } : fixedFallback()
    }

    const frozen = frozenAdaptiveSizes.value.get(windowId)
    if (frozen) return { ...frozen }
    return lastAdaptiveSize.value ? { ...lastAdaptiveSize.value } : fixedFallback()
  }

  /** 获取某网页的生效视口模式：优先按网页覆盖，否则用全局默认 */
  function getViewportMode(windowId: string): ViewportMode {
    const override = viewportOverrides.value.get(windowId)
    if (override === 'adaptive') return 'adaptive'
    if (override) return 'fixed'
    return viewportAdaptive.value ? 'adaptive' : 'fixed'
  }

  /** 获取某网页的生效渲染视口：优先按网页覆盖，否则用全局默认 */
  function getViewportSize(windowId: string): ViewportSize {
    const override = viewportOverrides.value.get(windowId)
    if (override === 'adaptive') return getAdaptiveViewportSize(windowId)
    if (override) return { ...override }
    if (viewportAdaptive.value) return getAdaptiveViewportSize(windowId)
    return { width: viewportWidth.value, height: viewportHeight.value }
  }

  /**
   * 设置某网页的渲染视口覆盖（预览工具栏入口，仅当前网页生效、不持久化）。
   * 与全局默认一致时不落覆盖项，保持"跟随默认"语义（默认值后续变更时自动跟随）。
   */
  function setWebviewViewport(windowId: string, width: number, height: number): void {
    const next = new Map(viewportOverrides.value)
    // 只有全局默认是固定尺寸时才可能"跟随默认"；全局自适应时，
    // 即使尺寸碰巧相同也必须落成固定覆盖，否则会退回自适应。
    if (
      !viewportAdaptive.value &&
      width === viewportWidth.value &&
      height === viewportHeight.value
    ) {
      next.delete(windowId)
    } else {
      next.set(windowId, { width, height })
    }
    viewportOverrides.value = next
  }

  /**
   * 强制写入某网页的固定视口覆盖（AI setViewportSize 入口）。
   * 与 setWebviewViewport 不同：即使尺寸等于全局默认也保留覆盖，
   * 保证该页后续不随全局默认变更而跳变。
   */
  function setWebviewViewportExact(windowId: string, width: number, height: number): void {
    const next = new Map(viewportOverrides.value)
    next.set(windowId, { width, height })
    viewportOverrides.value = next
  }

  /**
   * 设置某网页是否自适应预览面板（预览工具栏入口，仅当前网页生效、不持久化）。
   * 与全局默认一致时不落覆盖项，保持"跟随默认"语义。
   */
  function setWebviewAdaptive(windowId: string, adaptive: boolean): void {
    const next = new Map(viewportOverrides.value)
    if (adaptive === viewportAdaptive.value) {
      next.delete(windowId)
    } else {
      next.set(
        windowId,
        adaptive ? 'adaptive' : { width: viewportWidth.value, height: viewportHeight.value },
      )
    }
    viewportOverrides.value = next
  }

  function setActiveWebviewEl(el: HTMLElement | null): void {
    activeWebviewEl.value = el
  }

  function setNavState(state: { canGoBack?: boolean; canGoForward?: boolean; isLoading?: boolean }): void {
    if (state.canGoBack !== undefined) canGoBack.value = state.canGoBack
    if (state.canGoForward !== undefined) canGoForward.value = state.canGoForward
    if (state.isLoading !== undefined) isLoading.value = state.isLoading
  }

  /** 切换静音状态 */
  function toggleMuted(): void {
    isMuted.value = !isMuted.value
    const wv = activeWebviewEl.value as ElectronWebviewElement | null
    if (wv) {
      wv.setAudioMuted(isMuted.value)
    }
  }

  function clearAll(): void {
    webviews.value.clear()
    activeWindowId.value = null
    previewRect.value = null
    activeWebviewEl.value = null
    renderableOverrides.value.clear()
    renderableOverrides.value = new Set()
    viewportOverrides.value = new Map()
    frozenAdaptiveSizes.value = new Map()
    pointerLockedWindows.value = new Set()
  }

  // ── Getters ──

  /** 属于当前会话的 webview 列表（按 sessionId 过滤，主会话能看到包含子代理的全部窗口） */
  const sessionWebviews = computed<WebviewState[]>(() => {
    const sid = currentSessionId.value
    if (!sid) return []
    return Array.from(webviews.value.values()).filter(
      (wv) => wv.metadata?.sessionId === sid,
    )
  })

  /** 当前代理创建的 webview 列表（按 createdBy 过滤，每个代理只看自己创建的） */
  const agentWebviews = computed<WebviewState[]>(() => {
    const sid = currentSessionId.value
    if (!sid) return []
    return Array.from(webviews.value.values()).filter(
      (wv) => wv.metadata?.createdBy === sid,
    )
  })

  /** 当前活跃的 webview 状态 */
  const activeWebview = computed<WebviewState | null>(() => {
    if (!activeWindowId.value) return null
    return webviews.value.get(activeWindowId.value) || null
  })

  /** 当前活跃 webview 是否被网页锁定鼠标 */
  const isActivePointerLocked = computed(() => {
    const id = activeWindowId.value
    return !!id && pointerLockedWindows.value.has(id)
  })

  /** 所有 webview（用于 BrowserWebviewLayer 渲染） */
  const allWebviews = computed<WebviewState[]>(() => {
    return Array.from(webviews.value.values())
  })

  return {
    // state
    webviews,
    activeWindowId,
    previewRect,
    currentSessionId,
    isDragging,
    renderableOverrides,
    pointerLockedWindows,
    viewportWidth,
    viewportHeight,
    viewportAdaptive,
    lastAdaptiveSize,
    frozenAdaptiveSizes,
    viewportOverrides,
    canGoBack,
    canGoForward,
    isLoading,
    isMuted,
    activeWebviewEl,
    // getters
    sessionWebviews,
    agentWebviews,
    activeWebview,
    isActivePointerLocked,
    allWebviews,
    // actions
    addWebview,
    removeWebview,
    updateWebview,
    setActive,
    setPreviewRect,
    setCurrentSession,
    setDragging,
    setRenderableOverride,
    setPointerLocked,
    setViewportSize,
    setViewportAdaptive,
    getViewportMode,
    getViewportSize,
    setWebviewViewport,
    setWebviewViewportExact,
    setWebviewAdaptive,
    setActiveWebviewEl,
    setNavState,
    toggleMuted,
    clearAll,
  }
})
