<template>
  <div v-if="outlineItems.length > 0" class="chat-outline-container" @mouseleave="hoveredId = null">
    <!-- 紧凑导航条：每个 user 消息一个短横线（视觉锚点），热区更宽且无缝 -->
    <div class="outline-panel">
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

        <!-- hover 弹窗：只显示当前悬停的这一条消息，离开热区即消失（卡片本身不响应 hover、无动画） -->
        <div v-if="hoveredId === item.id" class="outline-popover">
          <div class="pop-header">
            <span class="pop-index">#{{ idx + 1 }}</span>
            <span v-if="item.timeText" class="pop-time">{{ item.timeText }}</span>
          </div>
          <div class="pop-title">{{ item.title }}</div>
          <div v-if="item.preview" class="pop-preview">{{ item.preview }}</div>
        </div>
      </div>
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

const { t } = useI18n()

// 数据源 = 回合列表（回合制重构后扁平 messages 数组已无人写入，恒为空，
// 曾导致本组件 outlineItems 恒为空而永不渲染）
const props = defineProps<{
  turns: Turn[]
  chatPanelRef: any
}>()

const emit = defineEmits<{
  scrollToMessage: [messageId: string]
}>()

const hoveredId = ref<string | null>(null)
const activeId = ref<string | null>(null)

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
/* —— 容器：聊天区左侧垂直居中（随 GlobalSidebar 显隐自动跟随） —— */
.chat-outline-container {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
}

/* —— 窄条面板：热区加宽到 40px，横线仅为视觉锚点 —— */
.outline-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 40px;
  padding: 4px 0;
}

/* —— 列表项：固定 13px 高、无缝连续（无 gap/margin），hover 热区无盲区 —— */
.outline-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start; /* 横线左对齐，加宽时向右延伸 */
  width: 100%;
  height: 13px;
  padding-left: 4px; /* 左留白，横线不贴边 */
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
}

/* —— 短横线指示器：视觉锚点，宽度随层级变化并带动画（0.18s，约 0.35s 的一倍速） —— */
.outline-line {
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background-color: var(--el-text-color-disabled, #c0c4cc);
  transition: width 0.18s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.15s ease;
}

.dark .outline-line {
  background-color: #3a3c40;
}

.outline-item:hover .outline-line {
  background-color: var(--el-text-color-secondary, #909399);
}

.dark .outline-item:hover .outline-line {
  background-color: #55575c;
}

/* 阅读位置：仅高亮（蓝色），长度不变（12px）—— hover 时 is-active 条件排除 */
.outline-item.is-active .outline-line {
  background-color: var(--el-color-primary, #409eff);
}

/* 层级：隔一条的项略长（16px） */
.outline-item.is-adjacent-2 .outline-line {
  width: 16px;
}

/* 层级：紧邻项较长（24px） */
.outline-item.is-adjacent .outline-line {
  width: 24px;
}

/* 层级：悬停项最长（34px），高亮为主题色（优先级最高，放最后） */
.outline-item.is-hovered .outline-line {
  background-color: var(--el-color-primary, #409eff);
  width: 34px;
}

/* —— hover 弹窗卡片：单条消息详情，向右弹出 —— */
.outline-popover {
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
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
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.pop-index {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-color-primary, #409eff);
}

.pop-time {
  font-size: 11px;
  color: var(--el-text-color-placeholder, #a8abb2);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.pop-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary, #303133);
  line-height: 1.4;
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
