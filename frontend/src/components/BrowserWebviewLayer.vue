<template>
  <!-- Webview 浮层容器：fixed 定位，不拦截事件 -->
  <div class="browser-webview-layer">
    <div v-for="wv in store.allWebviews" :key="wv.windowId" class="webview-wrapper"
      :style="getWebviewStyle(wv.windowId)">
      <webview
        :ref="(el: Element | ComponentPublicInstance | null) => setWebviewRef(wv.windowId, el as HTMLElement | null)"
        :partition="wv.partition" :preload="wv.preloadUrl" autosize="on" allowpopups
        @did-navigate="onNavigate($event, wv.windowId)" @did-navigate-in-page="onNavigateInPage($event, wv.windowId)"
        @page-title-updated="onTitleUpdated($event, wv.windowId)" @did-stop-loading="onStopLoading($event, wv.windowId)"
        @did-start-loading="onStartLoading($event, wv.windowId)" />
    </div>
    <!-- 拖拽遮罩层：覆盖在 webview 上方，阻止 webview 截获鼠标事件 -->
    <div v-if="store.isDragging && store.previewRect" class="drag-overlay" :style="getOverlayStyle()"></div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, watch, type ComponentPublicInstance } from 'vue'
import { useBrowserWebviewStore, type PreviewRect } from '@/stores/browserWebview'
import { useLayoutStore } from '@/stores/layout'
import { useTabStore } from '@/stores/tab'

const store = useBrowserWebviewStore()

/** webview DOM 元素引用 Map（windowId → HTMLElement） */
const webviewEls = new Map<string, HTMLElement>()

/**
 * 注册/注销 webview DOM 元素引用
 */
function setWebviewRef(windowId: string, el: HTMLElement | null): void {
  if (el) {
    webviewEls.set(windowId, el)
    const wv = el as ElectronWebviewElement

    // 初始 URL 只在 webview DOM 节点第一次绑定时设置一次。
    // 当前 URL 会由 did-navigate 同步到 store，但不能再反向驱动 src，避免重复导航。
    if (!wv.hasAttribute('src')) {
      const initialUrl = store.webviews.get(windowId)?.url
      if (initialUrl) wv.setAttribute('src', initialUrl)
    }

    // dom-ready 后才能调用 setAudioMuted 等方法
    const applyMute = () => { wv.setAudioMuted?.(store.isMuted) }
    if (wv.isReady) {
      applyMute()
    } else {
      wv.addEventListener('dom-ready', applyMute, { once: true })
    }
    // 如果是当前活跃窗口，同步到 store
    if (windowId === store.activeWindowId) {
      store.setActiveWebviewEl(el)
      syncNavState(el)
    }
  } else {
    webviewEls.delete(windowId)
    if (windowId === store.activeWindowId) {
      store.setActiveWebviewEl(null)
    }
  }
}

/**
 * 从 webview DOM 元素同步导航状态到 store
 */
function syncNavState(el: HTMLElement): void {
  const wv = el as ElectronWebviewElement
  try {
    store.setNavState({
      canGoBack: !!wv.canGoBack,
      canGoForward: !!wv.canGoForward,
    })
  } catch {
    // webview 属性可能尚未就绪
  }
}

/** 非活跃 webview 的默认后台渲染尺寸，确保 agent 创建的窗口即使未被用户打开也能正常渲染 */
const DEFAULT_BG_WIDTH = 1280
const DEFAULT_BG_HEIGHT = 720

/**
 * 计算 webview wrapper 的样式
 * 活跃 webview：跟随预览占位区域位置，visibility: visible
 * 非活跃 webview：visibility: hidden, z-index: -1（保留渲染进度），使用默认分辨率确保后台渲染
 * 拖拽中：pointer-events: none（防止 webview 截获鼠标事件导致拖拽中断）
 */
function getWebviewStyle(windowId: string): Record<string, string> {
  const isActive = windowId === store.activeWindowId
  const rect: PreviewRect | null = store.previewRect
  const isRenderable = store.renderableOverrides.has(windowId)

  // 活跃且可见的 webview：正常显示（截图也走这个路径，已可见无需离屏）
  if (isActive && rect) {
    return {
      visibility: 'visible',
      zIndex: '40',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: store.isDragging ? 'none' : 'auto',
    }
  }

  // 非活跃或活跃但无 rect 的 webview
  if (isRenderable) {
    // 临时渲染模式：在视口内但透明不可见（opacity:0 不影响合成器产帧，离屏则不产帧）
    return {
      visibility: 'visible',
      zIndex: '-1',
      left: '0px',
      top: '0px',
      width: `${DEFAULT_BG_WIDTH}px`,
      height: `${DEFAULT_BG_HEIGHT}px`,
      opacity: '0',
      pointerEvents: 'none',
    }
  }

  // 默认：visibility:hidden 节省渲染开销
  return {
    visibility: 'hidden',
    zIndex: '-1',
    left: '0px',
    top: '0px',
    width: `${DEFAULT_BG_WIDTH}px`,
    height: `${DEFAULT_BG_HEIGHT}px`,
    pointerEvents: 'none',
  }
}

/**
 * 拖拽遮罩层样式：覆盖在活跃 webview 区域上方，阻止 webview 截获鼠标事件。
 * z-index 高于 webview(40)，pointer-events: auto 确保拦截所有事件。
 */
function getOverlayStyle(): Record<string, string> {
  const rect = store.previewRect
  if (!rect) return { display: 'none' }
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}

// ── Webview 事件处理 ──

function onNavigate(event: any, windowId: string): void {
  if (event?.url) {
    store.updateWebview(windowId, { url: event.url })
  }
  // 导航完成后同步导航按钮状态
  const el = webviewEls.get(windowId)
  if (el && windowId === store.activeWindowId) {
    syncNavState(el)
  }
}

function onNavigateInPage(event: any, windowId: string): void {
  if (event?.isMainFrame && event?.url) {
    store.updateWebview(windowId, { url: event.url })
  }
}

function onTitleUpdated(event: any, windowId: string): void {
  if (event?.title) {
    store.updateWebview(windowId, { title: event.title })
  }
}

function handleWindowFaviconUpdated(
  _event: any,
  data: { windowId: string; favicon: string },
): void {
  if (data?.windowId && data.favicon) {
    console.info('[Favicon] renderer received', {
      windowId: data.windowId,
      chars: data.favicon.length,
      prefix: data.favicon.slice(0, 32),
    })
    store.updateWebview(data.windowId, { favicon: data.favicon })
  } else {
    console.warn('[Favicon] renderer received invalid payload', data?.windowId)
  }
}

function onStartLoading(_event: any, windowId: string): void {
  if (windowId === store.activeWindowId) {
    store.setNavState({ isLoading: true })
  }
}

function onStopLoading(_event: any, windowId: string): void {
  if (windowId === store.activeWindowId) {
    store.setNavState({ isLoading: false })
    const el = webviewEls.get(windowId)
    if (el) syncNavState(el)
  }
}

// ── 监听活跃窗口变化，同步 webview 元素和导航状态 ──

watch(
  () => store.activeWindowId,
  (windowId) => {
    if (windowId) {
      const el = webviewEls.get(windowId)
      if (el) {
        store.setActiveWebviewEl(el)
        syncNavState(el)
        // 注意：此处不再调用 setAudioMuted。
        // 静音状态统一由 setWebviewRef 在 webview dom-ready 时应用（每个 webview 必经），
        // 用户切换静音由 store.toggleMuted 负责。切换激活标签时各 webview 早已 ready，
        // 静音状态已应用，无需在此重复设置——避免在 webview 未 ready 时调用
        // setAudioMuted 抛异常、中断 Vue 响应式更新循环。
      } else {
        store.setActiveWebviewEl(null)
      }
    } else {
      store.setActiveWebviewEl(null)
    }
  },
)

// ── IPC 监听 ──

function handleCreateWebview(_event: any, data: {
  windowId: string
  partition: string
  url: string
  preloadUrl: string
  metadata?: any
}): void {
  store.addWebview({
    windowId: data.windowId,
    url: data.url,
    title: data.url || '新窗口',
    partition: data.partition,
    preloadUrl: data.preloadUrl,
    isVisible: false,
    metadata: data.metadata,
  })

  // 新建标签自动打开预览模式：属于当前会话的窗口创建即激活。
  // 说明：这是 AI 路径唯一的确定性触发源（主进程创建 webview 后不会主动 setActive）。
  // 用户路径（previewUrl/createNewBrowserWindow）会再幂等执行一次 enterPreviewMode+selectTab，无害。
  if (data.metadata?.sessionId && data.metadata.sessionId === store.currentSessionId) {
    const layoutStore = useLayoutStore()
    layoutStore.workspaceVisible = true
    nextTick(() => {
      const tabStore = useTabStore()
      tabStore.enterPreviewMode()
      tabStore.selectTab(`browser:${data.windowId}`)
    })
  }
}

function handleDestroyWebview(_event: any, data: { windowId: string }): void {
  webviewEls.delete(data.windowId)
  store.removeWebview(data.windowId)
}

function handleSetVisibility(_event: any, data: { windowId: string; visible: boolean }): void {
  if (data.visible) {
    store.setActive(data.windowId)
  } else {
    if (store.activeWindowId === data.windowId) {
      store.setActive(null)
    }
  }
}

function handleSetRenderable(_event: any, data: { windowId: string; renderable: boolean }): void {
  store.setRenderableOverride(data.windowId, data.renderable)
}

onMounted(() => {
  const api = window.electronAPI
  if (!api) return

  // 监听 webview 生命周期事件
  api.onCreateWebview?.(handleCreateWebview)
  api.onDestroyWebview?.(handleDestroyWebview)
  api.onSetWebviewVisibility?.(handleSetVisibility)
  api.onSetWebviewRenderable?.(handleSetRenderable)
  api.onWindowFaviconUpdated?.(handleWindowFaviconUpdated)
})

onUnmounted(() => {
  // IPC 监听器由主进程管理，无需手动移除
})
</script>

<style scoped>
.browser-webview-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /* 容器不拦截事件 */
  z-index: 40;
}

.webview-wrapper {
  position: fixed;
  overflow: hidden;
  /* 无 transition：切换标签时从 0,0 放大到目标尺寸会产生闪屏 */
}

.webview-wrapper webview {
  width: 100%;
  height: 100%;
  border: none;
  display: flex;
  pointer-events: auto;
}

/* 拖拽遮罩层：覆盖在 webview 上方，阻止 webview 截获鼠标事件 */
.drag-overlay {
  position: fixed;
  z-index: 50;
  /* 高于 webview(40) */
  pointer-events: auto;
  /* 拦截所有鼠标事件，防止穿透到 webview */
  background: transparent;
  cursor: col-resize;
}
</style>
