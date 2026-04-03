<!-- ScrollContainer.vue -->
<template>
    <!-- @ts-ignore - attrs.style 类型不兼容 -->
    <simple-bar class="ScrollContainer" :auto-hide="true" :timeout="6000" ref="simpleBarRef" @scroll="handleScroll">
        <div ref="contentElement" :class="mergredClasses" :style="attrs.style">
            <slot></slot>
        </div>
    </simple-bar>
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
import { useAttrs } from 'vue'

defineOptions({
    inheritAttrs: false // 禁用自动继承
})
const attrs = useAttrs()

const needScrollToBottom = ref(false);

// Props 类型化
const props = defineProps<{
    autoScroll?: boolean;
    scrollThreshold?: number;
    smoothScroll?: boolean;
    enableScrollButton?: boolean;
}>();

const mergredClasses = computed((): string => {
    let mergredClass: string | string[] = [];
    const classes: (string | undefined)[] = [attrs.class as string];
    if (mergredClass) {
        if (Array.isArray(mergredClass)) {
            classes.push(...mergredClass);
        } else {
            classes.push(mergredClass);
        }
    }
    return classes.filter(Boolean).join(' ');
})

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
const scrollObserver = ref<any>(null);
const lastScrollHeight = ref(0);
const lastScrollTop = ref(0);

const contentElement = ref<HTMLElement | null>(null);
const scrollElement = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getScrollElement());
const scrollContentElement = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getContentElement());
const contentWrapper = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getContentElement());

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
    if (wasAtBottom !== isAtBottom.value) {
        emit('is-at-bottom-change', isAtBottom.value);
    }
    if (props.autoScroll) {
        if (isAtBottom.value) {
            needScrollToBottom.value = true;
        }
        if (lastScrollTop.value < scrollElement.value.scrollTop) {
            needScrollToBottom.value = false;
        } else if (lastScrollTop.value > scrollElement.value.scrollTop) {
            needScrollToBottom.value = false;
        }
    }
    lastScrollTop.value = scrollElement.value.scrollTop;
    emit('scroll', event);
}

function immediateScrollToBottom(): void {
    const element = scrollElement.value;
    if (element) {
        element.scrollTop = element.scrollHeight;
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

function initScrollObserver() {
    if (scrollObserver.value) {
        scrollObserver.value.disconnect();
    }
    const wrapper = contentWrapper.value;
    if (!wrapper) return;

    scrollObserver.value = new ResizeObserver((entries) => {
        const entry = entries[0];
        const { width, height } = entry.contentRect;
        const currentScrollHeight = scrollElement.value.scrollHeight;
        if (needScrollToBottom.value) {
            immediateScrollToBottom();
        }
    })
    scrollObserver.value.observe(wrapper);
}

// 生命周期
onMounted(() => {
    initScrollObserver();
});

onUnmounted(() => {
    if (scrollObserver.value) {
        scrollObserver.value.disconnect();
    }
});

// 暴露给父组件的方法
defineExpose({
    contentElement,
    scrollContentElement,
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
.ScrollContainer {
    width: 100%;
    height: 100%;
}

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
</style>