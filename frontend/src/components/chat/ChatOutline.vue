<template>
  <div v-if="outlineItems.length >= 2" class="chat-outline-container" @mouseleave="hoveredId = null">
    <!-- 紧凑导航条：每个 user 消息一个短横线（视觉锚点），热区更宽且无缝 -->
    <div ref="panelRef" class="outline-panel" @scroll.passive="onPanelScroll">
      <div
        v-for="(item, idx) in outlineItems"
        :key="item.id"
        class="outline-item"
        :class="{
          'is-active': activeId === item.id && hoveredId === null,
          'is-hovered': hoveredId === item.id,
          'is-adjacent': hoveredId !== null && isAdjacentIdx(idx, 1),
          'is-adjacent-2': hoveredId !== null && isAdjacentIdx(idx, 2)
        }"
        @click="handleItemClick(item.id)"
        @mouseenter="hoveredId = item.id"
      >
        <span class="outline-line"></span>
      </div>
    </div>

    <!-- hover 弹窗：渲染在容器根级（面板 overflow 内滚会裁剪子元素），top 由行几何
         + 面板滚动量推算；只显示当前悬停的这一条消息，离开热区即消失（卡片不响应 hover、无动画） -->
    <div v-if="hoveredItem" class="outline-popover" :style="{ top: popoverTop }">
      <div v-if="hoveredItem.timeText" class="pop-header">
        <span class="pop-time">{{ hoveredItem.timeText }}</span>
      </div>
      <div class="pop-title">{{ hoveredItem.title }}</div>
      <div v-if="hoveredItem.preview" class="pop-preview">{{ hoveredItem.preview }}</div>
    </div>
  </div>
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
  /** ChatPanel 实例：仅消费 getScrollElement()（结构化切片，避免引入组件循环依赖） */
  chatPanelRef: { getScrollElement?: () => HTMLElement | null } | null
}>()

const emit = defineEmits<{
  scrollToMessage: [messageId: string]
}>()

const hoveredId = ref<string | null>(null)
const activeId = ref<string | null>(null)

/**
 * 刻度行几何（px），与 <style> 中 .outline-panel{padding} / .outline-item{height} 互指。
 * 行高取偶数保证 2px 横线 flex 居中偏移为整数像素；12px 在 100%/125%/150%/175%
 * 缩放下均为整数设备像素（15/18/21/24），刻度不因亚像素相位漂移而粗细不一。
 */
const OUTLINE_ROW_HEIGHT = 12
const OUTLINE_PANEL_PAD_TOP = 4

interface OutlineItem {
  id: string
  title: string
  preview: string
  timeText: string
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

/** bundle 标题：首块内容剥 <system_reminder> 后取首行（与旧 extractMessageTitle 同规则） */
function bundleTitle(bundle: MessageBundle): string {
  const content = stripSystemReminder(bundle.blocks?.[0]?.content || "")
  if (!content) return t("chat.message.unnamed");
  const firstLine = content.split("\n")[0].trim();
  return firstLine.length > 50 ? firstLine.substring(0, 47) + "..." : (firstLine || t("chat.message.unnamed"));
}

/** 内容预览：bundle 内最后一块有内容的 content（清洗后前 180 字符） */
function bundlePreview(bundle: MessageBundle): string {
  const blocks = bundle.blocks?.filter(b => b?.content) || []
  const content = blocks[blocks.length - 1]?.content || ''
  if (!content) return ''
  const clean = cleanMarkdown(content)
  return clean.length > 180 ? clean.substring(0, 177) + '...' : clean
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
      title: bundleTitle(user),
      // 有回复时展示助手最终回复；尚未回复（流式中/失败）时回退为用户消息
      preview: finalReply ? bundlePreview(finalReply) : bundlePreview(user),
      timeText: user.createdAt
        ? dayjs(user.createdAt).format('MM-DD HH:mm')
        : ''
    })
  }
  span?.end({ turns: props.turns.length })
  return items
})

/** 当前悬停项的索引（用于相邻层级判断） */
const hoveredIndex = computed(() => {
  if (!hoveredId.value) return -1
  return outlineItems.value.findIndex(i => i.id === hoveredId.value)
})

/** 是否为悬停项的相邻项（distance=1 紧邻, distance=2 隔一条） */
function isAdjacentIdx(idx: number, distance: number): boolean {
  const h = hoveredIndex.value
  return h !== -1 && Math.abs(idx - h) === distance
}

/** 当前悬停项（容器根级弹窗的数据源） */
const hoveredItem = computed(() =>
  hoveredIndex.value === -1 ? undefined : outlineItems.value[hoveredIndex.value]
)

const panelRef = ref<HTMLElement | null>(null)
/** 面板滚动量：弹窗锚定在容器根级，不随面板内滚，需扣除滚动量 */
const panelScrollTop = ref(0)

function onPanelScroll(event: Event) {
  panelScrollTop.value = (event.target as HTMLElement).scrollTop
}

/** 弹窗垂直位置 = 行中心 − 面板滚动量（配合 translateY(-50%) 以此点垂直居中） */
const popoverTop = computed(() => {
  const center =
    OUTLINE_PANEL_PAD_TOP + hoveredIndex.value * OUTLINE_ROW_HEIGHT + OUTLINE_ROW_HEIGHT / 2
  return `${center - panelScrollTop.value}px`
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
      panel.scrollTop = rowTop
    } else if (rowBottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = rowBottom - panel.clientHeight
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
  hoveredId.value = null
  emit('scrollToMessage', messageId)
}
</script>

<style scoped>
/* —— 容器：聊天区左侧垂直居中（随 GlobalSidebar 显隐自动跟随）。
      max-height 对齐 ZCode（100% - 6rem），超高后由面板内部滚动；
      flex 布局让面板在容器被 max-height 限高时收缩出滚动区 —— */
.chat-outline-container {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 6rem);
}

/* —— 窄条面板：热区加宽到 40px，横线仅为视觉锚点；超高时内部滚动、隐藏滚动条 —— */
.outline-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 40px;
  padding: 4px 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.outline-panel::-webkit-scrollbar {
  display: none;
}

/* —— 列表项：固定 12px 高、无缝连续（无 gap/margin），hover 热区无盲区。
      行高必须为偶数：2px 横线居中偏移 = (12-2)/2 = 5px 整数像素，且 12px 在
      100%/125%/150%/175% 缩放下均为整数设备像素（15/18/21/24），刻度不因亚像素
      相位漂移而粗细不一（ZCode 同思路：10px 行高 + 整数偏移 + 恒偶总高） —— */
.outline-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start; /* 横线左对齐，加宽时向右延伸 */
  flex-shrink: 0; /* 面板内滚时行高不被压缩，保证行距均匀 */
  width: 100%;
  height: 12px;
  padding-left: 4px; /* 左留白，横线不贴边 */
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
}

/* —— 短横线指示器：视觉锚点，宽度随层级变化并带动画。
      scaleX 梯度对齐 ZCode（1 / 1.25 / 1.7 / 2.6），单色阶：
      静默 = 弱化文本色，悬停/阅读位 = 前景色（暗色由 token 自适应，不写死） —— */
.outline-line {
  width: 12px;
  height: 2px;
  border-radius: 999px;
  background-color: var(--gd-color-text-disabled);
  transform-origin: left center;
  transition: transform 0.15s ease-out, opacity 0.15s ease-out, background-color 0.15s ease-out;
}

/* 阅读位置：前景色 + 微降透明度，长度不变（scaleX 1）—— hover 时 is-active 条件排除 */
.outline-item.is-active .outline-line {
  background-color: var(--gd-color-text);
  opacity: 0.9;
}

/* 层级：隔一条的项略长（scaleX 1.25 → 15px） */
.outline-item.is-adjacent-2 .outline-line {
  transform: scaleX(1.25);
}

/* 层级：紧邻项较长（scaleX 1.6667 → 20px 整宽；原 1.7 得 20.4px 小数，
   静止态刻线右端会落在小数 x 上） */
.outline-item.is-adjacent .outline-line {
  transform: scaleX(1.6667);
}

/* 层级：悬停项最长（scaleX 2.6667 → 32px 整宽，原 2.6 得 31.2px；偏离 ZCode 参考值 2.6
   约 2%，肉眼不可辨，换取静止态整像素），前景色（优先级最高，放最后） */
.outline-item.is-hovered .outline-line {
  background-color: var(--gd-color-text);
  transform: scaleX(2.6667);
}

/* —— hover 弹窗卡片：单条消息详情，向右弹出（top 由内联样式按行几何给定） —— */
.outline-popover {
  position: absolute;
  left: calc(100% + 10px);
  transform: translateY(-50%);
  width: 260px;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
  background-color: var(--el-bg-color, #fff);
  border: 1px solid var(--gd-color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 40;
  text-align: left;
  cursor: default;
  scrollbar-width: thin;
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
  color: var(--el-text-color-placeholder, #a8abb2);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.pop-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary, #303133);
  /* 整数行高：13 × 1.4 = 18.2px */
  line-height: 18px;
  margin-bottom: 4px;
  word-break: break-word;
}

.dark .pop-title {
  color: #e8e9ed;
}

.pop-preview {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary, #606266);
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dark .pop-preview {
  color: #9d9fa6;
}
</style>
