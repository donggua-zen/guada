<template>
    <label class="gd-radio flex cursor-pointer items-start gap-2"
        :class="isDisabled ? 'cursor-not-allowed opacity-60' : ''" role="radio"
        :aria-checked="isChecked ? 'true' : 'false'" :data-checked="isChecked ? 'true' : 'false'">
        <input type="radio" class="sr-only" :name="radioName" :checked="isChecked" :disabled="isDisabled"
            @change="handleChange">
        <!-- 圆点：checked 主色实心白点 -->
        <span class="gd-radio__mark mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150"
            :class="isChecked
                ? 'border-[var(--gd-color-primary)] bg-[var(--gd-color-primary)]'
                : 'border-[var(--gd-color-field-outline-border-hover)]'">
            <span v-if="isChecked" class="size-1.5 rounded-full bg-white"></span>
        </span>
        <!-- 富文本插槽（标题+描述两行）或纯文本 value -->
        <span v-if="$slots.default || label" class="gd-radio__label min-w-0 text-[13px] leading-[18px] text-(--gd-color-text)">
            <template v-if="label">{{ label }}</template>
            <slot v-else></slot>
        </span>
    </label>
</template>
<script setup lang="ts">
import { computed, inject } from "vue";
import { gdRadioGroupKey } from "./gdRadioGroupContext";

defineOptions({ name: "GdRadio" });

const props = withDefaults(defineProps<{
    value: string | number;
    label?: string;
    disabled?: boolean;
}>(), {});

const ctx = inject(gdRadioGroupKey, null);
// 无 Group 包裹时退化为独立 radio（name 隔离）
const radioName = `gd-radio-${Math.random().toString(36).slice(2, 8)}`;

const isChecked = computed(() => (ctx ? ctx.has(props.value) : false));
const isDisabled = computed(() => props.disabled || (ctx?.disabled() ?? false));

const handleChange = (): void => {
    if (isDisabled.value) return;
    if (ctx) ctx.select(props.value);
};
</script>
