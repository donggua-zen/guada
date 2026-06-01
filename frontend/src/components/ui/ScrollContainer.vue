<!-- ScrollContainer.vue -->
<template>
    <div ref="scrollElement" class="scroll-container" :class="{ 'is-scrolling': isScrolling, 'is-hover': isHover }"
        @scroll="handleScroll" @mouseenter="isHover = true" @mouseleave="isHover = false">
        <div ref="contentElement">
            <slot></slot>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useDebounceFn } from "@vueuse/core";

// 常量定义
const SCROLL_THRESHOLD = 10;

// Props 类型化
const props = defineProps<{
    autoScroll?: boolean;
    scrollThreshold?: number;
    smoothScroll?: boolean;
    enableScrollButton?: boolean;
}>();

// Emits 类型化
const emit = defineEmits<{
    scroll: [event: Event];
    "scroll-to-bottom": [];
    "scroll-state-change": [state: any];
    "is-at-bottom-change": [value: boolean];
}>();

// 响应式数据 - 类型化
const isAtBottom = ref(true);
const isScrolling = ref(false);
const isHover = ref(false);
const resizeObserver = ref<ResizeObserver | null>(null);
const lastScrollHeight = ref(0);
const contentElement = ref<HTMLElement | null>(null);
const scrollElement = ref<HTMLElement | null>(null);

// 使用防抖处理滚动状态，停止滚动后延迟隐藏滚动条
const stopScrolling = useDebounceFn(() => {
    isScrolling.value = false;
}, 1500);

function checkIsAtBottom(): boolean {
    const element = scrollElement.value;
    if (!element) return true;

    const distanceToBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceToBottom <= (props.scrollThreshold ?? SCROLL_THRESHOLD);
}

function handleScroll(event: Event): void {
    isAtBottom.value = checkIsAtBottom();

    // 滚动时显示滚动条
    isScrolling.value = true;
    stopScrolling();

    emit("scroll", event);
}

function immediateScrollToBottom(): void {
    const element = scrollElement.value;
    if (element) {
        element.scrollTop = element.scrollHeight * 2;
    }
}

function smoothScrollToBottom(): void {
    const element = scrollElement.value;
    if (element) {
        const currentScrollHeight = element.scrollHeight;
        if (currentScrollHeight !== lastScrollHeight.value) {
            element.scrollTo({
                top: currentScrollHeight,
                behavior: "smooth",
            });
            lastScrollHeight.value = currentScrollHeight;
        }
    }
}

function scrollToBottom(options: { immediate?: boolean } = {}): void {
    if (options.immediate) {
        immediateScrollToBottom();
    } else {
        smoothScrollToBottom();
    }
    emit("scroll-to-bottom");
}

function initScrollObservers() {
    // 清理旧的观察者
    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }

    const contentEl = contentElement.value;

    // 使用 ResizeObserver 作为兜底（处理图片加载等异步尺寸变化）
    resizeObserver.value = new ResizeObserver(() => {
        if (props.autoScroll) {
            //   requestAnimationFrame(() => {
            immediateScrollToBottom();
            //   });
        }
    });

    if (contentEl) {
        resizeObserver.value.observe(contentEl);
    }
}

// 生命周期
onMounted(() => {
    initScrollObservers();
});

onUnmounted(() => {
    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }
});

// 暴露给父组件的方法
defineExpose({
    scrollToBottom,
    immediateScrollToBottom,
    smoothScrollToBottom,
    getScrollElement: () => scrollElement.value,
    scrollTop: () => scrollElement.value?.scrollTop,
    isAtBottom: computed(() => isAtBottom.value),
});
</script>

<style scoped>
.scroll-container {
    overflow: auto;
    scroll-behavior: auto;
    scrollbar-gutter: stable both-edges;
}

/* 滚动条基础样式 */
.scroll-container::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

.scroll-container::-webkit-scrollbar-track {
    background: transparent;
    margin: 2px 0;
}

/* 默认状态：滚动条透明（隐藏） */
.scroll-container::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 8px;
    background-clip: content-box;
    transition: background-color 0.2s linear;
    transition-delay: 0.6s;
}

/* 滚动中或悬停时：显示滚动条 */
.scroll-container.is-scrolling::-webkit-scrollbar-thumb,
.scroll-container.is-hover::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.10);
    transition-delay: 0s;
}

/* 滚动中或悬停时的 hover 状态 */
.scroll-container.is-scrolling::-webkit-scrollbar-thumb:hover,
.scroll-container.is-hover::-webkit-scrollbar-thumb:hover {
    background-color: rgba(0, 0, 0, 0.25);
    cursor: pointer;
}

/* 暗色模式下的滚动条样式 */
html.dark .scroll-container.is-scrolling::-webkit-scrollbar-thumb,
html.dark .scroll-container.is-hover::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.15);
}

html.dark .scroll-container.is-scrolling::-webkit-scrollbar-thumb:hover,
html.dark .scroll-container.is-hover::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.25);
}
</style>