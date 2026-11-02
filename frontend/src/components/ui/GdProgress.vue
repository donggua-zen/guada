<template>
    <div :class="rootClasses" :data-status="status" role="progressbar" :aria-valuenow="percentage"
        aria-valuemin="0" aria-valuemax="100">
        <div class="gd-progress__track relative w-full overflow-hidden rounded-full bg-[var(--gd-color-field-bg-hover)]"
            :style="{ height: `${strokeWidth}px` }">
            <!-- indeterminate 流光：30% 宽高亮条循环平移 -->
            <div v-if="indeterminate" class="gd-progress__shimmer absolute inset-y-0 w-1/3 rounded-full bg-[var(--gd-color-primary)] opacity-60"></div>
            <div v-else class="gd-progress__bar h-full rounded-full transition-[width] duration-200"
                :style="{ width: `${clamped}%`, backgroundColor: barColor }"></div>
        </div>
        <span v-if="showText" class="gd-progress__text w-9 shrink-0 text-right text-[12px] leading-none text-[var(--gd-color-text-gray)] tabular-nums">
            {{ Math.round(percentage) }}%
        </span>
    </div>
</template>
<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "GdProgress" });

const props = withDefaults(defineProps<{
    percentage: number;
    /** 线型轨道粗细（px） */
    strokeWidth?: number;
    showText?: boolean;
    /** 流光模式（总进度未知时）：轨道内高亮条循环平移 */
    indeterminate?: boolean;
    /** 自定义填充色：hex 或 (percentage) => hex（MemoPanel 三段渐变映射） */
    color?: string | ((percentage: number) => string);
    /** 语义状态色（color 未传时生效）：success 绿 / warning 黄 / exception 红 */
    status?: "success" | "warning" | "exception";
}>(), {
    strokeWidth: 6,
    showText: true,
    indeterminate: false,
});

const clamped = computed(() => Math.min(100, Math.max(0, props.percentage)));

const STATUS_COLOR: Record<string, string> = {
    success: "var(--gd-color-success)",
    warning: "var(--gd-color-warning)",
    exception: "var(--gd-color-danger)",
};

const barColor = computed((): string => {
    if (props.color) {
        return typeof props.color === "function" ? props.color(props.percentage) : props.color;
    }
    if (props.status) return STATUS_COLOR[props.status];
    return "var(--gd-color-primary)";
});

const rootClasses = computed((): string => [
    // gd-progress 基类是主题插件的稳定定位钩子，配合 data-status 换肤，不要改名
    "gd-progress",
    "flex min-w-0 items-center gap-2",
].join(" "));
</script>
<style scoped>
/* indeterminate 流光：高亮条从左到右循环（reduced-motion 由 style.css 全局兜底） */
.gd-progress__shimmer {
    animation: gd-progress-shimmer 1.6s var(--gd-motion-ease-in-out) infinite;
}

@keyframes gd-progress-shimmer {
    from {
        left: -33%;
    }

    to {
        left: 100%;
    }
}
</style>
