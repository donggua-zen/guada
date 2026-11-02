<template>
  <nav
    v-if="outlineItems.length >= 2"
    class="chat-outline-container"
    :aria-label="t('chat.outline.label')"
    @mouseleave="setInteraction(-1)"
  >
    <!-- 紧凑导航条：每条用户提问一个短横线（视觉锚点），热区更宽且无缝 -->
    <div ref="panelRef" class="outline-panel" @scroll.passive="onPanelScroll">
      <button
        v-for="(item, idx) in outlineItems"
        :key="item.id"
        type="button"
        class="outline-item"
        :aria-current="idx === activeIndex ? 'location' : undefined"
        :aria-posinset="idx + 1"
        :aria-setsize="outlineItems.length"
        :aria-label="t('chat.outline.jumpTo', { index: idx + 1 })"
        @click="handleItemClick(item.id)"
        @pointerenter="setInteraction(idx)"
        @focus="setInteraction(idx)"
        @blur="setInteraction(-1)"
      >
        <span class="outline-line" :style="lineStyle(idx)"></span>
      </button>
    </div>

    <!-- hover 弹窗：渲染在容器根级（面板 overflow 内滚会裁剪子元素），top 由行几何
         + 面板滚动量推算；卡片不响应 hover，冷启动 120ms 才弹、离开 80ms 才收 -->
    <div v-if="popoverItem" class="outline-popover" :style="{ top: popoverTop }">
      <div v-if="popoverItem.timeText" class="pop-header">
        <span class="pop-time">{{ popoverItem.timeText }}</span>
      </div>
      <p class="pop-user">{{ popoverItem.userPreview }}</p>
      <p
        class="pop-assistant"
        :class="{ 'is-quoted': popoverItem.assistantKind !== 'text' }"
      >{{ popoverItem.assistantPreview }}</p>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import type { MessageBundle, Turn } from '@/types/message'
import { stripSystemReminder, isHiddenBlock } from '@/utils/messageUtils'
import { perfStart } from '@/utils/perf'

const { t } = useI18n()

// 数据源 = 回合列表（回合制重构后扁平 messages 数组已无人写入，恒为空，
// 曾导致本组件 outlineItems 恒为空而永不渲染）
const props = defineProps<{
  turns: Turn[]
  /** ChatPanel 实例切片：只消费 getScrollElement / isStreaming，避免引入组件循环依赖 */
  chatPanelRef: { getScrollElement?: () => HTMLElement | null; isStreaming?: boolean } | null
}>()

const emit = defineEmits<{
  scrollToMessage: [messageId: string]
}>()

/** 山峰焦点所在条目（pointerenter 或键盘 focus 都会写入；驱动横线的长度与透明度） */
const interactionIndex = ref(-1)
/** 卡片所在条目：冷启动 120ms 才显示、离开 80ms 才收起（对齐 ZCode HoverCard 的 open/closeDelay） */
const popoverIndex = ref(-1)
const activeId = ref<string | null>(null)

const POPOVER_OPEN_DELAY = 120
const POPOVER_CLOSE_DELAY = 80
let openTimer: number | null = null
let closeTimer: number | null = null

/**
 * 交互态变化：横线立即响应（无延迟），只有卡片有进出延迟。
 * 卡片已在显示时横向扫过相邻条目直接跟随——每次重开会让整张卡闪断一次。
 */
function setInteraction(idx: number) {
  interactionIndex.value = idx
  if (openTimer !== null) {
    window.clearTimeout(openTimer)
    openTimer = null
  }
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
  if (idx >= 0) {
    if (popoverIndex.value >= 0) popoverIndex.value = idx
    else {
      openTimer = window.setTimeout(() => {
        popoverIndex.value = idx
        openTimer = null
      }, POPOVER_OPEN_DELAY)
    }
    return
  }
  if (popoverIndex.value < 0) return
  closeTimer = window.setTimeout(() => {
    popoverIndex.value = -1
    closeTimer = null
  }, POPOVER_CLOSE_DELAY)
}

function clearInteractionTimers() {
  if (openTimer !== null) {
    window.clearTimeout(openTimer)
    openTimer = null
  }
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

/**
 * 刻度行几何（px），与 <style> 中 .outline-panel{padding} / .outline-item{height} 互指。
 * 行高取偶数保证 2px 横线 flex 居中偏移为整数像素；12px 在 100%/125%/150%/175%
 * 缩放下均为整数设备像素（15/18/21/24），刻度不因亚像素相位漂移而粗细不一。
 */
const OUTLINE_ROW_HEIGHT = 12
const OUTLINE_PANEL_PAD_TOP = 4

interface OutlineItem {
  id: string
  timeText: string
  userPreview: string
  assistantPreview: string
  assistantKind: 'text' | 'running' | 'empty'
}

/** 清洗 Markdown 标记，提取纯文本预览 */
function cleanMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [代码块] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * 摘要文本：剥 system_reminder、清洗 Markdown，最多 220 字（对齐 ZCode
 * DEFAULT_MAX_PREVIEW_CHARS），再由卡片的 2/3 行裁剪收尾。
 */
function previewOf(bundle: MessageBundle): string {
  const blocks = bundle.blocks?.filter(b => b?.content) || []
  const content = blocks[blocks.length - 1]?.content || ''
  if (!content) return ''
  const clean = cleanMarkdown(stripSystemReminder(content))
  return clean.length > 220 ? clean.substring(0, 217) + '...' : clean
}

const outlineItems = computed<OutlineItem[]>(() => {
  const span = perfStart('outline.recompute')
  const items: OutlineItem[] = []
  for (const turn of props.turns) {
    // 用户锚点：回合内第一条真实用户输入（id 与 TurnItem 的 data-message-id 同源）
    const user = turn.messages?.find(m => m.role === 'user' && !isHiddenBlock(m))
    if (!user) continue
    // 最终回复：同回合倒序第一条有内容的 assistant bundle（ReAct 多次 LLM 调用取最后一次；
    // regenerate = 删旧回合+新建，每条用户输入至多一个可见回合，无重复条目）
    let finalReply: MessageBundle | undefined
    const msgs = turn.messages || []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'assistant' && m.blocks?.some(b => b?.content)) {
        finalReply = m
        break
      }
    }
    items.push({
      id: user.messageId,
      userPreview: previewOf(user) || t('chat.message.unnamed'),
      assistantPreview: finalReply ? previewOf(finalReply) : '',
      assistantKind: finalReply ? 'text' : 'empty',
      timeText: user.createdAt
        ? dayjs(user.createdAt).format('MM-DD HH:mm')
        : ''
    })
  }
  // 尾条且仍在流式：摘要位显示「正在生成」，与 ZCode 只强调当前工作 query 的做法一致
  if (props.chatPanelRef?.isStreaming === true) {
    const tail = items[items.length - 1]
    if (tail && tail.assistantKind === 'empty') {
      tail.assistantKind = 'running'
      tail.assistantPreview = t('chat.outline.runningAssistant')
    }
  }
  span?.end({ turns: props.turns.length })
  return items
})

/** 阅读位所在条目（无交互时决定哪条更亮） */
const activeIndex = computed(() => outlineItems.value.findIndex(i => i.id === activeId.value))

/** 当前显示卡片的条目 */
const popoverItem = computed(() =>
  popoverIndex.value >= 0 ? outlineItems.value[popoverIndex.value] : undefined
)

/**
 * 山峰梯度：按到焦点条目的距离给「长度 + 透明度」双衰减（ZCode 的 idle/mid/near/peak 四档）。
 * 静默态不是换成弱化色，而是前景色压到 0.58 —— 同一色阶才能读出质地的深浅层次。
 */
const IDLE_OPACITY = 0.58
const RUNNING_MIN_OPACITY = 0.72
const BAR_LADDER = [
  { opacity: 1, scaleX: 2.6667 },
  { opacity: 0.86, scaleX: 1.6667 },
  { opacity: 0.72, scaleX: 1.25 },
  { opacity: IDLE_OPACITY, scaleX: 1 },
] as const

function lineStyle(idx: number) {
  const focus = interactionIndex.value
  let opacity: number
  let scaleX = 1
  if (focus >= 0) {
    const step = BAR_LADDER[Math.min(3, Math.abs(idx - focus))]
    opacity = step.opacity
    scaleX = step.scaleX
  } else {
    opacity = idx === activeIndex.value ? 0.9 : IDLE_OPACITY
  }
  if (idx === outlineItems.value.length - 1 && props.chatPanelRef?.isStreaming === true) {
    opacity = Math.max(opacity, RUNNING_MIN_OPACITY)
  }
  return { opacity: `${opacity}`, transform: `scaleX(${scaleX})` }
}

const panelRef = ref<HTMLElement | null>(null)
/** 面板滚动量：弹窗锚定在容器根级，不随面板内滚，需扣除滚动量 */
const panelScrollTop = ref(0)
/**
 * 本组件自己写入的 scrollTop（把阅读位滚进可视窗触发）。rail 滚动清除交互态只该认用户的滚动，
 * 否则流式期间阅读位一变、卡片就在用户指针下闪断——这一点刻意偏离 ZCode。
 */
let programmaticPanelTop = -1

function onPanelScroll(event: Event) {
  const el = event.target as HTMLElement
  panelScrollTop.value = el.scrollTop
  if (el.scrollTop === programmaticPanelTop) {
    programmaticPanelTop = -1
    return
  }
  // rail 自身被用户滚动时收起交互态：刻度在移位，山峰与卡片都会跟错行
  if (interactionIndex.value >= 0) setInteraction(-1)
}

/**
 * 弹窗垂直位置 = 悬停行的中心相对外壳顶部的距离（配合 translateY(-50%) 以此点居中）。
 *
 * 量真实矩形而不是用「padding + idx × 行高」推算：rail 在外壳里是垂直居中的，
 * 推算式一旦漏掉居中偏移（外壳满高、rail 居中）卡片就会掉到几百像素外。
 * panelScrollTop 只作为依赖登记，让 rail 内部滚动时跟着重算。
 */
const popoverTop = computed(() => {
  const idx = popoverIndex.value
  const panel = panelRef.value
  const shell = panel?.parentElement
  if (idx < 0 || !panel || !shell) return '0px'
  void panelScrollTop.value
  const row = panel.children[idx] as HTMLElement | undefined
  if (!row) return '0px'
  const rowRect = row.getBoundingClientRect()
  return `${rowRect.top + rowRect.height / 2 - shell.getBoundingClientRect().top}px`
})

// 激活刻度变化时滚入面板可视窗（nearest 语义；手动改 scrollTop，
// 不用 scrollIntoView —— 它会连带滚动聊天容器）
watch(activeId, () => {
  nextTick(() => {
    const panel = panelRef.value
    const idx = outlineItems.value.findIndex(i => i.id === activeId.value)
    if (!panel || idx === -1) return
    const rowTop = OUTLINE_PANEL_PAD_TOP + idx * OUTLINE_ROW_HEIGHT
    const rowBottom = rowTop + OUTLINE_ROW_HEIGHT
    if (rowTop < panel.scrollTop) {
      programmaticPanelTop = rowTop
      panel.scrollTop = rowTop
    } else if (rowBottom > panel.scrollTop + panel.clientHeight) {
      programmaticPanelTop = rowBottom - panel.clientHeight
      panel.scrollTop = programmaticPanelTop
    }
  })
})

let scrollEl: Element | null = null
let msgEls: { id: string; el: Element }[] = []
let setupTimer: number | null = null
let pollTimer: number | null = null

// 防抖计算当前可视区第一条（100ms，滚动跟手且不频繁重排）
const debouncedUpdateActive = useDebounceFn(updateActiveFromScroll, 100)

// 回合列表变化时重建元素索引；immediate 确保异步组件挂载后即使回合已就绪也能初始化。
// 不用 deep：props.turns 是全会话的深层响应式数组，深度遍历每个流式 token 都会跑
// 一遍所有回合的所有属性；而本函数要重建的只是 [data-message-id] 元素映射，它只在
// 数组换了来源（切会话）或条数变了（新增/删除回合）时才需要更新。
watch(
  [() => props.turns, () => props.turns.length],
  () => {
    scheduleSetup()
  },
  { immediate: true }
)

// 保险：组件挂载且 DOM 渲染完成后初始化
onMounted(() => {
  scheduleSetup()
})

onBeforeUnmount(() => {
  cleanup()
  clearInteractionTimers()
})

// 双保险调度：nextTick + setTimeout，确保消息 DOM 已渲染
function scheduleSetup() {
  nextTick(() => {
    if (setupTimer !== null) window.clearTimeout(setupTimer)
    setupTimer = window.setTimeout(() => {
      setupObserver()
      setupTimer = null
    }, 0)
  })
}

function cleanup() {
  if (scrollEl) {
    scrollEl.removeEventListener('scroll', onScroll)
    scrollEl = null
  }
  msgEls = []
  if (setupTimer !== null) {
    window.clearTimeout(setupTimer)
    setupTimer = null
  }
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function setupObserver() {
  cleanup()

  const items = outlineItems.value
  if (items.length === 0) return

  // 优先使用聊天滚动容器作为观察区域
  const scroll = props.chatPanelRef?.getScrollElement?.() || null
  const rootEl = scroll || document
  scrollEl = scroll

  // 批量查找所有带 data-message-id 的元素并用 Map 映射（绕开逐个 querySelector 的转义/查找问题）
  const allEls = Array.from(rootEl.querySelectorAll('[data-message-id]')) as Element[]
  const idToEl = new Map<string, Element>()
  for (const el of allEls) {
    const id = el.getAttribute('data-message-id')
    if (id) idToEl.set(id, el)
  }
  msgEls = items
    .map(item => ({ id: item.id, el: idToEl.get(item.id) }))
    .filter((x): x is { id: string; el: Element } => !!x.el)

  // DOM 未就绪：兜底高亮最后一条，轮询等待重建
  if (msgEls.length === 0) {
    if (!activeId.value) activeId.value = items[items.length - 1].id
    startPolling()
    return
  }

  // 立即计算一次当前可视区第一条
  updateActiveFromScroll()

  // 监听滚动实时更新高亮
  if (scrollEl) {
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
  }
  // 轮询兜底：即使 scroll 事件缺失，高亮也会持续自愈修正
  startPolling()
}

/** 轮询兜底：500ms 一次，DOM 未就绪时重建，就绪后持续修正高亮 */
function startPolling() {
  if (pollTimer !== null) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => {
    if (msgEls.length === 0) {
      scheduleSetup()
    } else {
      updateActiveFromScroll()
    }
  }, 500)
}

function onScroll() {
  debouncedUpdateActive()
}

/**
 * 计算当前可视区内第一条用户消息
 * 规则：与可视区相交的消息中，时间顺序最早的那条
 * （即"尚未完全滚出顶部的第一条"），短消息部分可见也会被选中
 * scrollEl 不可用时退化为视口计算
 */
function updateActiveFromScroll() {
  if (msgEls.length === 0) return

  const refEl: Element = scrollEl || document.documentElement
  const containerRect = refEl.getBoundingClientRect()
  const top = containerRect.top
  const bottom = containerRect.bottom

  for (const { id, el } of msgEls) {
    const rect = el.getBoundingClientRect()
    // 与可视区有交集：底部未完全滚出顶部，且顶部未完全低于容器底部
    if (rect.bottom >= top && rect.top <= bottom) {
      activeId.value = id
      return
    }
  }
  // 全部在可视区外（极端情况）：保持当前 active 不变
}

function handleItemClick(messageId: string) {
  setInteraction(-1)
  emit('scrollToMessage', messageId)
}
</script>

<style scoped>
/* —— 外壳：聊天列左缘 48px 预留带（对齐 ZCode 的 w-12 外壳）。外壳不吃指针事件，
      只有内部 rail 可交互；窄容器下整块淡出，避免刻度压在正文上 —— */
.chat-outline-container {
  position: absolute;
  inset: 0 auto 0 0;
  width: 48px;
  z-index: 30;
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 0.15s ease-out, transform 0.15s ease-out, visibility 0.15s ease-out;
}

/* 显示门槛与 ZCode 同口径：容器宽 ≥ 864px（composer 左侧要容下 48px rail + 16px 安全距） */
@container conversation (min-width: 864px) {
  .chat-outline-container {
    visibility: visible;
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {

  .chat-outline-container,
  .outline-line {
    transition: none;
  }
}

/* —— rail：热区 36px、距左 12px、垂直居中、超高内滚且隐藏滚动条。
   overflow-x 必须显式 hidden：只写 overflow-y:auto 时浏览器会把 overflow-x 也算成 auto，
   山峰横向拉长会撑出横向滚动条 —— */
.outline-panel {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 36px;
  max-height: calc(100% - 6rem);
  padding: 4px 0;
  pointer-events: auto;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.outline-panel::-webkit-scrollbar {
  display: none;
}

/* —— 条目：固定 12px 高、无缝连续（无 gap/margin），热区无盲区。
   行高没有照抄 ZCode 的 10px：12px 在 100%/125%/150%/175% 缩放下是 15/18/21/24 整数
   设备像素，10px 会得到 12.5/15/17.5/21 —— 半像素行距让相邻刻度粗细不一 —— */
.outline-item {
  display: flex;
  align-items: center;
  justify-content: flex-start; /* 横线左对齐，加宽时向右延伸 */
  flex-shrink: 0; /* 面板内滚时行高不被压缩，保证行距均匀 */
  width: 100%;
  height: 12px;
  padding: 0 0 0 4px; /* 左留白，横线不贴边 */
  border: 0;
  background: transparent;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
}

/* 键盘焦点环：用 text 派生的半透明描边，不借主题色 */
.outline-item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--gd-color-text) 35%, transparent);
  outline-offset: 2px;
}

/* —— 短横线：长度与透明度由 :style 按到焦点项的距离给出（山峰梯度）。
      颜色统一前景色，静默态靠 opacity 0.58 压暗而不是换弱化色——同一色阶才读得出深浅。
      transition 属性集对齐 ZCode（含 height，为以后按层级变粗留位）—— */
.outline-line {
  width: 12px;
  height: 2px;
  border-radius: 999px;
  background-color: var(--gd-color-text);
  transform-origin: left center;
  transition: transform 0.15s ease-out, opacity 0.15s ease-out, background-color 0.15s ease-out, height 0.15s ease-out;
}

/* —— hover 卡片：宽 320、内边距 12、距 rail 右 8px（= 12 + 36 + 8，与 ZCode 的 sideOffset 8 同位）。
      两段摘要：用户问题 2 行中等字重 + 助手摘要 3 行 —— */
.outline-popover {
  position: absolute;
  left: calc(100% + 8px);
  transform: translateY(-50%);
  width: 320px;
  max-width: calc(100vw - 2rem);
  padding: 12px;
  background-color: var(--gd-color-bg);
  border: 1px solid var(--gd-color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 40;
  text-align: left;
  cursor: default;
}

.dark .outline-popover {
  background-color: #232428;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.pop-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 4px;
}

.pop-time {
  font-size: 11px;
  /* 整数行高：11px 继承 1.5 会得到 16.5px 半像素行盒 */
  line-height: 16px;
  color: var(--gd-color-text-disabled);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.pop-user {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  font-size: 13px;
  /* 整数行高：13×1.5=19.5 会落半像素，取 20；两行即 40px */
  line-height: 20px;
  font-weight: 500;
  color: var(--gd-color-text);
  white-space: pre-line;
  word-break: break-word;
}

.pop-assistant {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--gd-color-text-gray);
  white-space: pre-line;
  word-break: break-word;
}

/* 非正文摘要（无文字回复 / 正在生成）再弱一档，避免被读成真实回复 */
.pop-assistant.is-quoted {
  color: var(--gd-color-text-disabled);
}
</style>
