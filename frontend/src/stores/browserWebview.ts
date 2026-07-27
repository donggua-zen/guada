// stores/browserWebview.ts
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { useLayoutStore } from '@/stores/layout'

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
  metadata?: Record<string, any>
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

  function setActive(windowId: string | null): void {
    activeWindowId.value = windowId
    // 同步更新 isVisible 状态
    for (const [id, wv] of webviews.value.entries()) {
      wv.isVisible = id === windowId
    }
    // 激活窗口时进入预览模式，取消激活时由调用方控制是否退出
    if (windowId) {
      const layoutStore = useLayoutStore()
      layoutStore.workspacePreviewMode = true
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
  }

  function setCurrentSession(sessionId: string | null): void {
    currentSessionId.value = sessionId
    // 会话切换时隐藏活跃窗口（webview 不销毁，仅视觉隐藏）
    activeWindowId.value = null
    previewRect.value = null
    activeWebviewEl.value = null
  }

  function setDragging(val: boolean): void {
    isDragging.value = val
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
    canGoBack,
    canGoForward,
    isLoading,
    isMuted,
    activeWebviewEl,
    // getters
    sessionWebviews,
    agentWebviews,
    activeWebview,
    allWebviews,
    // actions
    addWebview,
    removeWebview,
    updateWebview,
    setActive,
    setPreviewRect,
    setCurrentSession,
    setDragging,
    setActiveWebviewEl,
    setNavState,
    toggleMuted,
    clearAll,
  }
})
