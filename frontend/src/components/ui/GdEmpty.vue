<template>
    <div class="gd-empty flex flex-col items-center justify-center gap-3 py-10" :data-size="imageSize">
        <svg class="text-[var(--gd-color-text-disabled)] opacity-50" :style="{ width: `${imageSize}px`, height: `${imageSize}px` }"
            viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true">
            <!-- 空盒线稿（极简替代 EP 插画） -->
            <path d="M8 22 32 10l24 12-24 12L8 22Z" />
            <path d="M8 22v20l24 12V34" />
            <path d="M56 22v20L32 54V34" />
            <path d="M20 16l24 12" />
        </svg>
        <p v-if="description" class="gd-empty__description m-0 text-[13px] leading-none text-[var(--gd-color-text-disabled)]">
            {{ description }}
        </p>
        <slot></slot>
    </div>
</template>
<script setup lang="ts">
defineOptions({ name: "GdEmpty" });

withDefaults(defineProps<{
    description?: string;
    /** 线稿图标边长（px），对齐 el-empty 的 image-size 语义 */
    imageSize?: number;
}>(), {
    imageSize: 80,
});
</script>
