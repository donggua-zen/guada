<template>
  <div v-if="outlineItems.length > 0" class="chat-outline-container"
    @mouseenter="isExpanded = true"
    @mouseleave="isExpanded = false">
    <div class="outline-panel" :class="{ 'is-expanded': isExpanded }">
      <div v-for="item in outlineItems" :key="item.id"
        class="outline-item"
        :class="{ 'is-active': activeId === item.id }"
        @click="handleItemClick(item.id)">
        <span class="outline-title">{{ item.title }}</span>
        <span class="outline-line"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { Message } from '@/utils/messageUtils'
import { extractMessageTitle } from '@/utils/messageUtils'

const props = defineProps<{
  messages: Message[]
  chatPanelRef: any
}>()

const emit = defineEmits<{
  scrollToMessage: [messageId: string]
}>()

const isExpanded = ref(false)
const activeId = ref<string | null>(null)

const outlineItems = computed(() => {
  return props.messages
    .filter(msg => msg.role === 'user')
    .map(msg => ({
      id: msg.id,
      title: extractMessageTitle(msg),
      index: msg.index ?? 0
    }))
})

let observer: IntersectionObserver | null = null

// 消抖更新高亮，500ms 内滚动稳定后才切换
const debouncedSetActive = useDebounceFn((id: string) => {
  activeId.value = id
}, 500)

watch(() => props.messages, () => {
  nextTick(() => {
    setupObserver()
  })
}, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
})

function setupObserver() {
  observer?.disconnect()
  // 查找所有 user 消息的 DOM 元素
  const elements: Element[] = []
  for (const item of outlineItems.value) {
    const el = document.querySelector(`[data-message-id="${item.id}"]`)
    if (el) elements.push(el)
  }
  if (elements.length === 0) return

  observer = new IntersectionObserver((entries) => {
    // 找到 IntersectionRatio 最大的那个
    let best: string | null = null
    let bestRatio = 0
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
        bestRatio = entry.intersectionRatio
        best = entry.target.getAttribute('data-message-id')
      }
    }
    if (best) debouncedSetActive(best)
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] })

  elements.forEach(el => observer!.observe(el))

  // 初始默认高亮最后一条（页面刷新后自动滚动到底部）
  const last = outlineItems.value[outlineItems.value.length - 1]
  if (last) activeId.value = last.id
}

function handleItemClick(messageId: string) {
  emit('scrollToMessage', messageId)
}
</script>

<style scoped>
.chat-outline-container {
  position: fixed;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
}

.outline-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 20px;
  padding: 6px 2px;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: 80vh;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: width 0.25s ease, padding 0.25s ease, background-color 0.25s ease,
    box-shadow 0.25s ease, border-color 0.25s ease;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.outline-panel::-webkit-scrollbar {
  display: none;
}

.outline-panel.is-expanded {
  width: 280px;
  padding: 6px 10px 6px 10px;
  background-color: var(--el-bg-color, #fff);
  border-color: var(--el-border-color-light, #e4e7ed);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.dark .outline-panel.is-expanded {
  background-color: #232428;
  border-color: #2e3035;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* —— 列表项 —— */

.outline-item {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  cursor: pointer;
  border-radius: 6px;
  transition: none;
}

/* —— 标题文字（展开时淡入） —— */

.outline-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--el-text-color-placeholder, #a8abb2);
  opacity: 0;
  transition: opacity 0.1s ease, color 0.2s ease;
}

.dark .outline-title {
  color: #6b6d75;
}

.outline-panel.is-expanded .outline-title {
  opacity: 1;
  transition: opacity 0.15s ease 0.1s, color 0.2s ease;
}

.outline-panel.is-expanded .outline-item:hover .outline-title {
  color: var(--el-text-color-primary, #303133);
}

.dark .outline-panel.is-expanded .outline-item:hover .outline-title {
  color: #e8e9ed;
}

.outline-panel.is-expanded .outline-item.is-active .outline-title {
  color: var(--el-color-primary, #409eff);
  font-weight: 500;
}

.dark .outline-panel.is-expanded .outline-item.is-active .outline-title {
  color: #79bbff;
}

/* —— 短横线指示器（始终可见） —— */

.outline-line {
  flex-shrink: 0;
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background-color: var(--el-text-color-disabled, #c0c4cc);
  transition: background-color 0.2s ease, width 0.2s ease;
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

.outline-item.is-active .outline-line {
  background-color: var(--el-color-primary, #409eff);
  width: 16px;
}
</style>
