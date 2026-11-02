<template>
    <div :class="fieldClasses" :data-error="!!error || undefined">
        <!-- label：纵排在上 / left 布局在左固定宽 -->
        <label v-if="label" class="gd-form-field__label block shrink-0 text-[13px] leading-[18px] text-(--gd-color-text)"
            :class="labelWidth ? 'pt-1.5 text-right' : ''" :style="labelWidth ? { width: labelWidth } : undefined">
            <span v-if="required && !hideRequiredAsterisk" class="mr-0.5 text-[var(--gd-color-danger)]">*</span>{{ label }}
        </label>
        <div class="min-w-0 flex-1">
            <slot></slot>
            <!-- 行内错误红字（对齐 el-form-item__error 语义） -->
            <p v-if="error" class="gd-form-field__error m-0 mt-1 text-[12px] leading-none text-[var(--gd-color-danger)]"
                role="alert">
                {{ error }}
            </p>
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "GdFormField" });

const props = withDefaults(defineProps<{
    label?: string;
    /** 必填星号（纯视觉；校验由 useFormValidation 接线） */
    required?: boolean;
    /** 行内错误文案；有值时显示红字（控件 error 态由调用方手动接 :error） */
    error?: string;
    /** 传入时 label 左置固定宽右对齐（对齐 el label-position="left" + label-width）；
     *  不传 = 纵排 label 在上 */
    labelWidth?: string;
    hideRequiredAsterisk?: boolean;
}>(), {
    required: false,
    hideRequiredAsterisk: false,
});

const fieldClasses = computed((): string => [
    // gd-form-field 基类是主题插件的稳定定位钩子，配合 data-error 换肤，不要改名
    "gd-form-field",
    props.labelWidth ? "flex items-start gap-3" : "flex flex-col gap-1.5",
].join(" "));
</script>
