<template>
    <div :class="rootClasses" :data-value="String(modelValue ?? '')" role="radiogroup"
        @keydown="handleKeydown">
        <button v-for="(opt, i) in options" :key="String(opt.value)" type="button" role="radio"
            :aria-checked="modelValue === opt.value" :tabindex="modelValue === opt.value ? 0 : focusedIndex === i ? 0 : -1"
            :disabled="opt.disabled"
            :class="optionClasses(opt)"
            @click="select(opt)">
            <!-- 圆点指示器：主色只出现在这里（胶囊本体保持中性） -->
            <span class="gd-segmented__mark flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150"
                :class="modelValue === opt.value
                    ? 'border-[var(--gd-color-primary)] bg-[var(--gd-color-primary)]'
                    : 'border-[var(--gd-color-border)]'">
                <span v-if="modelValue === opt.value" class="size-1.5 rounded-full bg-white"></span>
            </span>
            <component :is="opt.icon" v-if="opt.icon" class="size-4" />
            <span class="truncate">{{ opt.label }}</span>
        </button>
    </div>
</template>
<script setup lang="ts">
import { computed, ref, type Component } from "vue";

defineOptions({ name: "GdSegmented" });

export interface GdSegmentedOption {
    label: string;
    value: string | number;
    icon?: Component;
    disabled?: boolean;
}

const props = withDefaults(defineProps<{
    modelValue?: string | number;
    options: GdSegmentedOption[];
    disabled?: boolean;
}>(), {
    modelValue: "",
});

const emits = defineEmits<{
    "update:modelValue": [value: string | number];
    change: [value: string | number];
}>();

const focusedIndex = ref(-1);

const selectable = props.options.filter((o) => !o.disabled);

const select = (opt: GdSegmentedOption): void => {
    if (props.disabled || opt.disabled) return;
    if (props.modelValue === opt.value) return;
    emits("update:modelValue", opt.value);
    emits("change", opt.value);
};

/** 左右箭头在可选选项间循环移动 */
const handleKeydown = (e: KeyboardEvent): void => {
    if (!selectable.length) return;
    const idx = selectable.findIndex((o) => o.value === props.modelValue);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % selectable.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + selectable.length) % selectable.length;
    if (next >= 0) {
        e.preventDefault();
        focusedIndex.value = next;
        select(selectable[next]);
    }
};

const rootClasses = computed((): string => [
    // gd-segmented 基类是主题插件的稳定定位钩子，配合 data-value 换肤，不要改名
    "gd-segmented",
    "inline-flex flex-wrap items-center gap-2",
    props.disabled ? "pointer-events-none opacity-60" : "",
].join(" "));

const optionClasses = (opt: GdSegmentedOption): string => {
    const selected = props.modelValue === opt.value;
    return [
        "gd-segmented__option flex h-8 cursor-pointer select-none items-center gap-2 rounded-lg border px-3 text-[13px] leading-none transition-colors duration-150",
        selected
            ? "border-[var(--gd-color-field-focus-border)] bg-[var(--gd-color-field-bg-focus)] font-medium text-(--gd-color-text)"
            : "border-[var(--gd-color-input-border)] bg-[var(--gd-color-input-bg)] text-(--gd-color-text-gray)",
        opt.disabled ? "cursor-not-allowed opacity-50" : "",
    ].filter(Boolean).join(" ");
};
</script>
