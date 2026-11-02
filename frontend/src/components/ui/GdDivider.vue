<template>
    <div :class="rootClasses" :data-direction="direction" role="separator">
        <!-- vertical：纯竖线 -->
        <template v-if="direction === 'vertical'">
            <div class="gd-divider__line w-px self-stretch bg-[var(--gd-color-border)]"></div>
        </template>
        <!-- horizontal 无插槽：单线 -->
        <div v-else-if="!$slots.default" class="gd-divider__line h-px w-full bg-[var(--gd-color-border)]"></div>
        <!-- horizontal 带文字：线-文字-线，position 决定两侧线宽 -->
        <template v-else>
            <div class="gd-divider__line h-px bg-[var(--gd-color-border)]"
                :class="contentPosition === 'right' ? 'flex-1' : contentPosition === 'left' ? 'w-4' : 'flex-1'"></div>
            <span class="gd-divider__text shrink-0 text-[13px] leading-none text-[var(--gd-color-text-gray)]">
                <slot></slot>
            </span>
            <div class="gd-divider__line h-px bg-[var(--gd-color-border)]"
                :class="contentPosition === 'left' ? 'flex-1' : contentPosition === 'right' ? 'w-4' : 'flex-1'"></div>
        </template>
    </div>
</template>
<script setup lang="ts">
import { computed, useSlots } from "vue";

defineOptions({ name: "GdDivider" });

const props = withDefaults(defineProps<{
    direction?: "horizontal" | "vertical";
    contentPosition?: "left" | "center" | "right";
}>(), {
    direction: "horizontal",
    contentPosition: "center",
});

const $slots = useSlots();

const rootClasses = computed((): string => [
    // gd-divider 基类是主题插件的稳定定位钩子，配合 data-direction 换肤，不要改名
    "gd-divider",
    props.direction === "vertical"
        ? "inline-flex items-stretch"
        : "flex w-full items-center gap-3",
].join(" "));
</script>
