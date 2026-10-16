<!-- ScrollContainer.vue -->
<template>
    <div ref="scrollElement" class="scroll-container"
        @scroll="handleScroll"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave">
        <!-- overflow-anchor: none —— 内容子树里放着一个 sticky 底部的写作区（chat 输入区），
             它能被 Chrome 的原生滚动锚定选作锚点候选，并在高度变化后覆盖我们 layout 阶段的
             贴底/恢复值。贴底、会话恢复、加载更多的位置补偿一律由 ScrollContainer 自管
             （useScrollAnchor 状态机），原生锚定必须关掉，否则两套锚定互相打架。
             （对齐参考实现 zcode ConversationTimeline.tsx 的 overflowAnchor: 'none'。） -->
        <div ref="contentElement" style="overflow-anchor: none">
            <slot></slot>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watchEffect, onMounted, onUnmounted } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { useScrollAnchor } from "@/composables/useScrollAnchor";

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
    "scroll-state-change": [state: unknown];
    "is-at-bottom-change": [value: boolean];
    /** 跟随态变化（滚动权事件，非几何快照）：父组件据此驱动「回到底部」按钮。 */
    "following-change": [following: boolean];
    /** 到顶（几何事实）：父组件据此拉取更早一页（分页游标与在途判定在父组件）。 */
    "near-top": [];
    /** 内容尺寸变化（完成对账与贴底之后）：父组件用于会话滚动位置恢复的重试。 */
    "content-resize": [entry: ResizeObserverEntry];
}>();

// 滚动条显隐通过 DOM classList 直接操作，不走 Vue 响应式
// 避免会话切换时 mouseenter/scroll 触发 re-render 导致 VNode 不一致
const resizeObserver = ref<ResizeObserver | null>(null);
const contentElement = ref<HTMLElement | null>(null);
const scrollElement = ref<HTMLElement | null>(null);

// 底部锚定状态机：following = 用户滚动权。贴底动作（尺寸增长 / 宽度稳定后）
// 与「谁有权解除跟随」的裁决都在 composable 内，本组件只做接线。
const scrollAnchor = useScrollAnchor({
    onFollowingChange: (following: boolean) => {
        emit("following-change", following);
    },
    onNearTop: () => {
        emit("near-top");
    },
});

watchEffect(() => {
    const el = scrollElement.value;
    if (el) scrollAnchor.attach(el);
});
onUnmounted(() => {
    scrollAnchor.detach();
    resizeObserver.value?.disconnect();
    resizeObserver.value = null;
});

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
    // autoScroll 省略（未接入状态机的静态列表）时不参与跟随态判定
    if (props.autoScroll === undefined) return;
    scrollAnchor.handleScroll();
    emit("scroll", event);
}

/** 尺寸变化入口：宽度变化进稳定窗（窗内不贴底），宽度未变且跟随中则贴底。 */
function handleContentResize(entry: ResizeObserverEntry): void {
    if (props.autoScroll === undefined) return;
    scrollAnchor.handleContentResize(entry);
    emit("content-resize", entry);
}

function initScrollObservers() {
    // 清理旧的观察者
    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }
    const contentEl = contentElement.value;
    if (!contentEl) return;
    // 内容尺寸变化兜底（图片加载、流式正文、展开折叠等异步高度变化）：
    // 宽度判定与贴底动作都在状态机内（对齐参考实现的做法——宽高都从条目拿，
    // 回调里不读布局，避免每帧插入强制布局）。
    resizeObserver.value = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) handleContentResize(entry);
    });
    resizeObserver.value.observe(contentEl);
}

watchEffect(() => {
    // contentElement 就位后接入观察；返回的清理函数在重新运行/卸载时执行
    if (contentElement.value) initScrollObservers();
});

// 生命周期
onMounted(() => {
    // 监听指针离开窗口，强制清理滚动条显隐状态
    document.addEventListener('mouseout', handleWindowMouseOut);
});

onUnmounted(() => {
    document.removeEventListener('mouseout', handleWindowMouseOut);
});

// 暴露给父组件的方法
defineExpose({
    scrollToBottom,
    immediateScrollToBottom,
    smoothScrollToBottom,
    getScrollElement: () => scrollElement.value,
    scrollTop: () => scrollElement.value?.scrollTop,
    /** 当前滚动指标（会话滚动记忆的保存/恢复用）。 */
    getScrollMetrics: () => scrollAnchor.getScrollMetrics(),
    /** 跟随态读取：父组件的自动贴底开关与按钮显隐以此为准。 */
    isFollowing: () => scrollAnchor.following.value,
    /** 设置跟随态：会话恢复时按记忆初始化（贴底记忆 → true，读到中间 → false）。 */
    setFollowing: (following: boolean) => scrollAnchor.setFollowing(following),
    /** 布局写入前标记：加载更多的高度补偿、跳转校正等程序化滚动前调用，
     *  窗内 scroll 事件不被判定为用户滚动。 */
    markLayoutScroll: () => scrollAnchor.markLayoutScroll(),
    /** 程序化滚动到底部（带回读入账）。 */
    scrollToBottomProgrammatic: (behavior: 'auto' | 'smooth') => {
        if (behavior === 'smooth') scrollAnchor.scrollToBottomSmooth();
        else scrollAnchor.scrollToBottomImmediate();
    },
    /** 立即写入 scrollTop（会话恢复用），内部完成记账。 */
    applyScrollTop: (top: number) => {
        const el = scrollElement.value;
        if (!el) return;
        scrollAnchor.markLayoutScroll();
        el.scrollTop = top;
        scrollAnchor.recordScrollTop(el.scrollTop);
    },
    /** 登记用户滚动意图（点「回到底部」等组件级入口）：按钮触发的平滑滚动按用户滚动处理。 */
    markUserIntent: (intent: 'awayFromBottom' | 'towardBottom' | 'unknown') =>
        scrollAnchor.markUserIntent(intent),
});

function immediateScrollToBottom(): void {
    scrollAnchor.scrollToBottomImmediate();
}

function smoothScrollToBottom(): void {
    scrollAnchor.scrollToBottomSmooth();
}

function scrollToBottom(options: { immediate?: boolean } = {}): void {
    if (options.immediate) {
        immediateScrollToBottom();
    } else {
        smoothScrollToBottom();
    }
    emit("scroll-to-bottom");
}
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
