<template>
  <!-- ⚠ 本组件必须是 MainLayout 的直接子节点且排在 SidebarLayout **之前**：
       #floating-chat 要早于 ChatPage 挂载，否则 Teleport 解析不到目标。
       另外它必须在 .content-card 之外——.content-card 带 z-index 形成层叠上下文，
       卡片内部的任何 z-index 都压不过卡片外的 BrowserWebviewLayer（z-40，
       全屏工作区里浏览器预览会盖住浮窗）。 -->

  <!-- 展开态面板：**常驻渲染**（不能 v-if，否则 Teleport 目标会消失）。
       隐藏走 visibility 而不是 display:none —— display:none 下滚动容器读不到布局，
       隐藏一次就把消息滚动位置丢了；visibility 保留布局，滚动位置与流式渲染都不受影响。
       隐藏后的回程入口在工作区工具栏的悬浮对话图标（与头部 ✕ 等价），
       面板自身不再留悬浮球之类的常驻小图标。 -->
  <div ref="panelRef" class="fcp-panel" :class="{ 'fcp-dragging': isDragging }" :style="panelStyle">
    <div class="fcp-header" @mousedown="startDrag" @dblclick="handleHeaderDblClick">
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <el-icon :size="14" class="shrink-0 fcp-header-icon"><ChatDotRound /></el-icon>
        <span class="truncate">{{ sessionTitle }}</span>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <button class="fcp-btn" :title="t('chat.floating.hide')" @click.stop="hide">
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>
    </div>

    <!-- Teleport 挂载点：ChatPage 把 ChatPanel 注入此处 -->
    <div id="floating-chat" class="fcp-body fcp-compact"></div>

    <!-- 尺寸把手：四边 + 四角。四条边都要有——面板默认停在右下角，右/下两条边已经贴着
         屏幕边缘，想变大只能从左/上两条边往外拖 -->
    <div v-for="handle in RESIZE_HANDLES" :key="handle" class="fcp-resize"
      :class="`fcp-resize--${handle}`" @mousedown="startResize(handle, $event)"></div>
  </div>

  <!-- 拖拽/缩放遮罩：阻止下层 webview/iframe 截获 mousemove 导致拖拽中断。
       cursor 是继承属性，遮蔽层会自动跟随 body 上设的光标 -->
  <Teleport to="body">
    <div v-if="isDragging" class="fcp-drag-overlay"></div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ChatDotRound, Close } from '@element-plus/icons-vue'
import { useLayoutStore } from '@/stores/layout'
import { useSessionStore } from '@/stores/session'
import { NEW_SESSION_ID } from '@/constants'
import {
  FLOATING_CHAT_DEFAULT_H,
  FLOATING_CHAT_DEFAULT_W,
  clampAnchor,
  clampSize,
  fromRelative,
  resolveResize,
  resolveTopReserve,
  toRelative,
  useFloatingChatViewport,
  type FloatingPoint,
  type FloatingRect,
  type FloatingResizeEdge,
  type FloatingSize,
} from '@/composables/useFloatingChatPanel'

const { t } = useI18n()
const route = useRoute()
const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()
const { viewport } = useFloatingChatViewport()

const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const isMac = isElectron && window.electronAPI?.platform === 'darwin'
/** 顶部禁入带：压住窗口拖拽区会让浮窗收不到鼠标事件（见 resolveTopReserve） */
const reserveTop = computed(() => resolveTopReserve({ isElectron, isMac }))

const panelRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)

/**
 * 拖拽/缩放期间的临时几何：只写本地 ref，松手才落 store。
 * 直接写 store 会经 useStorage 每帧写一次 localStorage。
 */
const liveAnchor = ref<FloatingPoint | null>(null)
const liveSize = ref<FloatingSize | null>(null)

const isChatRoute = computed(() => route.name === 'Chat')
const hasActiveSession = computed(
  () => !!sessionStore.activeSessionId && sessionStore.activeSessionId !== NEW_SESSION_ID,
)

/**
 * 面板是否可见：显示/隐藏状态与「视口是否放得下」都在 store（工作区工具栏的开关图标
 * 读的是同一份），这里只再叠加页面级条件——非会话页、会话无效时不渲染。
 */
const panelVisible = computed(
  () => layoutStore.floatingChatVisible && isChatRoute.value && hasActiveSession.value,
)

const sessionTitle = computed(() => {
  const sid = sessionStore.activeSessionId
  if (!sid || sid === NEW_SESSION_ID) return t('chat.floating.chat')
  return sessionStore.getSession(sid)?.title || t('chat.floating.chat')
})

/** 持久化尺寸（宽松读取 localStorage：脏值回默认，交给 clampSize 收口） */
const storedSize = computed<FloatingSize>(() => {
  const raw = layoutStore.floatingChatSize as Partial<FloatingSize> | null | undefined
  return {
    w: typeof raw?.w === 'number' && Number.isFinite(raw.w) ? raw.w : FLOATING_CHAT_DEFAULT_W,
    h: typeof raw?.h === 'number' && Number.isFinite(raw.h) ? raw.h : FLOATING_CHAT_DEFAULT_H,
  }
})

const resolvedSize = computed(() => clampSize(liveSize.value ?? storedSize.value, viewport.value, reserveTop.value))

/** 松手前的原始锚点；未拖拽时按相对坐标还原 */
const rawAnchor = computed(() => (
  liveAnchor.value ?? fromRelative(layoutStore.floatingChatPosition, viewport.value)
))

/** 已钳制的面板锚点 */
const panelAnchor = computed(() => clampAnchor(rawAnchor.value, resolvedSize.value, viewport.value, reserveTop.value))

/** 由右下角锚点反推 fixed 定位；right/bottom 与尺寸全部落整 CSS px */
function anchorStyle(anchor: FloatingPoint, size: FloatingSize): CSSProperties {
  const vp = viewport.value
  return {
    right: `${Math.max(0, Math.round(vp.w - anchor.x))}px`,
    bottom: `${Math.max(0, Math.round(vp.h - anchor.y))}px`,
    width: `${size.w}px`,
    height: `${size.h}px`,
  }
}

const panelStyle = computed<CSSProperties>(() => ({
  ...anchorStyle(panelAnchor.value, resolvedSize.value),
  visibility: panelVisible.value ? 'visible' : 'hidden',
  pointerEvents: panelVisible.value ? 'auto' : 'none',
}))

// ── 交互 ──

/** 头部 ✕ 与工作区工具栏的悬浮对话图标等价，都是切换显示/隐藏 */
function hide(): void {
  layoutStore.toggleFloatingChat()
}

/** 头部双击复位位置与尺寸（与 SidebarLayout 的把手双击复位同款） */
function handleHeaderDblClick(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  layoutStore.resetFloatingChatLayout()
  liveAnchor.value = null
  liveSize.value = null
}

/**
 * 统一的指针拖拽：rAF 节流（mousemove 可远高于帧率）+ 鼠标移出窗口也能收到 mouseup。
 */
function beginPointerDrag(e: MouseEvent, cursor: string, handlers: {
  onMove: (ev: MouseEvent) => void
  onUp: () => void
}): void {
  e.preventDefault()
  isDragging.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = cursor

  let rafId: number | null = null
  let pending: MouseEvent | null = null

  const onMove = (ev: MouseEvent): void => {
    pending = ev
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (pending) {
        const current = pending
        pending = null
        handlers.onMove(current)
      }
    })
  }

  const onUp = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    isDragging.value = false
    handlers.onUp()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** 把临时锚点落进 store（换算成相对坐标，窗口缩放后按比例还原） */
function commitAnchor(size: FloatingSize): void {
  const anchor = liveAnchor.value
  if (!anchor) return
  const clamped = clampAnchor(anchor, size, viewport.value, reserveTop.value)
  layoutStore.setFloatingChatPosition(toRelative(clamped, viewport.value))
  liveAnchor.value = null
}

function startDrag(e: MouseEvent): void {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button')) return
  const el = panelRef.value
  if (!el) return

  const rect = el.getBoundingClientRect()
  const startX = e.clientX
  const startY = e.clientY
  // 从实际渲染矩形取起点：持久化坐标被钳制过时，DOM 才是真相
  const startAnchor = { x: Math.round(rect.right), y: Math.round(rect.bottom) }

  beginPointerDrag(e, 'move', {
    onMove: (ev) => {
      liveAnchor.value = {
        x: startAnchor.x + (ev.clientX - startX),
        y: startAnchor.y + (ev.clientY - startY),
      }
    },
    onUp: () => commitAnchor(resolvedSize.value),
  })
}

/** 缩放手柄清单：四条边在前、四个角在后（角与边重叠时靠 DOM 顺序取胜） */
const RESIZE_HANDLES: FloatingResizeEdge[] = [
  'top', 'right', 'bottom', 'left',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
]

/** 各手柄的拖拽光标（对角方向直觉一致：拖右下角往右下即变大） */
const RESIZE_CURSORS: Record<FloatingResizeEdge, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
}

/**
 * 缩放：抓取边跟随光标，对角/对面那条边不动（几何见 resolveResize）。
 * 面板靠 right/bottom 定位，所以锚点必须与尺寸同向同步移动——只改尺寸会让抓取边
 * 原地不动、反而推着对边跑，方向就反了。
 */
function startResize(edge: FloatingResizeEdge, e: MouseEvent): void {
  if (e.button !== 0) return
  const el = panelRef.value
  if (!el) return

  const rect = el.getBoundingClientRect()
  const startRect: FloatingRect = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  }
  const startSize: FloatingSize = {
    w: startRect.right - startRect.left,
    h: startRect.bottom - startRect.top,
  }
  const startAnchor: FloatingPoint = { x: startRect.right, y: startRect.bottom }

  // 按下即接管几何：中途若仍读 store 里的旧尺寸，第一帧会跳一下
  liveSize.value = startSize
  liveAnchor.value = startAnchor
  let moved = false

  const startX = e.clientX
  const startY = e.clientY

  beginPointerDrag(e, RESIZE_CURSORS[edge], {
    onMove: (ev) => {
      moved = true
      const { size, anchor } = resolveResize(
        edge,
        { x: ev.clientX - startX, y: ev.clientY - startY },
        startRect,
        viewport.value,
        reserveTop.value,
      )
      liveSize.value = size
      liveAnchor.value = anchor
    },
    onUp: () => {
      // 只点了把手没拖动就不写 store（useStorage 每次写入都要落 localStorage）
      if (moved && liveSize.value && liveAnchor.value) {
        layoutStore.setFloatingChatSize(liveSize.value)
        layoutStore.setFloatingChatPosition(toRelative(liveAnchor.value, viewport.value))
      }
      liveSize.value = null
      liveAnchor.value = null
    },
  })
}
</script>

<style scoped>
/* 层级：高于 BrowserWebviewLayer(40) / webview(40) / 拖拽遮罩(50)——否则全屏工作区里
   浏览器预览会盖住浮窗；低于 CommandPicker(1000) 与 GdDialog(2000)——弹窗必须压住浮窗。
   注意本组件挂在 .content-card 之外，这些数字才与 BrowserWebviewLayer 在同一层叠上下文里 */
.fcp-panel {
  position: fixed;
  z-index: 100;
  /* 三处浮窗元素都显式声明 no-drag：Electron 的拖拽区按布局算、不看层叠顺序，
     只要浮窗压在任何 drag-region（标题栏行、mac 的内容首行）之上，那片区域就会被
     当成窗口拖拽区，浮窗自己的鼠标事件全部收不到。no-drag 把它从拖拽区里减掉。 */
  -webkit-app-region: no-drag;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--gd-color-bg, #ffffff);
  border: 1px solid var(--gd-color-surface-border, #e5e7eb);
  border-radius: var(--gd-size-dialog-rounded-radius, 12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.dark .fcp-panel {
  background: var(--gd-color-bg, #1a1a1a);
  border-color: var(--gd-color-surface-border, #2e3035);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.fcp-header {
  flex-shrink: 0;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 12px;
  cursor: move;
  user-select: none;
  background: var(--gd-color-surface, #f9fafb);
  font-size: 12px;
  color: var(--gd-color-text-gray, #6b7280);
}

.dark .fcp-header {
  background: var(--gd-color-surface, #1a1a1a);
  border-bottom: 1px solid var(--gd-color-surface-border, #2e3035);
}

.fcp-header-icon {
  color: var(--gd-color-text-gray, #9ca3af);
}

.fcp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--gd-color-text-gray, #9ca3af);
  transition: background 0.15s, color 0.15s;
}

.fcp-btn:hover {
  background: var(--gd-color-sidebar-bg-hover, #f3f4f6);
  color: var(--gd-color-text, #374151);
}

.fcp-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 尺寸把手：贴在内缘（面板 overflow:hidden，放外面会被裁掉）。
   四边是 4px 细条（与 GdSplitpanes 的 splitter 同款命中宽度），四角 14px 方块；
   角排在 DOM 后面，重叠处由角接管 ── */
.fcp-resize {
  position: absolute;
  z-index: 2;
}

.fcp-resize--top {
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  cursor: ns-resize;
}

.fcp-resize--bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  cursor: ns-resize;
}

.fcp-resize--left {
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: ew-resize;
}

.fcp-resize--right {
  right: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: ew-resize;
}

.fcp-resize--top-left,
.fcp-resize--top-right,
.fcp-resize--bottom-left,
.fcp-resize--bottom-right {
  width: 14px;
  height: 14px;
}

.fcp-resize--top-left {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.fcp-resize--top-right {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.fcp-resize--bottom-left {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

.fcp-resize--bottom-right {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}

/* 拖拽/缩放期间禁用过渡，否则跟手会有延迟感 */
.fcp-dragging,
.fcp-dragging * {
  transition: none !important;
}

.fcp-dragging :deep(iframe) {
  pointer-events: none !important;
}

/* ── 主动隐藏由工作区工具栏的悬浮对话图标负责，面板自身不留常驻小图标 ── */

/* 拖拽遮罩：盖住所有下层元素（含 webview），z-index 需要压过 body 下的一切内容层 */
.fcp-drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
}

/* ── 极简模式 ──
   面板默认只有 430px 宽，这里只收「输入区自身」的边距与外框，把空间让给输入框。
   消息列那侧的纵向留白一律不动：末回合的 25px 尾距 + .chat-messages 的 20px 下内边距
   合计 45px，是给状态胶囊（.composer-status-row 浮在输入区上方 6px）留的避让位——
   收掉之后胶囊一出现就会压住最后一条消息。看起来像"白占空间"，实则不是。
   下列类名全部来自 ChatPanel/ChatInput/ScrollContainer，对方改名会静默失效，
   改动那几处时请一起回归。 */
.fcp-compact :deep(.chat-column) {
  max-width: 100% !important;
}

.fcp-compact :deep(.chat-messages) {
  padding-left: 12px !important;
  padding-right: 12px !important;
}

.fcp-compact :deep(.chat-scroll-container) {
  padding: 0 !important;
}

/* 输入区容器：pb-2 的 8px 下边距归零，输入框直接贴面板底边 */
.fcp-compact :deep(.chat-input-area) {
  padding-bottom: 0 !important;
}

/* 输入框：去掉为圆角卡片留的外框，只留一条顶部分隔线，内边距 12/10/10 → 8 */
.fcp-compact :deep(.input-area) {
  border: none !important;
  border-top: 1px solid var(--gd-color-input-border, #e5e7eb) !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  min-height: auto !important;
  padding: 8px !important;
}

/* 模型选择器在 430px 里放不下，浮窗模式隐藏（改用会话默认模型） */
.fcp-compact :deep(.model-selector-btn) {
  display: none !important;
}

/* 隐藏滚动条但保留滚轮 */
.fcp-compact :deep(.scroll-container) {
  scrollbar-width: none;
}

.fcp-compact :deep(.scroll-container::-webkit-scrollbar) {
  display: none;
}

/* 末尾对话的呼吸位（last:min-h-[60vh]）是为整屏高度准备的，浮窗里只会白占空间 */
.fcp-compact :deep(.turn-wrapper--last) {
  min-height: 0 !important;
}
</style>
