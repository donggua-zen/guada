<template>
    <div class="flex w-full h-full relative overflow-hidden">
        <!-- 遮罩层：仅在移动端且 sidebarVisible 时显示 -->
        <div v-if="isMobile && sidebarVisible" class="absolute inset-0 bg-black opacity-40 z-[49]"
            @click="$emit('update:sidebarVisible', false)"></div>
        <!-- 侧边栏容器 -->
        <div :class="[
            'h-full absolute md:relative transform transition-all duration-300 ease-in-out justify-content-end flex-shrink-0'
        ]" :style="{
            width: sidebarContainerWidth,
            maxWidth: sidebarContainerWidth,
            minWidth: sidebarContainerWidth,
            zIndex: zIndex
        }">
            <div class="absolute right-0 h-full" :style="{ width: sidebarWidth < 0 ? '100vw' : `${sidebarWidth}px` }">
                <slot name="sidebar" :sidebar-visible="sidebarVisible" />
            </div>

            <!-- 折叠展开按钮 -->
            <button v-if="showToggleButton" @click="$emit('update:sidebarVisible', !sidebarVisible)"
                class="absolute  top-1/2 right-0 transition-all transform -translate-y-1/2 w-4 h-16 flex items-center justify-center bg-white shadow-sm hover:bg-gray-50 focus:outline-none z-10"
                :title="sidebarVisible ? '折叠侧边栏' : '展开侧边栏'"
                :class="sidebarVisible ? 'translate-x-1/2 rounded-lg border border-gray-200' : 'translate-x-full rounded-r-lg border-r border-gray-200'">
                <slot name="toggle-icon" :sidebar-visible="sidebarVisible">
                    <n-icon :component="sidebarVisible ? ArrowLeftTwotone : ArrowRightTwotone" class="text-gray-600" />
                </slot>
            </button>
        </div>

        <!-- 主体内容 -->
        <div class="h-full flex-1 min-w-0">
            <slot name="content" />
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { NIcon } from "naive-ui";
import {
    ArrowBackIosNewTwotone as ArrowLeftTwotone,
    ArrowForwardIosTwotone as ArrowRightTwotone
} from "@vicons/material";
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px
// Props
const props = defineProps({
    // 侧边栏显示状态
    sidebarVisible: {
        type: Boolean,
        default: true
    },
    // 侧边栏宽度（像素）
    sidebarWidth: {
        type: Number,
        default: 288 // 72 * 4 = 288px (Tailwind w-72)
    },
    // 是否显示切换按钮
    showToggleButton: {
        type: Boolean,
        default: true
    },
    // 侧边栏位置（左/右）
    sidebarPosition: {
        type: String,
        default: 'left', // 'left' 或 'right'
        validator: (value) => ['left', 'right'].includes(value)
    },
    zIndex: {
        type: Number,
        default: 50
    }
});

// 计算侧边栏实际位置类
const sidebarContainerWidth = computed(() => {
    if (props.sidebarVisible === false)
        return '0';
    return props.sidebarWidth < 0 ? '100%' : props.sidebarWidth + 'px';
});

// 计算切换按钮位置
const toggleButtonClasses = computed(() => {
    const baseClasses = "absolute top-1/2 transform -translate-y-1/2 w-5 h-16 flex items-center justify-center bg-white rounded-r-lg shadow-sm hover:bg-gray-50 focus:outline-none z-10";

    if (props.sidebarPosition === 'left') {
        return props.sidebarVisible
            ? `${baseClasses} left-full -translate-x-full rounded-l-lg rounded-r-none`
            : `${baseClasses} left-0 translate-x-0 rounded-r-lg rounded-l-none`;
    } else {
        return props.sidebarVisible
            ? `${baseClasses} right-0 translate-x-full rounded-l-lg rounded-r-none`
            : `${baseClasses} right-0 translate-x-0 rounded-r-lg rounded-l-none`;
    }
});

// 事件
const emit = defineEmits(['update:sidebarVisible', 'toggle']);
</script>

<style scoped>
/* 可以添加自定义样式 */
</style>