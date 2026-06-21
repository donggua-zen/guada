<template>
  <div class="chat-outline-container fixed right-4 top-1/2 -translate-y-1/2 z-30">
    <!-- 默认指示器 -->
    <div v-show="!isExpanded" class="outline-indicator w-1 h-12 bg-gray-300 dark:bg-[#3a3c40] rounded-full cursor-pointer hover:bg-gray-400 dark:hover:bg-[#55575c] transition-colors"
      @mouseenter="isExpanded = true">
    </div>

    <!-- 展开的面板 -->
    <transition name="outline-fade">
      <div v-if="isExpanded" class="outline-panel-wrapper"
        @mouseleave="isExpanded = false">
        <div
          class="outline-panel bg-white dark:bg-[#232428] border border-gray-200 dark:border-[#2e3035] rounded-lg shadow-lg max-h-[80vh] overflow-y-auto scrollbar-hide"
          style="width: 280px;">
          <div class="py-2">
            <div v-for="item in outlineItems" :key="item.id"
              class="outline-item px-3 py-2 cursor-pointer text-gray-700 dark:text-[#e8e9ed] transition-colors"
              :class="{
                'hover:bg-gray-50 dark:hover:bg-[#2a2c30]': activeId !== item.id,
                'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-l-blue-500': activeId === item.id,
              }"
              @click="handleItemClick(item.id)">
              <div class="text-sm truncate">{{ item.title }}</div>
            </div>

            <div v-if="outlineItems.length === 0" class="px-3 py-4 text-center text-gray-400 dark:text-[#6b6d75] text-sm">
              暂无对话内容
            </div>
          </div>
        </div>
      </div>
    </transition>
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
  right: 1rem;
  top: 50%;
}

.outline-indicator {
  position: relative;
  transform: translateY(-50%);
}

.outline-panel-wrapper {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
}

.scrollbar-hide {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* 纯渐变动画，无平移 */
.outline-fade-enter-active,
.outline-fade-leave-active {
  transition: opacity 0.25s ease;
}

.outline-fade-enter-from,
.outline-fade-leave-to {
  opacity: 0;
}

.outline-item {
  border-left: 2px solid transparent;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
</style>
