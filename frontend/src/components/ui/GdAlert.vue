<template>
    <div :class="alertClasses" :style="alertStyle" :data-type="type" role="alert">
        <span v-if="showIcon" class="gd-alert__icon flex shrink-0 items-center" :class="semanticIconClass[type]">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path v-for="(d, i) in semanticIconPaths[type]" :key="i" :d="d" />
            </svg>
        </span>
        <div class="min-w-0 flex-1">
            <div v-if="title" class="text-[13px] font-semibold leading-[18px] text-(--gd-color-text)">{{ title }}</div>
            <!-- description prop 与默认插槽等价渲染（el 双形态兼容） -->
            <div v-if="description" class="text-[13px] leading-[18px] text-(--gd-color-text-gray)" :class="{ 'mt-0.5': title }">{{ description }}</div>
            <div v-if="$slots.default" class="text-[13px] leading-[18px] text-(--gd-color-text-gray)" :class="{ 'mt-0.5': title }">
                <slot></slot>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { semanticIconClass, semanticIconPaths, normalizeSemanticType } from "./semanticIcons";

defineOptions({ name: "GdAlert" });

const props = withDefaults(defineProps<{
    /** 语义类型（el-alert 用 error 不是 danger，保持同名迁移零改写） */
    type?: "warning" | "info" | "error" | "success";
    /** 左侧语义图标（el 默认 false，保持一致迁移零改写） */
    showIcon?: boolean;
    title?: string;
    description?: string;
}>(), {
    type: "info",
    showIcon: false,
});

const emits = defineEmits<{ click: [event: MouseEvent] }>();

const type = computed(() => normalizeSemanticType(props.type));

// 边框/底色经内联 style 注入（Tailwind 静态扫描提取不到动态拼接类）
const alertStyle = computed((): CSSProperties => {
    const c = `var(--gd-color-${type.value === "error" ? "danger" : type.value})`;
    return {
        borderColor: `color-mix(in srgb, ${c} 35%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${c} 10%, transparent)`,
    };
});

const alertClasses = computed((): string => [
    // gd-alert 基类是主题插件的稳定定位钩子，配合 data-type 换肤，不要改名
    "gd-alert",
    "flex w-full items-start gap-2.5 rounded-md border px-3 py-2",
].join(" "));
</script>
