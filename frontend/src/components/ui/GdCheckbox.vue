<template>
    <label class="gd-checkbox inline-flex shrink-0 cursor-pointer items-start gap-2"
        :class="disabled ? 'cursor-not-allowed opacity-60' : ''" :data-checked="isChecked ? 'true' : 'false'">
        <!-- 原生 checkbox 视觉隐藏（可访问性保留），自绘方块 -->
        <input type="checkbox" class="peer sr-only" :checked="isChecked" :disabled="disabled"
            @change="handleChange" @click.stop>
        <span class="gd-checkbox__box mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150"
            :class="isChecked
                ? 'border-[var(--gd-color-primary)] bg-[var(--gd-color-primary)]'
                : 'border-[var(--gd-color-field-outline-border-hover)] bg-[var(--gd-color-field-outline-bg)]'">
            <svg v-if="isChecked" class="size-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 13 4 4L19 7" />
            </svg>
        </span>
        <!-- label prop 或默认插槽（富文本两行内容） -->
        <span v-if="label || $slots.default" class="gd-checkbox__label min-w-0 text-[13px] leading-[18px] text-(--gd-color-text)">
            <template v-if="label">{{ label }}</template>
            <slot v-else></slot>
        </span>
    </label>
</template>
<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "GdCheckbox" });

const props = withDefaults(defineProps<{
    /** 受控与 v-model 双兼容：:model-value + @change 即 el 的受控写法 */
    modelValue?: boolean;
    disabled?: boolean;
    /** 纯文本 label 快捷；富文本内容用默认插槽 */
    label?: string;
}>(), {
    modelValue: false,
});

const emits = defineEmits<{
    "update:modelValue": [value: boolean];
    change: [value: boolean];
}>();

const isChecked = computed(() => !!props.modelValue);

const handleChange = (e: Event): void => {
    const value = (e.target as HTMLInputElement).checked;
    emits("update:modelValue", value);
    emits("change", value);
};
</script>
