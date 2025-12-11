<!-- ScrollContainer.vue -->
<template>
    <simple-bar class="ScrollContainer" :auto-hide="true" :timeout="6000" ref="simpleBarRef" @scroll="handleScroll">
        <div :class="mergredClasses" :style="attrs.style">
            <slot></slot>
        </div>
    </simple-bar>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useDebounceFn } from '@vueuse/core'
import SimpleBar from 'simplebar-vue'
import 'simplebar-vue/dist/simplebar.min.css'

// 常量定义
const SCROLL_THRESHOLD = 50;
import { useAttrs } from 'vue'

defineOptions({
    inheritAttrs: false // 禁用自动继承
})
const attrs = useAttrs()
// Props
const props = defineProps({
    autoScroll: {
        type: Boolean,
        default: false
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

const mergredClasses = computed(() => {
    let mergredClass = [];
    const classes = [attrs.class];
    if (mergredClass.value) {
        classes.push(mergredClass.value);
    }
    return classes.join(' ');
})

// Emits
const emit = defineEmits(['scroll', 'scroll-to-bottom', 'scroll-state-change']);

// 响应式数据
const simpleBarRef = ref(null);
const isAtBottom = ref(true);
const scrollObserver = ref(null);
const lastScrollHeight = ref(0);

// 计算属性
const scrollElement = computed(() => getSimpleBarInstance()?.getScrollElement());
const contentWrapper = computed(() => getSimpleBarInstance()?.getContentElement());

// 防抖函数
// const debouncedScrollStateChange = useDebounceFn((state) => {
//     emit('scroll-state-change', state);
// }, 150);
// 方法
function getSimpleBarInstance() {
    return simpleBarRef.value?.SimpleBar;
}

function checkIsAtBottom() {
    const element = scrollElement.value;
    if (!element) return true;

    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    // console.log('distanceToBottom', distanceToBottom);
    return distanceToBottom <= props.scrollThreshold;
}

function handleScroll(event) {
    const wasAtBottom = isAtBottom.value;
    isAtBottom.value = checkIsAtBottom();

    // if (wasAtBottom !== isAtBottom.value) {
    //     debouncedScrollStateChange(isAtBottom.value);
    // }

    emit('scroll', event);
}

function immediateScrollToBottom() {
    const element = scrollElement.value;
    if (element) {
        element.scrollTop = element.scrollHeight;
        isAtBottom.value = true;
    }
}

function smoothScrollToBottom() {
    const element = scrollElement.value;
    if (element) {
        const currentScrollHeight = element.scrollHeight;
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
    const wrapper = contentWrapper.value;
    if (!wrapper) return;

    scrollObserver.value = new MutationObserver((mutations) => {
        const hasContentChange = mutations.some(mutation =>
            mutation.type === 'childList' && mutation.addedNodes.length > 0
        );
        // console.log('hasContentChange', hasContentChange);
        if (hasContentChange && props.autoScroll && isAtBottom.value) {
            requestAnimationFrame(() => {
                immediateScrollToBottom();
            });
        }
        // isAtBottom.value = checkIsAtBottom();
    });

    scrollObserver.value.observe(wrapper, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// 监听器
watch(() => simpleBarRef.value, (newVal) => {
    if (newVal && props.autoScroll) {
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