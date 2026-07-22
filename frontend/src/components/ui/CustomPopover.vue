<template>
    <teleport to="body">
        <transition name="popover-fade">
            <div v-if="show" ref="popoverRef"
                class="fixed bg-white dark:bg-(--color-surface) rounded-xl border border-gray-200 dark:border-(--color-surface-border) shadow-[0_0_16px_rgba(0,0,0,0.10)] dark:shadow-[0_0_8px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col z-2000 pointer-events-auto px-1 py-1"
                :class="popperClass" :style="popoverStyle" @click.stop
                @mouseenter="$emit('mouseenter', $event)" @mouseleave="$emit('mouseleave', $event)">
                <!-- Header 槽位 -->
                <div v-if="$slots.header" class="">
                    <slot name="header"></slot>
                </div>
                <!-- 默认内容 -->
                <div class="popover-content">
                    <slot></slot>
                </div>
            </div>
        </transition>
    </teleport>
</template>
<style scoped>
.popover-content {
    overflow-y: auto;
}
</style>
<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'

interface Props {
    show: boolean
    width?: number | string
    maxHeight?: number | string
    popperClass?: string
    anchorEl?: HTMLElement | null
    /** 直接指定 fixed 坐标 { left, top }，跳过自动定位 */
    position?: { left: number; top: number } | null
}

const props = withDefaults(defineProps<Props>(), {
    show: false,
    width: 320,
    maxHeight: 400,
    popperClass: '',
    anchorEl: null,
    position: null,
})

const emit = defineEmits<{
    'update:show': [value: boolean]
    mouseenter: [event: MouseEvent]
    mouseleave: [event: MouseEvent]
}>()

const popoverRef = ref<HTMLElement | null>(null)
const positionStyle = ref<Record<string, any>>({})
let resizeObserver: ResizeObserver | null = null

// 计算并更新位置
const updatePosition = () => {
    // 如果外部直接传入了坐标，直接使用
    if (props.position) {
        positionStyle.value = {
            position: 'fixed',
            left: `${props.position.left}px`,
            top: `${props.position.top}px`
        }
        return
    }

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
        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom

        let showAbove: boolean

        if (spaceAbove >= actualHeight + spacing) {
            showAbove = true
        } else if (spaceBelow >= actualHeight + spacing) {
            showAbove = false
        } else {
            showAbove = spaceAbove > spaceBelow
        }

        if (showAbove) {
            // 上方：用 bottom 定位，高度变化时底部不变，不跳动
            positionStyle.value = {
                position: 'fixed',
                left: `${left}px`,
                bottom: `${window.innerHeight - rect.top + spacing}px`,
                top: 'auto'
            }
        } else {
            // 下方：用 top 定位
            positionStyle.value = {
                position: 'fixed',
                left: `${left}px`,
                top: `${rect.bottom + spacing}px`,
                bottom: 'auto'
            }
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

    // 如果有 position（级联模式），检查是否在触发元素上
    if (props.position) {
        // 级联模式下点击外部直接关闭
        if (popoverRef.value && popoverRef.value.contains(target)) return
    }

    // 否则关闭弹窗
    emit('update:show', false)
}

// 处理 Esc 键关闭弹窗
const handleEscKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.show) {
        emit('update:show', false)
    }
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
const handleWindowEvent = (e: Event) => {
    if (!props.show) return
    // 如果 scroll 事件来自弹窗内部，忽略
    // scroll 事件不冒泡，但捕获阶段可以拦截
    const target = e.target as HTMLElement
    if (popoverRef.value && popoverRef.value.contains(target)) return
    updatePosition()
}

// 监听可见性变化，统一管理所有副作用
watch(() => props.show, async (newVal) => {
    if (newVal) {
        // DOM 更新后计算位置
        await nextTick()
        updatePosition()

        // 监听内容尺寸变化，自动重新定位
        if (popoverRef.value && !resizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                if (props.show) updatePosition()
            })
            resizeObserver.observe(popoverRef.value)
        }

        // 延迟添加监听器，避免立即触发关闭
        await nextTick()
        document.addEventListener('click', handleGlobalClick, true)
        document.addEventListener('keydown', handleEscKey)
        window.addEventListener('resize', handleWindowEvent)
        window.addEventListener('scroll', handleWindowEvent, true)
    } else {
        // 移除所有监听器
        if (resizeObserver) {
            resizeObserver.disconnect()
            resizeObserver = null
        }
        document.removeEventListener('click', handleGlobalClick, true)
        document.removeEventListener('keydown', handleEscKey)
        window.removeEventListener('resize', handleWindowEvent)
        window.removeEventListener('scroll', handleWindowEvent, true)
    }
})

// 组件卸载时清理监听器
onUnmounted(() => {
    if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
    }
    document.removeEventListener('click', handleGlobalClick, true)
    document.removeEventListener('keydown', handleEscKey)
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
