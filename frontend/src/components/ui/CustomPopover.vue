<template>
    <teleport to="body">
        <transition name="popover-fade">
            <div v-if="show" ref="popoverRef" 
                class="fixed bg-white dark:bg-(--color-surface) rounded-lg border border-gray-200 dark:border-(--color-border) shadow-[0_12px_32px_rgba(0,0,0,0.15),0_4px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.4),0_4px_8px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col z-2000 pointer-events-auto p-4"
                :class="popperClass" 
                :style="popoverStyle"
                @click.stop>
                <!-- Header 槽位 -->
                <div v-if="$slots.header" class="mb-3">
                    <slot name="header"></slot>
                </div>
                <!-- 默认内容 -->
                <slot></slot>
            </div>
        </transition>
    </teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'

interface Props {
    show: boolean
    width?: number | string
    maxHeight?: number | string
    popperClass?: string
    anchorEl?: HTMLElement | null
}

const props = withDefaults(defineProps<Props>(), {
    show: false,
    width: 320,
    maxHeight: 400,
    popperClass: '',
    anchorEl: null
})

const emit = defineEmits<{
    'update:show': [value: boolean]
}>()

const popoverRef = ref<HTMLElement | null>(null)
const positionStyle = ref<Record<string, any>>({})

// 计算并更新位置
const updatePosition = () => {
    if (!props.anchorEl || !popoverRef.value) return

    const rect = props.anchorEl.getBoundingClientRect()
    const popoverElement = popoverRef.value

    // 等待下一帧确保元素已渲染
    requestAnimationFrame(() => {
        const actualHeight = popoverElement.offsetHeight
        const popoverWidth = typeof props.width === 'number' ? props.width : 320
        const spacing = 8

        // 计算水平位置：以按钮为中心对齐
        let left = rect.left + (rect.width / 2) - (popoverWidth / 2)

        // 边界检查：确保不超出视口左右边界
        const viewportWidth = window.innerWidth
        if (left < 10) {
            left = 10
        } else if (left + popoverWidth > viewportWidth - 10) {
            left = viewportWidth - popoverWidth - 10
        }

        // 计算垂直位置：优先显示在按钮上方
        const spaceAbove = rect.top // 按钮上方的可用空间
        const spaceBelow = window.innerHeight - rect.bottom // 按钮下方的可用空间

        let top: number

        // 如果上方空间足够，显示在上方；否则显示在下方
        if (spaceAbove >= actualHeight + spacing) {
            // 显示在按钮上方
            top = rect.top - actualHeight - spacing
        } else if (spaceBelow >= actualHeight + spacing) {
            // 显示在按钮下方
            top = rect.bottom + spacing
        } else {
            // 上下空间都不够，选择空间较大的一侧
            if (spaceAbove > spaceBelow) {
                top = rect.top - actualHeight - spacing
            } else {
                top = rect.bottom + spacing
            }
        }

        // 确保不超出视口上下边界
        if (top < 10) {
            top = 10
        } else if (top + actualHeight > window.innerHeight - 10) {
            top = window.innerHeight - actualHeight - 10
        }

        positionStyle.value = {
            position: 'fixed',
            left: `${left}px`,
            top: `${top}px`
        }
    })
}

// 处理全局点击事件 - 点击外部关闭弹窗
const handleGlobalClick = (e: MouseEvent) => {
    if (!props.show) return

    const target = e.target as HTMLElement

    // 如果点击在弹窗内部，不关闭
    if (popoverRef.value && popoverRef.value.contains(target)) {
        return
    }

    // 如果点击在锚点元素上，不关闭（避免触发 toggle 后立即关闭）
    if (props.anchorEl && props.anchorEl.contains(target)) {
        return
    }

    // 否则关闭弹窗
    emit('update:show', false)
}

// 计算弹窗位置和样式
const popoverStyle = computed(() => {
    const style: Record<string, any> = {
        width: typeof props.width === 'number' ? `${props.width}px` : props.width,
        maxHeight: typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight
    }

    // 合并动态位置
    return { ...style, ...positionStyle.value }
})

// 处理窗口 resize 和 scroll 事件，更新位置
const handleWindowEvent = () => {
    if (props.show) {
        updatePosition()
    }
}

// 监听可见性变化，统一管理所有副作用
watch(() => props.show, async (newVal) => {
    if (newVal && props.anchorEl) {
        // DOM 更新后计算位置
        await nextTick()
        updatePosition()

        // 延迟添加监听器，避免立即触发关闭
        await nextTick()
        document.addEventListener('click', handleGlobalClick, true)
        window.addEventListener('resize', handleWindowEvent)
        window.addEventListener('scroll', handleWindowEvent, true)
    } else {
        // 移除所有监听器
        document.removeEventListener('click', handleGlobalClick, true)
        window.removeEventListener('resize', handleWindowEvent)
        window.removeEventListener('scroll', handleWindowEvent, true)
    }
})

// 组件卸载时清理监听器
onUnmounted(() => {
    document.removeEventListener('click', handleGlobalClick, true)
    window.removeEventListener('resize', handleWindowEvent)
    window.removeEventListener('scroll', handleWindowEvent, true)
})
</script>

<style scoped>
/* 淡入淡出动画 - 只动画透明度，不动画位置 */
.popover-fade-enter-active,
.popover-fade-leave-active {
    transition: opacity 0.2s ease-out;
}

.popover-fade-enter-from {
    opacity: 0;
}

.popover-fade-leave-to {
    opacity: 0;
}

/* 移动端适配 */
@media (max-width: 768px) {
    .custom-popover {
        max-width: calc(100vw - 32px);
        max-height: 50vh;
    }
}
</style>
