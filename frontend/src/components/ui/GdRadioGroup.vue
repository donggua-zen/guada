<template>
    <div :class="rootClasses" role="radiogroup">
        <slot></slot>
    </div>
</template>
<script setup lang="ts">
import { computed, provide } from "vue";
import { gdRadioGroupKey } from "./gdRadioGroupContext";

defineOptions({ name: "GdRadioGroup" });

const props = withDefaults(defineProps<{
    modelValue?: string | number;
    disabled?: boolean;
    /** 竖排（默认）/横排 */
    direction?: "vertical" | "horizontal";
}>(), {
    modelValue: "",
    direction: "vertical",
});

const emits = defineEmits<{
    "update:modelValue": [value: string | number];
    change: [value: string | number];
}>();

const select = (value: string | number): void => {
    if (props.disabled || props.modelValue === value) return;
    emits("update:modelValue", value);
    emits("change", value);
};

provide(gdRadioGroupKey, {
    select,
    has: (v) => props.modelValue === v,
    disabled: () => !!props.disabled,
});

const rootClasses = computed((): string => [
    // gd-radio-group 基类是主题插件的稳定定位钩子，不要改名
    "gd-radio-group",
    props.direction === "horizontal" ? "inline-flex flex-wrap items-center gap-4" : "flex flex-col gap-3",
].join(" "));
</script>
