<template>
    <!-- items-center：方块与 label 视觉中线对齐。
         之前用 items-start + mt-0.5（为两行富文本「标题+描述」准备），
         单行文字场景下方块会明显偏上 -->
    <label class="gd-checkbox inline-flex shrink-0 cursor-pointer items-center gap-2"
        :class="disabled ? 'cursor-not-allowed opacity-60' : ''" :data-checked="isChecked ? 'true' : 'false'">
        <!-- 原生 checkbox 视觉隐藏（可访问性保留），自绘方块 -->
        <input type="checkbox" class="peer sr-only" :checked="isChecked" :disabled="disabled"
            @change="handleChange" @click.stop>
        <span class="gd-checkbox__box flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150"
            :class="isChecked
                ? 'border-[var(--gd-color-primary)] bg-[var(--gd-color-primary)]'
                : 'border-[var(--gd-color-field-outline-border-hover)] bg-[var(--gd-color-field-outline-bg)]'">
            <svg v-if="isChecked" class="size-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 13 4 4L19 7" />
            </svg>
        </span>
        <!-- label prop 或默认插槽（富文本可多行）。min-h 与方块等高：
             两行内容时方块居中于整体，单行时也与文字中线对齐 -->
        <span v-if="label || $slots.default" class="gd-checkbox__label min-w-0 text-[13px] leading-[18px] text-(--gd-color-text)">
            <template v-if="label">{{ label }}</template>
            <slot v-else></slot>
        </span>
    </label>
</template>
<script setup lang="ts">
import { computed, inject } from "vue";
import { gdCheckboxGroupKey } from "./gdCheckboxGroupContext";

defineOptions({ name: "GdCheckbox" });

const props = withDefaults(defineProps<{
    /** 受控与 v-model 双兼容：:model-value + @change 即 el 的受控写法 */
    modelValue?: boolean;
    disabled?: boolean;
    /** 纯文本 label 快捷；富文本内容用默认插槽 */
    label?: string;
    /**
     * 组内取值（GdCheckboxGroup 的数组语义）：传了 value 且身处 Group 内时，
     * 选中态由组的 has(value) 决定，点击走组的 toggle(value)，无需外部写 @change。
     * 不传 value 时仍是普通单选框（受控 / v-model 两种写法）。
     */
    value?: string | number;
}>(), {
    modelValue: false,
    value: undefined,
});

const emits = defineEmits<{
    "update:modelValue": [value: boolean];
    change: [value: boolean];
}>();

const group = inject(gdCheckboxGroupKey, null);
// 组语义只在「传了 value + 在 Group 内」时启用，其余场景保持原有受控行为
const inGroup = computed(() => !!group && props.value !== undefined);

const isChecked = computed(() =>
    inGroup.value ? !!group!.has(props.value as string | number) : !!props.modelValue,
);

const handleChange = (e: Event): void => {
    const value = (e.target as HTMLInputElement).checked;
    if (inGroup.value) {
        // 组内：值由父级数组驱动，勾选方向以组状态为准（避免受控值不同步时方向反转）
        group!.toggle(props.value as string | number);
        emits("change", value);
        return;
    }
    emits("update:modelValue", value);
    emits("change", value);
};
</script>
