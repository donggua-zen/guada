<!-- ScrollToBottomButton.vue -->
<template>
    <Transition name="fade">
        <button 
            v-if="show"
            ref="buttonRef"
            class="scroll-to-bottom-btn"
            :class="{ streaming: isStreaming }"
            @click="handleClick"
            type="button"
        >
            <div class="scroll-to-bottom-btn-content">
                <!-- 向下箭头图标 -->
                <svg class="scroll-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path 
                        d="M12 5V19M12 19L5 12M12 19L19 12" 
                        stroke="currentColor" 
                        stroke-width="2" 
                        stroke-linecap="round" 
                        stroke-linejoin="round"
                    />
                </svg>
            </div>
        </button>
    </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useDebounceFn } from '@vueuse/core'

// Props 类型化
const props = defineProps<{
    show?: boolean;
    isStreaming?: boolean;
    onClick?: (event: MouseEvent) => void;
}>()

// Emits 类型化
const emit = defineEmits<{
    click: [event: MouseEvent]
}>()

// 响应式数据 - 类型化
const buttonRef = ref<HTMLButtonElement | null>(null)

// 调试：监听 props 变化
watch(() => props.isStreaming, (newVal) => {
  console.log('[ScrollButton Component] isStreaming prop changed:', newVal)
  // 检查类名
  if (buttonRef.value) {
    const hasStreamingClass = buttonRef.value.classList.contains('streaming')
    console.log('[ScrollButton Component] Button has streaming class:', hasStreamingClass)
  }
}, { immediate: true })

watch(() => props.show, (newVal) => {
  console.log('[ScrollButton Component] show prop changed:', newVal)
}, { immediate: true })

// 方法 - 类型化
function handleClick(event: MouseEvent): void {
  console.log('[ScrollButton Component] handleClick called')
  emit('click', event)
  if (props.onClick) {
    props.onClick(event)
  }
}

// 暴露方法给父组件
defineExpose({
    buttonRef
})
</script>

<style scoped>
/* 按钮基础样式 */
.scroll-to-bottom-btn {
    position: absolute;
    bottom: 150px; /* 输入框上方，留出足够空间 */
    left: 50%;
    transform: translateX(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background-color: var(--color-primary, #3b82f6);
    border: none;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    z-index: 100;
    padding: 0;
    outline: none;
}

/* 悬停效果 */
.scroll-to-bottom-btn:hover {
    background-color: var(--color-primary-hover, #2563eb);
    box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
    transform: translateX(-50%) translateY(-2px);
}

/* 点击效果 */
.scroll-to-bottom-btn:active {
    transform: translateX(-50%) translateY(0);
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

/* 按钮内容 */
.scroll-to-bottom-btn-content {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
}

/* 滚动图标 */
.scroll-icon {
    width: 22px;
    height: 22px;
    color: white;
}

/* 呼吸动画 - 流式输出时启用 */
/* 注意：.streaming 类直接绑定在按钮元素上 */
.scroll-to-bottom-btn.streaming {
    animation: breathing 2s ease-in-out infinite;
}

@keyframes breathing {
    0%, 100% {
        opacity: 0.6;
        /* 保持居中的同时缩放 */
        transform: translateX(-50%) scale(0.95);
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
    }
    50% {
        opacity: 1;
        /* 保持居中的同时缩放 */
        transform: translateX(-50%) scale(1.05);
        box-shadow: 0 6px 16px rgba(59, 130, 246, 0.5);
    }
}

/* 淡入淡出动画 - 使用 !important 确保优先于呼吸动画 */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0 !important;  /* ← 强制覆盖呼吸动画的 opacity */
    transform: scale(0.8) translateY(10px) !important;  /* ← 强制覆盖呼吸动画的 transform */
}

/* 图标跳动动画 */
@keyframes bounce-down {
    0%, 100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(3px);
    }
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
    .scroll-to-bottom-btn {
        background-color: var(--color-primary, #60a5fa);
        box-shadow: 0 4px 12px rgba(96, 165, 250, 0.3);
    }
    
    .scroll-to-bottom-btn:hover {
        background-color: var(--color-primary-hover, #3b82f6);
        box-shadow: 0 6px 16px rgba(96, 165, 250, 0.4);
    }
}

/* 移动端适配 */
@media (max-width: 768px) {
    .scroll-to-bottom-btn {
        bottom: 80px;
        width: 40px;
        height: 40px;
    }
    
    .scroll-icon {
        width: 20px;
        height: 20px;
    }
}
</style>
