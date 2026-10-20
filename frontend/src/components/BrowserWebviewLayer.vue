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
    <!-- 指针锁提示：网页（如 three.js 游戏）锁定鼠标时显示，不阻挡画面事件 -->
    <div
      v-if="store.isActivePointerLocked && store.previewRect"
      class="pointer-lock-hint"
      :style="getPointerLockHintStyle()"
    >
      {{ t('chat.workspace.pointerLockHint') }}
    </div>
    <!-- 拖拽遮罩层：覆盖在 webview 上方，阻止 webview 截获鼠标事件 -->
    <div v-if="store.isDragging && store.previewRect" class="drag-overlay" :style="getOverlayStyle()"></div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, watch, type ComponentPublicInstance } from 'vue'
import { useBrowserWebviewStore, type PreviewRect } from '@/stores/browserWebview'
import type {
  BrowserPointerLockPayload,
  WebviewCreatePayload,
  WebviewDestroyPayload,
  WebviewRenderablePayload,
  WebviewVisibilityPayload,
  WindowFaviconPayload,
} from '@/types/electron'
import { useLayoutStore } from '@/stores/layout'
import { useTabStore } from '@/stores/tab'
import { getAutoShowSidebar } from '@/utils/workspacePreview'
import { t } from '@/locales'

const store = useBrowserWebviewStore()
const tabStore = useTabStore()

/**
 * 浏览器 store → tabStore 同步（常驻于此，而非 OverviewPanel）：
 * 概览面板是条件渲染（asideWidth>0 才挂载），概览折叠/宽度不足时 watch 失效，
 * 会导致新建浏览器窗口后标签永不进入 tabs → 标签栏无标签、activeTab 找不到
 * browser 标签 → 占位区不渲染 → previewRect 为 null → 页面不显示。
 * BrowserWebviewLayer 挂在 MainLayout 层，始终常驻，同步不会断。
 */
watch(
  () => store.activeWindowId,
  () => tabStore.syncActiveWindowId(),
);
watch(
  () =>
    store.sessionWebviews
      .map((w) => `${w.windowId}\0${w.title}\0${w.favicon || ""}\0${w.url}`)
      .join("\n"),
  () => {
    tabStore.syncBrowserTabs(
      store.sessionWebviews.map((w) => ({
        windowId: w.windowId,
        title: w.title,
        favicon: w.favicon,
        url: w.url,
      })),
      // 传当前会话：会话切换瞬间 currentSessionId 已变而 tabStore 仍属旧会话，
      // store 内会据此跳过一次同步，避免旧会话浏览器标签在快照保存前被裁掉
      store.currentSessionId,
    );
  },
);

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

/**
 * 计算 webview wrapper 的样式
 *
 * 所有 webview 恒定使用固定渲染视口（按网页覆盖，否则全局默认，见
 * store.getViewportSize），前台/后台/截图三态的 webview 布局盒尺寸完全一致：
 * - 活跃 webview：按预览占位区域等比缩放显示（留白居中），transform 是
 *   合成器层面的显示变换，不改变 webview 布局盒——页面 innerWidth/innerHeight、
 *   截图尺寸、CDP 坐标均不随面板拖拽/可见性跳变
 * - 非活跃 webview：visibility: hidden, z-index: -1（保留渲染进度）
 * - 拖拽中：pointer-events: none（防止 webview 截获鼠标事件导致拖拽中断）
 */
function getWebviewStyle(windowId: string): Record<string, string> {
  const isActive = windowId === store.activeWindowId
  const rect: PreviewRect | null = store.previewRect
  const isRenderable = store.renderableOverrides.has(windowId)
  const { width: vw, height: vh } = store.getViewportSize(windowId)

  // 活跃且可见的 webview：固定视口 + 等比缩放留白居中（截图也走这个路径，已可见无需离屏）
  if (isActive && rect) {
    const scale = Math.min(rect.width / vw, rect.height / vh)
    const offsetX = (rect.width - vw * scale) / 2
    const offsetY = (rect.height - vh * scale) / 2
    return {
      visibility: 'visible',
      zIndex: '40',
      left: `${rect.x + offsetX}px`,
      top: `${rect.y + offsetY}px`,
      width: `${vw}px`,
      height: `${vh}px`,
      transform: `scale(${scale})`,
      transformOrigin: '0 0',
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
      width: `${vw}px`,
      height: `${vh}px`,
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
    width: `${vw}px`,
    height: `${vh}px`,
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

/** 指针锁提示位置：预览区顶部居中 */
function getPointerLockHintStyle(): Record<string, string> {
  const rect = store.previewRect
  if (!rect) return { display: 'none' }
  return {
    left: `${rect.x + rect.width / 2}px`,
    top: `${rect.y + 12}px`,
  }
}

// ── Webview 事件处理 ──

function onNavigate(event: ElectronWebviewNavigateEvent, windowId: string): void {
  if (event?.url) {
    store.updateWebview(windowId, { url: event.url })
  }
  // 导航完成后同步导航按钮状态
  const el = webviewEls.get(windowId)
  if (el && windowId === store.activeWindowId) {
    syncNavState(el)
  }
}

function onNavigateInPage(event: ElectronWebviewNavigateEvent, windowId: string): void {
  if (event?.isMainFrame && event?.url) {
    store.updateWebview(windowId, { url: event.url })
  }
}

function onTitleUpdated(event: ElectronWebviewTitleUpdatedEvent, windowId: string): void {
  if (event?.title) {
    store.updateWebview(windowId, { title: event.title })
  }
}

function handleWindowFaviconUpdated(
  _event: unknown,
  data: WindowFaviconPayload,
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

function onStartLoading(_event: unknown, windowId: string): void {
  if (windowId === store.activeWindowId) {
    store.setNavState({ isLoading: true })
  }
}

function onStopLoading(_event: unknown, windowId: string): void {
  if (windowId === store.activeWindowId) {
    store.setNavState({ isLoading: false })
    const el = webviewEls.get(windowId)
    if (el) syncNavState(el)
  }
}

// ── 监听活跃窗口变化，同步 webview 元素和导航状态 ──

// 切换标签/会话时释放旧窗口的指针锁，避免隐藏的页面继续锁定输入
watch(
  () => store.activeWindowId,
  (windowId, previousWindowId) => {
    if (previousWindowId && previousWindowId !== windowId) {
      void window.electronAPI?.releaseBrowserInput?.(previousWindowId, {
        focusHost: false,
      })
    }
  },
)

// 预览区隐藏（关闭工作区/折叠侧栏）时同样释放
watch(
  () => store.previewRect,
  (rect) => {
    const windowId = store.activeWindowId
    if (!rect && windowId) {
      void window.electronAPI?.releaseBrowserInput?.(windowId, {
        focusHost: false,
      })
    }
  },
)

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

function handleCreateWebview(_event: unknown, data: WebviewCreatePayload): void {
  store.addWebview({
    windowId: data.windowId,
    url: data.url,
    title: data.url || t('common.newWindow'),
    partition: data.partition,
    preloadUrl: data.preloadUrl,
    isVisible: false,
    metadata: data.metadata,
  })

  // 新建标签：属于当前会话的窗口，根据设置决定是否自动展开侧边栏。
  // 说明：这是 AI 路径唯一的确定性触发源（主进程创建 webview 后不会主动 setActive）。
  // 用户路径（previewUrl/createNewBrowserWindow）会再幂等执行一次 selectTab，无害。
  if (data.metadata?.sessionId && data.metadata.sessionId === store.currentSessionId) {
    if (!getAutoShowSidebar()) return
    const layoutStore = useLayoutStore()
    layoutStore.workspaceVisible = true
    nextTick(() => {
      const tabStore = useTabStore()
      tabStore.selectTab(`browser:${data.windowId}`)
    })
  }
}

function handleDestroyWebview(_event: unknown, data: WebviewDestroyPayload): void {
  webviewEls.delete(data.windowId)
  store.removeWebview(data.windowId)
}

function handleSetVisibility(_event: unknown, data: WebviewVisibilityPayload): void {
  if (data.visible) {
    store.setActive(data.windowId)
  } else {
    if (store.activeWindowId === data.windowId) {
      store.setActive(null)
    }
  }
}

function handleSetRenderable(_event: unknown, data: WebviewRenderablePayload): void {
  store.setRenderableOverride(data.windowId, data.renderable)
}

function handlePointerLockChanged(_event: unknown, data: BrowserPointerLockPayload): void {
  if (!data?.windowId) return
  store.setPointerLocked(data.windowId, !!data.locked)
}

onMounted(() => {
  // 默认渲染视口由启动流程统一加载（main.js → loadBrowserSettings，browser 分组只拉一次），
  // 本组件只读 store 现值，不再自己发请求。
  const api = window.electronAPI
  if (!api) return

  // 监听 webview 生命周期事件
  api.onCreateWebview?.(handleCreateWebview)
  api.onDestroyWebview?.(handleDestroyWebview)
  api.onSetWebviewVisibility?.(handleSetVisibility)
  api.onSetWebviewRenderable?.(handleSetRenderable)
  api.onWindowFaviconUpdated?.(handleWindowFaviconUpdated)
  api.onBrowserPointerLockChanged?.(handlePointerLockChanged)
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

/* 指针锁提示：网页锁定鼠标时显示在预览区顶部 */
.pointer-lock-hint {
  position: fixed;
  z-index: 45;
  transform: translateX(-50%);
  pointer-events: none;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(17, 24, 39, 0.78);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(4px);
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
