<template>
  <div class="chat-outline-container fixed right-4 top-1/2 -translate-y-1/2 z-30">
    <!-- 默认指示器 -->
    <div v-show="!isExpanded" class="outline-indicator w-1 h-12 bg-gray-300 rounded-full cursor-pointer hover:bg-gray-400 transition-colors"
      @mouseenter="isExpanded = true">
    </div>

    <!-- 展开的面板 -->
    <transition name="outline-fade">
      <div v-if="isExpanded" class="outline-panel-wrapper"
        @mouseleave="isExpanded = false">
        <div
          class="outline-panel bg-white border border-gray-200 rounded-lg shadow-lg max-h-[80vh] overflow-y-auto scrollbar-hide"
          style="width: 280px;">
          <div class="py-2">
            <div v-for="item in outlineItems" :key="item.id"
              class="outline-item px-3 py-2 cursor-pointer hover:bg-gray-50 text-gray-700 transition-colors"
              @click="handleItemClick(item.id)">
              <div class="text-sm truncate">{{ item.title }}</div>
            </div>

            <div v-if="outlineItems.length === 0" class="px-3 py-4 text-center text-gray-400 text-sm">
              暂无对话内容
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
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

watch(() => props.messages, () => {
  nextTick(() => {
    setupObserver()
  })
}, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
})

function setupObserver() {
  // 不需要设置 IntersectionObserver
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
  transition: background-color 0.2s ease;
}

.outline-item:hover {
  border-left-color: #3b82f6;
}
</style>
