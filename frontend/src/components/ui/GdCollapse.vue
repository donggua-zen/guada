<template>
    <div :class="rootClasses" :data-open="isOpen ? 'true' : 'false'">
        <!-- 标题行：#title 插槽（文字/标签自由组合）+ 展开箭头 -->
        <button type="button" class="gd-collapse__header flex w-full cursor-pointer select-none items-center justify-between gap-2 border-0 bg-transparent px-3.5 py-3 text-left text-[14px] text-(--gd-color-text)"
            :aria-expanded="isOpen ? 'true' : 'false'" @click="toggle">
            <span class="min-w-0 flex items-center gap-2"><slot name="title">{{ title }}</slot></span>
            <svg class="gd-collapse__chevron size-4 shrink-0 text-(--gd-color-text-gray) transition-transform duration-[var(--gd-motion-duration-base)] ease-[var(--gd-motion-ease-out)]"
                :class="{ 'rotate-180': isOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
        <!-- 内容区：grid-rows 0fr/1fr 纯 CSS 展开动画（无需 JS 测高） -->
        <div class="gd-collapse__content grid transition-[grid-template-rows] duration-[var(--gd-motion-duration-base)] ease-[var(--gd-motion-ease-out)]"
            :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }">
            <div class="overflow-hidden">
                <div class="px-3.5 pb-3.5" :class="{ 'pt-1': isOpen }">
                    <slot></slot>
                </div>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "GdCollapse" });

const props = withDefaults(defineProps<{
    /** 展开的 name 数组（对齐 el-collapse 的数组 v-model；本组件为单项形态，数组里含 name 即展开） */
    modelValue?: string[];
    name: string;
    title?: string;
}>(), {
    modelValue: () => [],
});

const emits = defineEmits<{
    "update:modelValue": [value: string[]];
    change: [names: string[]];
}>();

const isOpen = computed(() => (props.modelValue ?? []).includes(props.name));

const toggle = (): void => {
    const next = isOpen.value
        ? (props.modelValue ?? []).filter((n) => n !== props.name)
        : [...(props.modelValue ?? []), props.name];
    emits("update:modelValue", next);
    emits("change", next);
};

const rootClasses = computed((): string => [
    // gd-collapse 基类是主题插件的稳定定位钩子，配合 data-open 换肤，不要改名
    "gd-collapse",
    "rounded-lg border border-(--gd-color-border)",
].join(" "));
</script>
