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

const contentElement = ref<HTMLElement | null>(null);
// 计算属性 - 类型化
const scrollElement = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getScrollElement());
const scrollContentElement = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getContentElement());
const contentWrapper = computed((): HTMLElement | undefined => getSimpleBarInstance()?.getContentElement());


// 防抖函数
// const debouncedScrollStateChange = useDebounceFn((state) => {
//     emit('scroll-state-change', state);
// }, 150);
// 方法 - 类型化
function getSimpleBarInstance(): any {
    return simpleBarRef.value?.SimpleBar;
}

function checkIsAtBottom(): boolean {
    const element = scrollElement.value;
    if (!element) return true;

    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    // if (distanceToBottom > 0)
    //     console.log('distanceToBottom', distanceToBottom);
    return distanceToBottom <= (props.scrollThreshold ?? SCROLL_THRESHOLD);
}

function handleScroll(event: Event): void {
    const wasAtBottom = isAtBottom.value;
    isAtBottom.value = checkIsAtBottom();
    
    // 当状态改变时发出事件
    if (wasAtBottom !== isAtBottom.value) {
        emit('is-at-bottom-change', isAtBottom.value);
    }
    
    emit('scroll', event);
}

function immediateScrollToBottom(): void {
    const element = scrollElement.value;
    if (element) {
        element.scrollTop = element.scrollHeight;
        // isAtBottom.value = true;
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
            // console.log('lastScrollHeight.value', lastScrollHeight.value);
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

// function initScrollObserver() {
//     if (scrollObserver.value) {
//         scrollObserver.value.disconnect();
//     }
//     const wrapper = contentWrapper.value;
//     if (!wrapper) return;

//     if (!window.ResizeObserver) {
//         scrollObserver.value = new ResizeObserver((entries) => {
//             const entry = entries[0];
//             const { width, height } = entry.contentRect;
//             const currentScrollHeight = scrollElement.value.scrollHeight;
//             console.log(`元素尺寸: ${width} x ${height}`);
//             console.log('currentScrollHeight', currentScrollHeight);
//             if (props.autoScroll) {
//                 // requestAnimationFrame(() => {
//                 //     immediateScrollToBottom();
//                 // })
//                 requestAnimationFrame(() => {
//                     console.log('[RAF 1] scrollHeight:', scrollElement.value.scrollHeight);
//                     requestAnimationFrame(() => {
//                         console.log('[RAF 2] FINAL scrollHeight:', scrollElement.value.scrollHeight);
//                         //immediateScrollToBottom();
//                     });
//                 });
//             }
//         })
//         scrollObserver.value.observe(wrapper);
//     } else {
//         scrollObserver.value = new MutationObserver((mutations) => {
//             const hasContentChange = mutations.some(mutation =>
//                 mutation.type === 'childList' && mutation.addedNodes.length > 0
//             );
//             // console.log('hasContentChange', hasContentChange);
//             if (hasContentChange && props.autoScroll) {
//                 requestAnimationFrame(() => {
//                     console.log('[RAF 1] scrollHeight:', scrollElement.value.scrollHeight);
//                     requestAnimationFrame(() => {
//                         console.log('[RAF 2] FINAL scrollHeight:', scrollElement.value.scrollHeight);
//                         // immediateScrollToBottom();
//                     });
//                 });
//             }
//             // isAtBottom.value = checkIsAtBottom();
//         });

//         scrollObserver.value.observe(wrapper, {
//             childList: true,
//             subtree: true,
//             characterData: true
//         });
//     }
// }

// 监听器
// watch(() => simpleBarRef.value, (newVal) => {
//     if (newVal && props.autoScroll) {
//         nextTick(() => {
//             initScrollObserver();
//         });
//     }
// }, { immediate: true });

// 生命周期
onMounted(() => {
    // lastScrollHeight.value = scrollElement.value?.scrollHeight || 0;
});

onUnmounted(() => {
    // if (scrollObserver.value) {
    //     scrollObserver.value.disconnect();
    // }
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