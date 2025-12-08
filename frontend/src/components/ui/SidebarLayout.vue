<template>
    <div class="flex w-full h-full">
        <!-- 侧边栏容器 -->
        <div :class="[
            'h-full relative transform transition-all duration-300 ease-in-out justify-content-end flex-shrink-0'
        ]" :style="{
            width: sidebarVisible ? `${sidebarWidth}px` : '0',
            maxWidth: sidebarVisible ? `${sidebarWidth}px` : '0',
            minWidth: sidebarVisible ? `${sidebarWidth}px` : '0'
        }">
            <div class="absolute right-0 h-full" :style="{ width: `${sidebarWidth}px` }">
                <slot name="sidebar" :sidebar-visible="sidebarVisible" />
            </div>

            <!-- 折叠展开按钮 -->
            <button v-if="showToggleButton" @click="$emit('update:sidebarVisible', !sidebarVisible)"
                class="absolute top-1/2 right-0 transform -translate-y-1/2 translate-x-full w-4 h-16 flex items-center justify-center bg-white rounded-r-lg shadow-sm hover:bg-gray-50 focus:outline-none z-10"
                :title="sidebarVisible ? '折叠侧边栏' : '展开侧边栏'">
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
    }
});

// 计算侧边栏实际位置类
const sidebarPositionClasses = computed(() => {
    return props.sidebarPosition === 'left'
        ? 'left-0'
        : 'right-0';
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