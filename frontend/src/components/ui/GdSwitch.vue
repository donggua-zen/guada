<template>
    <button type="button" role="switch" :aria-checked="isChecked" :disabled="isDisabled" :aria-busy="loading || undefined"
        :class="switchClasses" :data-size="resolvedSize" @click="toggle">
        <!-- 文案在流内（不再 absolute）：轨道宽度由文案撑开，三字文案也不会被滑块压住。
             留白随滑块位置翻转（滑块占哪侧、哪侧留避让位），总宽恒定 -->
        <span v-if="labelContent" class="gd-switch__label block leading-none select-none whitespace-nowrap"
            :class="labelTextClass">
            {{ labelContent }}
        </span>
        <!-- 滑块常驻（loading 时也不卸载）：否则 loading 切换会销毁/重建滑块，
             过渡永远没有起点，表现为"开关没有动画"（plugins 列表的异步开关）。
             用 left 而非 translate 定位：文案模式下轨道宽度是内容驱动的，
             百分比位移无法用 translate 表达（translate 的 100% 指滑块自身宽度） -->
        <span class="gd-switch__thumb absolute top-[2px] flex items-center justify-center rounded-full bg-[var(--gd-switch-thumb)] shadow-sm transition-[left] duration-[var(--gd-motion-duration-base)] ease-[var(--gd-motion-ease-spring)]"
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

// ==================== 尺寸 ====================
interface SwitchSize {
    /** 无文案：固定宽高轨道（el 现状：medium 40×20 / small 28×16） */
    track: string;
    thumb: string;
    spinner: string;
    /** 文案模式：只定高度，宽度由文案撑开（三字「已启用」也放得下）；
        保留 min-w 兜底——只配了一侧文案时，另一侧空文案不会把轨道压扁 */
    trackWithText: string;
    /** 选中态滑块左偏移：贴右缘 = 100% - 滑块宽 - 2×内边距 */
    thumbOn: string;
    /** 文案留白随滑块位置翻转：滑块占哪侧，哪侧留足避让位，另一侧只留呼吸缝。
        两侧总和恒定（切换时不改变总宽，只换文字停靠边），因此开态左侧不再空出一截 */
    labelTextOn: string;
    labelTextOff: string;
}
const sizeMap: Record<string, SwitchSize> = {
    small: {
        track: "w-[28px] h-[16px]",
        thumb: "w-3 h-3",
        spinner: "w-2.5 h-2.5",
        trackWithText: "h-[16px] min-w-[28px]",
        // Tailwind 任意值里的空格用下划线转义：calc 的减号两侧必须有空格才是合法 CSS
        thumbOn: "left-[calc(100%_-_14px)]",
        // 滑块 12px + 2px 内边距 = 14：开态右侧留 14 避让、左侧留 6 呼吸；关态镜像
        labelTextOn: "text-[11px] pl-[6px] pr-[14px]",
        labelTextOff: "text-[11px] pl-[14px] pr-[6px]",
    },
    medium: {
        track: "w-[40px] h-[20px]",
        thumb: "w-4 h-4",
        spinner: "w-3 h-3",
        trackWithText: "h-[20px] min-w-[40px]",
        thumbOn: "left-[calc(100%_-_18px)]",
        // 滑块 16px + 2px 内边距 = 18：同上，两侧总和恒定 26px
        labelTextOn: "text-[11px] pl-[8px] pr-[18px]",
        labelTextOff: "text-[11px] pl-[18px] pr-[8px]",
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
        "group relative inline-flex shrink-0 items-center",
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
    // 左偏移定位（不是 translate）：文案模式轨道宽度随内容变化，
    // 只有 100% 百分比才能把滑块贴到右缘；未选中贴左缘 2px（= 轨道内边距）
    return isChecked.value ? s.thumbOn : "left-[2px]";
});

const spinnerClass = computed((): string => sizeSpec.value.spinner);
/* 文案留白随滑块位置翻转：滑块在右（开）时左侧只留呼吸缝、右侧留避让位，
   关态镜像。两侧总和恒定，切换时不改变总宽，开态左侧不再空出一截。
   选中态文字反白，避免深色字压在主题色上 */
const labelTextClass = computed((): string => [
    isChecked.value ? sizeSpec.value.labelTextOn : sizeSpec.value.labelTextOff,
    "block leading-none",
    isChecked.value ? "text-[var(--gd-color-primary-text)]" : "text-[var(--gd-color-text)]",
].join(" "));
</script>
