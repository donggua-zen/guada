<!-- ScrollContainer.vue -->
<template>
    <SimpleBar ref="simpleBarRef" @scroll="handleScroll">
        <div ref="contentElement">
            <slot></slot>
        </div>
    </SimpleBar>
</template>

<script setup lang="ts">
// @ts-nocheck - simplebar-vue 类型缺失
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useDebounceFn } from '@vueuse/core'
// @ts-ignore - simplebar-vue 类型缺失
import SimpleBar from 'simplebar-vue'
import 'simplebar-vue/dist/simplebar.min.css'

// 常量定义
const SCROLL_THRESHOLD = 10;
// import { useAttrs } from 'vue'

// defineOptions({
//     inheritAttrs: false // 禁用自动继承
// })
// const attrs = useAttrs()


// Props 类型化
const props = defineProps<{
    autoScroll?: boolean;
    scrollThreshold?: number;
    smoothScroll?: boolean;
    enableScrollButton?: boolean;
}>();


// const mergredClasses = computed((): string => {
//     let mergredClass: string | string[] = [];
//     const classes: (string | undefined)[] = [attrs.class as string];
//     if (mergredClass) {
//         if (Array.isArray(mergredClass)) {
//             classes.push(...mergredClass);
//         } else {
//             classes.push(mergredClass);
//         }
//     }
//     return classes.filter(Boolean).join(' ');
// })

// Emits 类型化
const emit = defineEmits<{
    scroll: [event: Event]
    'scroll-to-bottom': []
    'scroll-state-change': [state: any]
    'is-at-bottom-change': [value: boolean]
}>();

// 响应式数据 - 类型化
const simpleBarRef = ref<any>(null);
const isAtBottom = ref(true);
const mutationObserver = ref<MutationObserver | null>(null);
const resizeObserver = ref<ResizeObserver | null>(null);
const lastScrollHeight = ref(0);
const lastScrollTop = ref(0);

const contentElement = ref<HTMLElement | null>(null);
const scrollElement = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getScrollElement());
// const scrollContentElement = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getContentElement());
// const contentWrapper = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getContentElement());

function getSimpleBarInstance(): any {
    return simpleBarRef.value?.SimpleBar;
}

function checkIsAtBottom(): boolean {
    const element = scrollElement.value;
    if (!element) return true;

    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceToBottom <= (props.scrollThreshold ?? SCROLL_THRESHOLD);
}

function handleScroll(event: Event): void {
    const wasAtBottom = isAtBottom.value;
    isAtBottom.value = checkIsAtBottom();
    emit('scroll', event);
}

function immediateScrollToBottom(): void {
    const element = scrollElement.value;
    if (element) {
        // requestAnimationFrame(() => {
        if (scrollElement.value) {
            scrollElement.value.scrollTop = scrollElement.value.scrollHeight * 2;
        }
        // });
    }
}

function smoothScrollToBottom(): void {
    const element = scrollElement.value;
    if (element) {
        const currentScrollHeight = element.scrollHeight;
        if (currentScrollHeight !== lastScrollHeight.value) {
            element.scrollTo({
                top: currentScrollHeight,
                behavior: 'smooth'
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
    emit('scroll-to-bottom');
}

function initScrollObservers() {
    // 清理旧的观察者
    if (mutationObserver.value) {
        mutationObserver.value.disconnect();
    }
    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }

    const contentEl = contentElement.value;
    // const wrapper = contentWrapper.value;
    if (!contentEl) return;

    // 使用 MutationObserver 监听 DOM 结构变化（更快响应）
    mutationObserver.value = new MutationObserver(() => {
        if (props.autoScroll) {
            immediateScrollToBottom();
        }
    });

    mutationObserver.value.observe(contentEl, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // 使用 ResizeObserver 作为兜底（处理图片加载等异步尺寸变化）
    resizeObserver.value = new ResizeObserver(() => {
        if (props.autoScroll) {
            requestAnimationFrame(() => {
                immediateScrollToBottom();
            });
        }
    });

    resizeObserver.value.observe(contentEl);
}

// 生命周期
onMounted(() => {
    initScrollObservers();
});

onUnmounted(() => {
    if (mutationObserver.value) {
        mutationObserver.value.disconnect();
    }
    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }
});

// 暴露给父组件的方法
defineExpose({
    contentElement,
    scrollToBottom,
    immediateScrollToBottom,
    smoothScrollToBottom,
    getScrollElement: () => scrollElement.value,
    scrollTop: () => scrollElement.value?.scrollTop,
    getScrollInstance: getSimpleBarInstance,
    isAtBottom: computed(() => isAtBottom.value)
});
</script>

<style scoped>
/* SimpleBar 滚动条样式 */
:deep(.simplebar-scrollbar::before) {
    background-color: #999;
}

:deep(.simplebar-scrollbar.simplebar-visible::before) {
    opacity: 0.6;
}

:deep(.simplebar-content-wrapper) {
    outline: none;
}

/* 自定义滚动条隐藏延迟为 6000ms (6秒) */
:deep(.simplebar-scrollbar)::before {
    transition: opacity 0.2s linear, background-color 0.2s linear;
    transition-delay: 6s;
}

/* 当鼠标悬停或滚动时,立即显示滚动条(无延迟) */
:deep(.simplebar-hover) .simplebar-scrollbar::before,
:deep(.simplebar-scrolling) .simplebar-scrollbar::before {
    transition-delay: 0s;
}
</style>