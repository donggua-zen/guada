<!-- ScrollContainer.vue -->
<template>
    <div ref="scrollElement" class="scroll-container"
        @scroll="handleScroll"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave">
        <div ref="contentElement">
            <slot></slot>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
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
const resizeObserver = ref<ResizeObserver | null>(null);
const lastScrollHeight = ref(0);
const contentElement = ref<HTMLElement | null>(null);
const scrollElement = ref<HTMLElement | null>(null);

// 滚动条显隐通过 DOM classList 直接操作，不走 Vue 响应式
// 避免会话切换时 mouseenter/scroll 触发 re-render 导致 VNode 不一致
const stopScrolling = useDebounceFn(() => {
    scrollElement.value?.classList.remove('is-scrolling');
}, 1500);

// 鼠标进入容器：显示滚动条
function handleMouseEnter(): void {
    scrollElement.value?.classList.add('is-hovering');
}

// 鼠标离开容器：立即隐藏滚动条，不等待防抖，避免滚动条残留
function handleMouseLeave(): void {
    scrollElement.value?.classList.remove('is-scrolling');
    scrollElement.value?.classList.remove('is-hovering');
}

// 指针离开浏览器窗口时强制清理状态。
// Chromium 中指针从滚动条区域离开窗口时 :hover 伪类可能残留，
// 因此显隐完全由 class 控制，窗口离开时统一移除。
function handleWindowMouseOut(event: MouseEvent): void {
    if (!event.relatedTarget) {
        const el = scrollElement.value;
        el?.classList.remove('is-scrolling');
        el?.classList.remove('is-hovering');
    }
}



function handleScroll(event: Event): void {
    // 滚动时显示滚动条（DOM 直接操作，不触发 Vue re-render）
    scrollElement.value?.classList.add('is-scrolling');
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
            immediateScrollToBottom();
        }
    });

    if (contentEl) {
        resizeObserver.value.observe(contentEl);
    }
}

// 生命周期
onMounted(() => {
    initScrollObservers();
    // 监听指针离开窗口，强制清理滚动条显隐状态
    document.addEventListener('mouseout', handleWindowMouseOut);
});

onUnmounted(() => {
    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }
    document.removeEventListener('mouseout', handleWindowMouseOut);
});

// 暴露给父组件的方法
defineExpose({
    scrollToBottom,
    immediateScrollToBottom,
    smoothScrollToBottom,
    getScrollElement: () => scrollElement.value,
    scrollTop: () => scrollElement.value?.scrollTop,
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
    width: 10px;
    height: 10px;
}

.scroll-container::-webkit-scrollbar-track {
    background: transparent;
    margin: 2px 0;
}

/* 默认状态：滚动条透明（隐藏），隐藏无延迟，保证 hover 结束立即隐藏 */
.scroll-container::-webkit-scrollbar-thumb {
    min-height: 80px;
    background-color: transparent;
    border-radius: 8px;
    background-clip: content-box;
    transition: background-color 0.2s linear;
    transition-delay: 0s;
    border: 1px solid transparent;
}

/* 滚动中或悬停时：显示滚动条（显隐完全由 class 控制，避免 :hover 残留） */
.scroll-container.is-scrolling::-webkit-scrollbar-thumb,
.scroll-container.is-hovering::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.10);
    transition-delay: 0s;
}

/* 滚动中或悬停时的 hover 状态 */
.scroll-container.is-scrolling::-webkit-scrollbar-thumb:hover,
.scroll-container.is-hovering::-webkit-scrollbar-thumb:hover {
    background-color: rgba(0, 0, 0, 0.25);
    cursor: pointer;
}

/* 暗色模式下的滚动条样式 */
html.dark .scroll-container.is-scrolling::-webkit-scrollbar-thumb,
html.dark .scroll-container.is-hovering::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.15);
}

html.dark .scroll-container.is-scrolling::-webkit-scrollbar-thumb:hover,
html.dark .scroll-container.is-hovering::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.25);
}
</style>