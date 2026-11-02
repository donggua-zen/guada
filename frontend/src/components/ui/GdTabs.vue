<template>
    <div :class="rootClasses" :data-active="modelValue" role="tablist" @keydown="handleKeydown">
        <button v-for="t in tabs" :key="t.name" type="button" role="tab"
            :aria-selected="modelValue === t.name" :tabindex="modelValue === t.name ? 0 : -1"
            :class="tabClasses(t)" @click="select(t.name)">
            <component :is="t.icon" v-if="t.icon" class="size-4 shrink-0" />
            <span>{{ t.label }}</span>
        </button>
    </div>
</template>
<script setup lang="ts">
import { computed, type Component } from "vue";

defineOptions({ name: "GdTabs" });

export interface GdTabItem {
    name: string;
    label: string;
    icon?: Component;
}

const props = withDefaults(defineProps<{
    modelValue?: string;
    tabs: GdTabItem[];
}>(), {
    modelValue: "",
});

const emits = defineEmits<{
    "update:modelValue": [name: string];
    change: [name: string];
}>();

const select = (name: string): void => {
    if (props.modelValue === name) return;
    emits("update:modelValue", name);
    emits("change", name);
};

/** 左右箭头在 tab 间循环移动 */
const handleKeydown = (e: KeyboardEvent): void => {
    if (!props.tabs.length) return;
    const idx = props.tabs.findIndex((t) => t.name === props.modelValue);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % props.tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + props.tabs.length) % props.tabs.length;
    if (next >= 0) {
        e.preventDefault();
        select(props.tabs[next].name);
    }
};

const rootClasses = computed((): string => [
    // gd-tabs 基类是主题插件的稳定定位钩子，配合 data-active 换肤，不要改名
    "gd-tabs",
    "flex items-center gap-6 border-b border-(--gd-color-border) overflow-x-auto",
].join(" "));

const tabClasses = (t: GdTabItem): string => {
    const active = props.modelValue === t.name;
    return [
        "gd-tabs__item relative flex h-11 shrink-0 cursor-pointer select-none items-center gap-1.5 px-1 text-[15px] leading-none transition-colors duration-150",
        // 下划线：选中项底部 2px 主色条（border-b-2 与容器线重叠 -1px）
        active
            ? "border-b-2 border-[var(--gd-color-primary)] -mb-px font-medium text-(--gd-color-text)"
            : "border-b-2 border-transparent -mb-px text-(--gd-color-text-gray) hover:text-(--gd-color-text)",
    ].join(" ");
};
</script>
