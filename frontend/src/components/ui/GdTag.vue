<template>
    <span :class="tagClasses" :style="tagStyle" :data-type="resolvedType" :data-effect="effect"
        :data-size="resolvedSize">
        <slot></slot>
        <button v-if="closable" type="button" :tabindex="-1" aria-label="移除"
            class="gd-tag__close -mr-1 flex size-3.5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 opacity-60 transition-opacity duration-150 hover:opacity-100"
            @click.stop="emit('close', $event)">
            <svg class="size-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
        </button>
    </span>
</template>
<script setup lang="ts">
import { computed, type CSSProperties } from "vue";

defineOptions({ name: "GdTag" });

const props = withDefaults(defineProps<{
    /** 语义色：error 是 danger 的插件契约别名（沿用 GdButton 惯例） */
    type?: "info" | "success" | "warning" | "danger" | "primary" | "error";
    /** light 软色底（默认）/ plain 描边 / dark 实色反白 */
    effect?: "light" | "plain" | "dark";
    size?: "small" | "medium";
    closable?: boolean;
}>(), {
    type: "info",
    effect: "light",
    size: "small",
});

const emit = defineEmits<{
    close: [event: MouseEvent];
}>();

const resolvedType = computed((): string => {
    const key = (props.type || "info").toLowerCase();
    return key === "error" ? "danger" : key;
});
const resolvedSize = computed((): string => (props.size === "medium" ? "medium" : "small"));

/**
 * 颜色经局部变量 --gd-tag-c 注入（不用 Tailwind 动态拼接类——静态扫描提取不到模板串）。
 * 三态配方：light 软色底 12% / plain 描边 45% / dark 实色反白；主题经 data-* 钩子换肤。
 */
const tagStyle = computed((): CSSProperties => {
    const c = `var(--gd-color-${resolvedType.value})`;
    const base: CSSProperties = { '--gd-tag-c': c };
    if (props.effect === 'dark') {
        return { ...base, backgroundColor: c, color: '#fff', borderColor: 'transparent' };
    }
    if (props.effect === 'plain') {
        return {
            ...base,
            backgroundColor: 'transparent',
            color: c,
            borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
        };
    }
    return {
        ...base,
        backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`,
        color: c,
        borderColor: 'transparent',
    };
});

const tagClasses = computed((): string => [
    // gd-tag 基类是主题插件的稳定定位钩子，
    // 配合 data-type / data-effect / data-size 做拟物化换肤，不要改名
    "gd-tag",
    "inline-flex shrink-0 select-none items-center gap-1 whitespace-nowrap border align-middle rounded-full",
    "leading-none transition-colors duration-150",
    resolvedSize.value === "medium"
        ? "h-[26px] px-2.5 text-[12px]"
        : "h-[20px] px-1.5 text-[11px] font-medium",
].join(" "));
</script>
