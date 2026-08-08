<template>
  <!-- 悬浮球（折叠态） -->
  <div
    v-if="visible && layoutStore.floatingChatCollapsed"
    ref="ballRef"
    class="floating-chat-ball"
    :style="positionStyle"
    @mousedown="startBallDrag"
  >
    <el-icon :size="20"><ChatDotRound /></el-icon>
  </div>

  <!-- 展开态面板 -->
  <div
    v-show="visible && !layoutStore.floatingChatCollapsed"
    ref="containerRef"
    class="floating-chat-container"
    :class="{ dragging: isDragging }"
    :style="positionStyle"
  >
    <!-- 拖拽头栏 -->
    <div class="floating-chat-header" @mousedown="startDrag">
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <el-icon :size="14" class="text-gray-400 shrink-0"><ChatDotRound /></el-icon>
        <span class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ sessionTitle }}</span>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <button class="floating-chat-btn" @click.stop="collapse" title="收起">
          <el-icon :size="14"><ArrowDown /></el-icon>
        </button>
        <button class="floating-chat-btn" @click.stop="hide" title="隐藏">
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>
    </div>
    <!-- Teleport 挂载点（ChatPanel 通过 Teleport 注入此处） -->
    <div id="floating-chat" class="floating-chat-body floating-chat-mode"></div>
  </div>

  <!-- 拖拽时全屏遮罩，阻止鼠标事件穿透到下层元素 -->
  <Teleport to="body">
    <div v-if="isDragging" class="floating-chat-drag-overlay-global"></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowDown, Close, ChatDotRound } from '@element-plus/icons-vue'
import { useLayoutStore } from '@/stores/layout'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()
const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const DRAG_FORBIDDEN_TOP = isElectron ? 44 : 0
const MARGIN = 8
const BALL_SIZE = 40

const containerRef = ref<HTMLElement | null>(null)
const ballRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)

/** 响应式的视口尺寸，resize 时自动更新 */
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)

/** 面板是否放得下当前视口 */
const panelFits = computed(() => {
  const w = Math.min(viewportW.value * 0.4, 430)
  const h = Math.min(viewportH.value * 0.7, 700)
  return viewportW.value >= w + MARGIN * 2
    && viewportH.value >= h + MARGIN * 2 + DRAG_FORBIDDEN_TOP
})

/** 当前会话标题 */
const sessionTitle = computed(() => {
  const sid = sessionStore.activeSessionId
  if (!sid || sid === 'new-session') return '对话'
  return sessionStore.getSession(sid)?.title || '对话'
})

/** 仅在会话页面显示 */
const isChatRoute = computed(() => route.name === 'Chat')

const visible = computed(
  () => layoutStore.workspaceFullscreen
    && layoutStore.workspaceVisible
    && !layoutStore.floatingChatHidden
    && isChatRoute.value
    && !!sessionStore.activeSessionId
    && sessionStore.activeSessionId !== 'new-session'
    && panelFits.value,
)

/** 面板/悬浮球当前尺寸 */
const elementW = computed(() => {
  if (layoutStore.floatingChatCollapsed) return BALL_SIZE
  return containerRef.value?.offsetWidth || 430
})
const elementH = computed(() => {
  if (layoutStore.floatingChatCollapsed) return BALL_SIZE
  // 实际渲染高度受 max-height: 70vh 限制
  const cssH = Math.min(viewportH.value * 0.7, 700)
  return containerRef.value?.offsetHeight || cssH
})

/**
 * 统一定位样式（右下角锚点）。
 * 存储相对位置 rx/ry (0~1)，代表元素右下角在视口中的比例位置。
 * viewportW/H 是响应式的，resize 自动重算。
 */
const positionStyle = computed(() => {
  const raw = layoutStore.floatingChatPosition
  const rx = (typeof raw.rx === 'number' && !isNaN(raw.rx)) ? raw.rx : 1
  const ry = (typeof raw.ry === 'number' && !isNaN(raw.ry)) ? raw.ry : 1
  const vw = viewportW.value
  const vh = viewportH.value
  const w = elementW.value
  const h = elementH.value

  // 相对坐标 → 像素坐标（右下角）
  let rbX = rx * vw
  let rbY = ry * vh

  // clamp：右下角在视口内 + 左上角也在视口内 + 顶部不低于 Electron 标题栏
  rbX = Math.max(MARGIN + w, Math.min(vw - MARGIN, rbX))
  rbY = Math.max(MARGIN + h + DRAG_FORBIDDEN_TOP, Math.min(vh - MARGIN, rbY))
  if (rbX - w < MARGIN) rbX = MARGIN + w
  if (rbY - h < MARGIN + DRAG_FORBIDDEN_TOP) rbY = MARGIN + h + DRAG_FORBIDDEN_TOP

  return {
    right: `${vw - rbX}px`,
    bottom: `${vh - rbY}px`,
  }
})

function collapse() {
  layoutStore.floatingChatCollapsed = true
}

function expand() {
  layoutStore.floatingChatCollapsed = false
}

function hide() {
  layoutStore.floatingChatHidden = true
}

/** 像素坐标 → 相对坐标 */
function toRelative(rbX: number, rbY: number): { rx: number; ry: number } {
  const vw = viewportW.value
  const vh = viewportH.value
  return {
    rx: Math.max(0, Math.min(1, rbX / vw)),
    ry: Math.max(0, Math.min(1, rbY / vh)),
  }
}

/** 拖拽时 clamp：右下角 + 左上角都在视口内 + 顶部不低于标题栏 */
function clampPixels(rbX: number, rbY: number, w: number, h: number): { x: number; y: number } {
  const vw = viewportW.value
  const vh = viewportH.value
  let x = Math.max(MARGIN + w, Math.min(vw - MARGIN, rbX))
  let y = Math.max(MARGIN + h + DRAG_FORBIDDEN_TOP, Math.min(vh - MARGIN, rbY))
  if (x - w < MARGIN) x = MARGIN + w
  if (y - h < MARGIN + DRAG_FORBIDDEN_TOP) y = MARGIN + h + DRAG_FORBIDDEN_TOP
  return { x, y }
}

function startDrag(e: MouseEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button')) return
  if (e.clientY < DRAG_FORBIDDEN_TOP) return
  const container = containerRef.value
  if (!container) return

  const rect = container.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  const startX = e.clientX
  const startY = e.clientY
  let curRBX = rect.right
  let curRBY = rect.bottom

  container.style.left = 'auto'
  container.style.top = 'auto'
  container.style.right = `${viewportW.value - curRBX}px`
  container.style.bottom = `${viewportH.value - curRBY}px`
  document.body.style.userSelect = 'none'
  isDragging.value = true

  let rafId: number | null = null
  let pendingX = curRBX
  let pendingY = curRBY

  function onMove(ev: MouseEvent) {
    pendingX = curRBX + (ev.clientX - startX)
    pendingY = curRBY + (ev.clientY - startY)
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (!container) return
      const clamped = clampPixels(pendingX, pendingY, w, h)
      container.style.right = `${viewportW.value - clamped.x}px`
      container.style.bottom = `${viewportH.value - clamped.y}px`
    })
  }

  function onUp() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    isDragging.value = false
    const clamped = clampPixels(pendingX, pendingY, w, h)
    layoutStore.floatingChatPosition = toRelative(clamped.x, clamped.y)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** 悬浮球拖拽（点击和拖拽区分：移动超过 4px 视为拖拽） */
function startBallDrag(e: MouseEvent) {
  if (e.button !== 0) return
  if (e.clientY < DRAG_FORBIDDEN_TOP) return
  const ball = ballRef.value
  if (!ball) return

  const rect = ball.getBoundingClientRect()
  const startX = e.clientX
  const startY = e.clientY
  const startPosX = rect.right
  const startPosY = rect.bottom
  let moved = false

  document.body.style.userSelect = 'none'

  let rafId: number | null = null
  let pendingX = startPosX
  let pendingY = startPosY

  function onMove(ev: MouseEvent) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    moved = true
    if (!isDragging.value) isDragging.value = true
    pendingX = startPosX + dx
    pendingY = startPosY + dy
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (!ball) return
      const clamped = clampPixels(pendingX, pendingY, BALL_SIZE, BALL_SIZE)
      ball.style.right = `${viewportW.value - clamped.x}px`
      ball.style.bottom = `${viewportH.value - clamped.y}px`
    })
  }

  function onUp() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    isDragging.value = false
    if (moved) {
      const clamped = clampPixels(pendingX, pendingY, BALL_SIZE, BALL_SIZE)
      layoutStore.floatingChatPosition = toRelative(clamped.x, clamped.y)
    } else {
      expand()
    }
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** 窗口缩放时更新视口尺寸（positionStyle 是 computed，自动跟随） + 自动隐藏/恢复 */
function handleResize() {
  viewportW.value = window.innerWidth
  viewportH.value = window.innerHeight
  if (!panelFits.value) {
    layoutStore.floatingChatHidden = true
  } else if (layoutStore.floatingChatHidden) {
    layoutStore.floatingChatHidden = false
  }
}

onMounted(() => window.addEventListener('resize', handleResize))
onUnmounted(() => window.removeEventListener('resize', handleResize))

/** 全屏切换时滚动到底部 */
watch(() => layoutStore.workspaceFullscreen, () => {
  // 同帧立即尝试（进入全屏时 DOM 已在 containerRef 内）
  scrollToBottom()
  // 下一帧再试一次（退出全屏时 Teleport 刚搬回 pane1，需等 DOM 更新）
  requestAnimationFrame(() => scrollToBottom())
})

function scrollToBottom() {
  const scrollEl = containerRef.value?.querySelector('.scroll-container')
    || document.querySelector('.chat-pane-content .scroll-container')
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
}

/** 展开面板时滚动到底部 */
watch(() => layoutStore.floatingChatCollapsed, (collapsed) => {
  if (collapsed) return
  scrollToBottom()
  requestAnimationFrame(() => scrollToBottom())
})
</script>

<style scoped>
.floating-chat-container {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  width: min(40vw, 430px);
  min-width: 320px;
  max-height: 70vh;
  height: 700px;
  background: var(--color-bg, #ffffff);
  border: 1px solid var(--color-surface-border, #e5e7eb);
  border-radius: var(--size-dialog-rounded-radius);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  transition: height 0.25s ease;
  padding: 0;
  --size-text-base: 14px;
}

.dark .floating-chat-container {
  background: var(--color-bg, #1a1a1a);
  border-color: var(--color-surface-border, #2e3035);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.floating-chat-header {
  flex-shrink: 0;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  cursor: move;
  background: var(--color-surface, #f9fafb);
}

.dark .floating-chat-header {
  background: var(--color-surface, #1a1a1a);
  border-color: var(--color-surface-border, #2e3035);
}

.floating-chat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-gray, #9ca3af);
  transition: background 0.15s, color 0.15s;
}

.floating-chat-btn:hover {
  background: var(--color-sidebar-bg-hover, #f3f4f6);
  color: var(--color-text, #374151);
}

.floating-chat-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 拖拽时全屏遮罩，阻止下层元素收到 hover/mousemove 事件 */
.floating-chat-drag-overlay-global {
  position: fixed;
  inset: 0;
  z-index: 99999;
  cursor: move;
}

/* 拖拽期间禁用所有过渡动画和 iframe 指针事件 */
.floating-chat-container.dragging,
.floating-chat-container.dragging * {
  transition: none !important;
}

.floating-chat-container.dragging :deep(iframe) {
  pointer-events: none !important;
}

/* ── 悬浮球 ── */
.floating-chat-ball {
  position: fixed;
  z-index: 100;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary, #409eff);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  user-select: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.floating-chat-ball:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.dark .floating-chat-ball {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* ── 极简输入模式 ── */

.floating-chat-mode :deep(.chat-messages) {
  padding: 0 12px;
}

.floating-chat-mode :deep(.input-area) {
  border: none !important;
  border-top: 1px solid var(--color-input-border, #e5e7eb) !important;
  box-shadow: none !important;
  padding: 12px 8px 12px 8px !important;
  min-height: auto !important;
  border-radius: 0 !important;
}

.floating-chat-mode :deep(.chat-input-area) {
  padding-bottom: 0 !important;
}

.floating-chat-mode :deep(.model-selector-btn) {
  display: none !important;
}

.floating-chat-mode :deep(.chat-scroll-container) {
  padding: 0 !important;
}

/* 隐藏滚动条但保留滚轮滚动 */
.floating-chat-mode :deep(.scroll-container) {
  scrollbar-width: none;
}

.floating-chat-mode :deep(.scroll-container::-webkit-scrollbar) {
  display: none;
}

.floating-chat-mode :deep(.max-w-186) {
  max-width: 100% !important;
}
</style>
