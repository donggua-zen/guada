<template>
    <div class="flex w-full h-full relative overflow-hidden">
        <!-- 遮罩层：仅在移动端且 sidebarVisible 时显示 -->
        <div v-if="isMobile && sidebarVisible" class="absolute inset-0 bg-black opacity-40 z-19"
            @click="$emit('update:sidebarVisible', false)"></div>
        <!-- 侧边栏容器 -->
        <div :class="[
            'h-full absolute lg:relative transform transition-all duration-300 ease-in-out justify-content-end shrink-0'
        ]" :style="{
            width: sidebarContainerWidth,
            maxWidth: sidebarContainerWidth,
            minWidth: sidebarContainerWidth,
            zIndex: zIndex
        }">
            <div class="absolute right-0 h-full" :style="{ width: (sidebarWidth ?? 278) < 0 ? '100vw' : `${sidebarWidth ?? 278}px` }">
                <slot name="sidebar" :sidebar-visible="sidebarVisible" />
            </div>

            <!-- 折叠展开按钮 -->
            <button v-if="showToggleButton" @click="$emit('update:sidebarVisible', !sidebarVisible)"
                class="absolute  top-1/2 right-0 transition-all transform -translate-y-1/2 w-4 h-16 flex items-center justify-center bg-white dark:bg-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none z-10  border-gray-200 dark:border-gray-800 dark:hover:bg-gray-600"
                :title="sidebarVisible ? '折叠侧边栏' : '展开侧边栏'"
                :class="sidebarVisible ? 'translate-x-1/2 rounded-lg border' : 'translate-x-full rounded-lg border'">
                <slot name="toggle-icon" :sidebar-visible="sidebarVisible">
                    <component :is="sidebarVisible ? ArrowLeftTwotone : ArrowRightTwotone" class="text-gray-600 dark:text-gray-200" />
                </slot>
            </button>
        </div>

        <!-- 主体内容 -->
        <div class="h-full flex-1 min-w-0">
            <slot name="content" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
// @ts-ignore - icons 类型缺失
import {
    ArrowBackIosNewTwotone as ArrowLeftTwotone,
    ArrowForwardIosTwotone as ArrowRightTwotone
} from "@vicons/material";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg') // md = 768px
// Props 类型化
const props = defineProps<{
    sidebarVisible?: boolean;
    sidebarWidth?: number;
    showToggleButton?: boolean;
    sidebarPosition?: 'left' | 'right';
    zIndex?: number;
}>();

// 计算侧边栏实际位置类 - 类型化
const sidebarContainerWidth = computed((): string => {
    if (props.sidebarVisible === false)
        return '0';
    return (props.sidebarWidth ?? 278) < 0 ? '100%' : (props.sidebarWidth ?? 278) + 'px';
});

// 计算切换按钮位置 - 类型化（此计算属性在模板中未使用，可以保留或删除）
const toggleButtonClasses = computed((): string => {
    const baseClasses = "absolute top-1/2 transform -translate-y-1/2 w-5 h-16 flex items-center justify-center bg-white rounded-r-lg shadow-sm hover:bg-gray-50 focus:outline-none z-10";

    if ((props.sidebarPosition ?? 'left') === 'left') {
        return props.sidebarVisible
            ? `${baseClasses} left-full -translate-x-full rounded-l-lg rounded-r-none`
            : `${baseClasses} left-0 translate-x-0 rounded-r-lg rounded-l-none`;
    } else {
        return props.sidebarVisible
            ? `${baseClasses} right-0 translate-x-full rounded-l-lg rounded-r-none`
            : `${baseClasses} right-0 translate-x-0 rounded-r-lg rounded-l-none`;
    }
});

// Emits 类型化
const emit = defineEmits<{
    'update:sidebarVisible': [value: boolean]
    toggle: []
}>();
</script>

<style scoped>
/* 可以添加自定义样式 */
</style>