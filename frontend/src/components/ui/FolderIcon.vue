<template>
    <!-- feather 风格文件夹图标（与 workspace 目录树同源），颜色跟随 currentColor -->
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
    /** 图标尺寸（像素），默认 16，与 workspace 树一致 */
    size?: number
}>(), {
    size: 16,
})
</script>
