<template>
    <div :class="rootClasses" :data-size="resolvedSize">
        <div class="relative flex min-w-0 flex-1 items-center" @mouseenter="hovered = true" @mouseleave="hovered = false">
            <!-- 视觉层：轨道 + 主色填充。
                 轨道按圆点行程内缩左右各 12px（原生 thumb 半径）：原生 range 的可用区间是
                 [12, 宽-12]，圆点中心 = 12 + percent×(宽-24)。若轨道铺满整宽再按 percent 填充，
                 填充终点 percent×宽 只在 50% 处与圆点中心重合，>50% 就会越过圆点（p 时多出
                 12×(2p-1) px）。内缩后填充百分比与圆点行程同基准，终点恒为圆点中心。 -->
            <div class="pointer-events-none absolute top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-[var(--gd-color-field-bg-hover)]"
                :style="{ left: `${thumbLeftPx}px`, right: `${thumbLeftPx}px` }">
                <div class="h-full rounded-full bg-[var(--gd-color-primary)]"
                    :class="dragging ? '' : 'transition-[width] duration-75'"
                    :style="{ width: `${percent * 100}%` }"></div>
            </div>
            <!-- thumb 视觉层：跟随百分比（与 input 命中区按同一公式对齐，首尾不越界）。
                 拖动中不加 transition：每个 input 事件都会重启 75ms 过渡，圆点永远追在指针后面，
                 连续拖动时表现为「不跟手/发粘」；仅在点击轨道/键盘步进时保留过渡。 -->
            <div class="pointer-events-none absolute top-1/2 size-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--gd-color-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.25)] ring-1 ring-[var(--gd-color-border)]"
                :class="dragging ? '' : 'transition-[left] duration-75'"
                :style="{ left: `calc(${thumbLeftPx}px + ${percent * thumbTravelPx}px)` }"></div>
            <!-- tooltip：拖动/悬停时显示 -->
            <div v-if="showTooltip && tooltipShown"
                class="pointer-events-none absolute -top-7 z-(--gd-z-popover) -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--gd-color-border)] bg-[var(--gd-color-surface)] px-1.5 py-0.5 text-[12px] leading-none text-[var(--gd-color-text)] shadow-sm"
                :style="{ left: `calc(${thumbLeftPx}px + ${percent * thumbTravelPx}px)` }">
                {{ tooltipText }}
            </div>
            <!-- 交互层：原生 range，thumb 透明放大占满命中区 -->
            <input ref="rangeRef" type="range" class="relative z-1 h-[24px] w-full cursor-pointer appearance-none bg-transparent
                [&::-webkit-slider-runnable-track]:h-[24px] [&::-webkit-slider-runnable-track]:bg-transparent
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-[24px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent"
                :min="min" :max="max" :step="step" :value="modelValue" :disabled="disabled"
                :aria-valuenow="modelValue" aria-orientation="horizontal"
                @input="handleRangeInput" @change="handleRangeChange"
                @pointerdown="dragging = true" @pointerup="endDrag" @pointercancel="endDrag"
                @focus="tooltipVisible = true" @blur="tooltipVisible = false">
        </div>
        <!-- 宽度用内联样式而非 class：GdInput 壳自带 w-full，
             同元素上 w-full 与 w-[90px] 谁生效取决于 Tailwind 产物顺序，
             这里 w-full 胜出会把数字框撑满整行、反把轨道挤成 0 宽 -->
        <GdInputNumber v-if="showInput" :model-value="modelValue" :min="min" :max="max" :step="step"
            :disabled="disabled" :size="resolvedSize" :controls="false" class="shrink-0" style="width: 90px"
            @update:model-value="handleNumberInput" @change="(v: number | null) => v !== null && emit('change', v)" />
    </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import GdInputNumber from "./GdInputNumber.vue";

defineOptions({ name: "GdSlider" });

const props = withDefaults(defineProps<{
    modelValue?: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    /** 右侧并置数字输入框（联动） */
    showInput?: boolean;
    /** 拖动/悬停时的值提示浮层 */
    showTooltip?: boolean;
    /** 提示文案格式化（如 GdSliderOptional 的「界外 = Auto」） */
    formatTooltip?: (value: number) => string | number;
    size?: "small" | "medium" | "default";
}>(), {
    modelValue: 0,
    min: 0,
    max: 100,
    step: 1,
    showTooltip: true,
    size: "medium",
});

const emit = defineEmits<{
    "update:modelValue": [value: number];
    input: [value: number];
    change: [value: number];
}>();

const rangeRef = ref<HTMLInputElement | null>(null);
const hovered = ref(false);
const dragging = ref(false);
const tooltipVisible = ref(false);
// thumb 视觉层用的像素行程（原生 thumb 宽 24px，视觉 thumb 14px，行程 = 宽 - thumb 宽）
const thumbTravelPx = ref(0);
const thumbLeftPx = 12; // 原生 thumb 半径，视觉 thumb 左缘起点
let resizeObserver: ResizeObserver | null = null;

const percent = computed(() => {
    const span = props.max - props.min;
    if (span <= 0) return 0;
    return (props.modelValue - props.min) / span;
});

const resolvedSize = computed(() => (props.size === "small" ? "small" : "medium"));

const tooltipText = computed((): string | number => {
    const fn = props.formatTooltip ?? ((v: number) => v);
    return fn(props.modelValue);
});

const handleRangeInput = (e: Event): void => {
    const value = Number((e.target as HTMLInputElement).value);
    emit("update:modelValue", value);
    emit("input", value);
};
const handleNumberInput = (value: number | null): void => {
    if (value === null) return;
    emit("update:modelValue", value);
    emit("input", value);
};
const endDrag = (): void => {
    dragging.value = false;
};
// 原生 change 在松手时必定触发（即使指针移出控件），用它兜底结束拖动态，
// 避免 pointerup 丢失后 dragging 卡在 true（会导致视觉层永久失去过渡）
const handleRangeChange = (): void => {
    endDrag();
    emit("change", props.modelValue);
};

// tooltip 显示时机：拖动中、或悬停
const syncTooltip = computed(() => dragging.value || hovered.value);
// Vue 模板里 tooltipVisible 由 focus/blur 控制 + hover/drag 合成：
// 用一个合并态驱动渲染
const tooltipShown = computed(() => tooltipVisible.value || syncTooltip.value);

const rootClasses = computed((): string => [
    // gd-slider 基类是主题插件的稳定定位钩子，配合 data-size 换肤，不要改名
    "gd-slider",
    "flex min-w-0 items-center gap-3",
].join(" "));

onMounted(() => {
    if (rangeRef.value) {
        resizeObserver = new ResizeObserver(() => {
            thumbTravelPx.value = Math.max(0, rangeRef.value!.clientWidth - 24);
        });
        resizeObserver.observe(rangeRef.value);
        thumbTravelPx.value = Math.max(0, rangeRef.value.clientWidth - 24);
    }
});
onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>
