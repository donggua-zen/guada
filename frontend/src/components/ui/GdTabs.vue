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
    // 底部基线用 inset box-shadow 画在内容盒内侧（见下方 <style>），而不是 border-b：
    // border 会把内容盒上移 1px，与 h-11 的 tab 项形成溢出，overflow-x:auto 时
    // 纵向会被折算成 auto，冒出 1px 纵向滚动条
    "flex items-center gap-6 overflow-x-auto overflow-y-hidden",
].join(" "));

const tabClasses = (t: GdTabItem): string => {
    const active = props.modelValue === t.name;
    return [
        "gd-tabs__item relative flex h-11 shrink-0 cursor-pointer select-none items-center gap-1.5 px-1 text-[15px] leading-none transition-colors duration-150",
        // 下划线：选中项底部 2px 主色条，直接覆盖容器内侧的基线（同一内容盒内，无溢出）
        active
            ? "border-b-2 border-[var(--gd-color-primary)] font-medium text-(--gd-color-text)"
            : "border-b-2 border-transparent text-(--gd-color-text-gray) hover:text-(--gd-color-text)",
    ].join(" ");
};
</script>

<style scoped>
/* 基线画在内容盒内侧最后 1px：tab 项的 2px 下划线叠在它之上，
   不依赖负 margin / 位移，任何 overflow 组合下都不会产生滚动条或裁剪 */
.gd-tabs {
    box-shadow: inset 0 -1px 0 var(--gd-color-border);
}
</style>
