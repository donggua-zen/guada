<template>
    <div class="gd-checkbox-group inline-flex flex-wrap items-center gap-2" role="group">
        <slot></slot>
    </div>
</template>
<script setup lang="ts">
import { provide } from "vue";
import { gdCheckboxGroupKey } from "./gdCheckboxGroupContext";

defineOptions({ name: "GdCheckboxGroup" });

const props = withDefaults(defineProps<{
    /** 数组 v-model：组内 GdCheckbox（或 Option 消费方）按 value 判定选中 */
    modelValue?: Array<string | number>;
    disabled?: boolean;
}>(), {
    modelValue: () => [],
});

const emits = defineEmits<{
    "update:modelValue": [value: Array<string | number>];
}>();

const has = (value: string | number): boolean => (props.modelValue ?? []).includes(value);
const toggle = (value: string | number): void => {
    const next = has(value)
        ? (props.modelValue ?? []).filter((v) => v !== value)
        : [...(props.modelValue ?? []), value];
    emits("update:modelValue", next);
};

provide(gdCheckboxGroupKey, {
    register: () => () => { /* 注册表无需维护（value 驱动） */ },
    toggle,
    has,
});

</script>
