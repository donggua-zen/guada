<template>
    <button type="button" role="switch" :aria-checked="isChecked" :disabled="isDisabled" :aria-busy="loading || undefined"
        :class="switchClasses" :data-size="resolvedSize" @click="toggle">
        <span v-if="labelContent" class="gd-switch__label block leading-none select-none" :class="labelTextClass">
            {{ labelContent }}
        </span>
        <!-- 滑块常驻（loading 时也不卸载）：否则 loading 切换会销毁/重建滑块，
             translate 过渡永远没有起点，表现为"开关没有动画"（plugins 列表的异步开关） -->
        <span class="gd-switch__thumb flex items-center justify-center rounded-full bg-[var(--gd-switch-thumb)] shadow-sm transition-[translate] duration-[var(--gd-motion-duration-base)] ease-[var(--gd-motion-ease-spring)]"
            :class="[sizeSpec.thumb, thumbClass]"></span>
        <!-- spinner 叠在轨道上，不参与布局 -->
        <span v-if="loading" class="gd-switch__spinner absolute inset-0 flex items-center justify-center leading-none pointer-events-none">
            <svg class="animate-spin" :class="spinnerClass" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            </svg>
        </span>
    </button>
</template>
<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "GdSwitch" });

const props = withDefaults(defineProps<{
    modelValue?: boolean | string | number;
    /** 值语义（对齐 el-switch）：勾选/未勾选对应的实际值，默认 boolean */
    activeValue?: boolean | string | number;
    inactiveValue?: boolean | string | number;
    disabled?: boolean;
    loading?: boolean;
    size?: "small" | "medium" | "default" | "large";
    /** 文案模式：inline-prompt 把 active-text/inactive-text 显示在轨道内 */
    inlinePrompt?: boolean;
    activeText?: string;
    inactiveText?: string;
    /** 非 inline 模式：文案显示在开关外侧（el 的 active-text 在右、inactive-text 在左） */
    showText?: boolean;
    /** 错误态描边 */
    error?: boolean;
}>(), {
    modelValue: false,
    size: "medium",
    // 必须显式给默认值：activeValue 类型以 Boolean 开头，Vue 的 Boolean casting 会把
    // 未传的 prop 填成 false（而非 undefined），`?? true` 永远兜不到，导致选中态判断反相
    activeValue: true,
    inactiveValue: false,
});

const emits = defineEmits<{
    "update:modelValue": [value: boolean | string | number];
    change: [value: boolean | string | number];
}>();

const activeVal = computed(() => props.activeValue);
const inactiveVal = computed(() => props.inactiveValue);
const isChecked = computed(() => props.modelValue === activeVal.value);

const isDisabled = computed(() => props.disabled || props.loading);

const toggle = (): void => {
    if (isDisabled.value) return;
    const next = isChecked.value ? inactiveVal.value : activeVal.value;
    emits("update:modelValue", next);
    emits("change", next);
};

const labelContent = computed((): string => {
    if (!props.inlinePrompt) return "";
    return isChecked.value ? (props.activeText ?? "") : (props.inactiveText ?? "");
});

// ==================== 尺寸（el 现状：medium 40×20 滑块 16，small 28×16 滑块 12；
// 全偶数、位移整数，无亚像素） ====================
interface SwitchSize {
    track: string;
    thumb: string;
    /** 滑块位移 = 轨道宽 - 滑块宽 - 2×1px 内边距 */
    shift: string;
    spinner: string;
    /** inline-prompt 开启时轨道加宽容纳文案 */
    trackWithText: string;
    shiftWithText: string;
    labelText: string;
}
const sizeMap: Record<string, SwitchSize> = {
    small: {
        track: "w-[28px] h-[16px] p-[2px]",
        thumb: "w-3 h-3",
        shift: "translate-x-[12px]",
        spinner: "w-2.5 h-2.5",
        trackWithText: "w-[44px]",
        shiftWithText: "translate-x-[28px]",
        labelText: "text-[11px]",
    },
    medium: {
        track: "w-[40px] h-[20px] p-[2px]",
        thumb: "w-4 h-4",
        shift: "translate-x-[20px]",
        spinner: "w-3 h-3",
        trackWithText: "w-[56px]",
        shiftWithText: "translate-x-[36px]",
        labelText: "text-[11px]",
    },
};
const resolveSize = (): SwitchSize => {
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key === "default" ? "medium" : key] || sizeMap.medium;
};
const resolvedSize = computed((): string => {
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key] && key !== "default" ? key : "medium";
});
const sizeSpec = computed(() => resolveSize());

const hasText = computed(() => props.inlinePrompt && !!(props.activeText || props.inactiveText));

const switchClasses = computed((): string => {
    const s = sizeSpec.value;
    const classes: string[] = [
        // gd-switch 基类是主题插件的稳定定位钩子，配合 data-size 换肤，不要改名
        "gd-switch",
        "group relative inline-flex shrink-0 items-center justify-between",
        "rounded-full border-0 cursor-pointer p-[2px]",
        "transition-colors duration-200",
        "focus:outline-none",
        "disabled:cursor-not-allowed",
        hasText.value ? s.trackWithText : s.track,
    ];
    if (props.disabled) {
        classes.push("opacity-60", isChecked.value ? "bg-[var(--gd-color-primary)]" : "bg-[var(--gd-switch-track-off)]");
    } else {
        classes.push(
            isChecked.value ? "bg-[var(--gd-color-primary)]" : "bg-[var(--gd-switch-track-off)]",
        );
    }
    return classes.join(" ");
});

const thumbClass = computed((): string => {
    const s = sizeSpec.value;
    const classes: string[] = [];
    classes.push(isChecked.value ? s.shift : "translate-x-0");
    return classes.join(" ");
});

const spinnerClass = computed((): string => sizeSpec.value.spinner);
const labelTextClass = computed((): string => [
    sizeSpec.value.labelText,
    "absolute",
    isChecked.value ? "left-2" : "right-2",
].join(" "));
</script>
