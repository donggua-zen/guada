<!-- ScrollContainer.vue -->
<template>
    <SimpleBar :options="scrollbarOptions" :timeout="4000" class="scroll-container" ref="simpleBarRef"
        @scroll="handleScroll">
        <div class="scroll-content" ref="contentRef">
            <slot></slot>
        </div>
    </SimpleBar>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useDebounceFn } from '@vueuse/core'

// 常量定义
const SCROLL_THRESHOLD = 80;
const SCROLLBAR_OPTIONS = {
    autoHide: true,
    timeout: 4000
};

// Props
const props = defineProps({
    autoScroll: {
        type: Boolean,
        default: true
    },
    scrollThreshold: {
        type: Number,
        default: SCROLL_THRESHOLD
    },
    smoothScroll: {
        type: Boolean,
        default: false
    }
});

// Emits
const emit = defineEmits(['scroll', 'scroll-to-bottom', 'scroll-state-change']);

// 响应式数据
const simpleBarRef = ref(null);
const contentRef = ref(null);
const scrollbarOptions = ref(SCROLLBAR_OPTIONS);
const isAtBottom = ref(true);
const scrollObserver = ref(null);
const lastScrollHeight = ref(0);

// 计算属性
const scrollElement = computed(() => getSimpleBarInstance()?.getScrollElement());
const contentWrapper = computed(() => getSimpleBarInstance()?.getContentElement());

// 防抖函数
const debouncedScrollStateChange = useDebounceFn((state) => {
    emit('scroll-state-change', state);
}, 150);

// 方法
function getSimpleBarInstance() {
    return simpleBarRef.value?.SimpleBar;
}

function checkIsAtBottom() {
    const element = scrollElement.value;
    if (!element) return true;

    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceToBottom <= props.scrollThreshold;
}

function handleScroll(event) {
    const wasAtBottom = isAtBottom.value;
    isAtBottom.value = checkIsAtBottom();

    if (wasAtBottom !== isAtBottom.value) {
        debouncedScrollStateChange(isAtBottom.value);
    }

    emit('scroll', event);
}

function immediateScrollToBottom() {
    console.log('immediateScrollToBottom');
    const element = scrollElement.value;
    if (element) {
        element.scrollTop = element.scrollHeight;
    }
}

function smoothScrollToBottom() {
    console.log('smoothScrollToBottom');
    const element = scrollElement.value;
    if (element) {
        const currentScrollHeight = element.scrollHeight;
        console.log('element', element);
        if (currentScrollHeight > lastScrollHeight.value) {
            element.scrollTo({
                top: currentScrollHeight,
                behavior: props.smoothScroll ? 'smooth' : 'instant'
            });
            lastScrollHeight.value = currentScrollHeight;
        }
    }
}

function scrollToBottom(options = {}) {
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
    console.log('initScrollObserver');
    const wrapper = contentWrapper.value;
    if (!wrapper) return;
    console.log('wrapper', wrapper);

    scrollObserver.value = new MutationObserver((mutations) => {
        const hasContentChange = mutations.some(mutation =>
            mutation.type === 'childList' && mutation.addedNodes.length > 0
        );
        console.log('hasContentChange', hasContentChange);
        if (hasContentChange && props.autoScroll && isAtBottom.value) {
            requestAnimationFrame(() => {
                immediateScrollToBottom();
            });
           
        }
    });

    scrollObserver.value.observe(wrapper, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// 监听器
watch(() => simpleBarRef.value, (newVal) => {
    if (newVal) {
        nextTick(() => {
            initScrollObserver();
        });
    }
}, { immediate: true });

// 生命周期
onMounted(() => {
    lastScrollHeight.value = scrollElement.value?.scrollHeight || 0;
});

onUnmounted(() => {
    if (scrollObserver.value) {
        scrollObserver.value.disconnect();
    }
});

// 暴露给父组件的方法
defineExpose({
    scrollToBottom,
    immediateScrollToBottom,
    smoothScrollToBottom,
    getScrollElement: () => scrollElement.value,
    getScrollInstance: getSimpleBarInstance,
    isAtBottom: computed(() => isAtBottom.value)
});
</script>

<style scoped>
.scroll-container {
    width: 100%;
    height: 100%;
}

.scroll-content {
    padding: 25px 0;
}
</style>