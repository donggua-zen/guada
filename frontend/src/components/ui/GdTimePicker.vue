<template>
    <!-- 触发器：与 GdSelect/GdInput 同一视觉壳（filled 灰底无边框） -->
    <!-- v-bind="$attrs"：fragment 根（触发器 + Teleport 面板）不会自动继承外部 class/style，
         缺这一句消费方的 class="sched-time"（宽度/胶囊圆角）会被静默丢弃 -->
    <div ref="triggerRef" v-bind="$attrs" :class="triggerClasses" :data-open="show" data-variant="filled" :data-size="resolvedSize"
        role="combobox" :aria-expanded="show" aria-haspopup="listbox" tabindex="0"
        @click="togglePanel" @keydown="handleTriggerKeydown" @mouseenter="hovered = true" @mouseleave="hovered = false">
        <Clock16Regular class="shrink-0 text-[var(--gd-color-field-text-placeholder)]" :class="sizeSpec.icon" />
        <span class="min-w-0 flex-1 truncate text-[14px] leading-none"
            :class="hasValue ? 'text-[var(--gd-color-field-text)]' : 'text-[var(--gd-color-field-text-placeholder)]'">
            {{ modelValue || placeholder || '' }}
        </span>
        <svg class="shrink-0 text-[var(--gd-color-field-text-placeholder)] transition-transform duration-200"
            :class="[sizeSpec.icon, show ? 'rotate-180' : '']" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
        </svg>
    </div>

    <!-- 时/分两列滚轮：中央选中带横跨两列，选中值恒在同一行（滚动即选中）
         GdPopover 承担定位/翻转/点击外部关闭/Esc -->
    <GdPopover v-model:show="show" :anchor-el="triggerRef" :width="220" :max-height="248" align="start"
        popper-class="gd-time-picker__panel">
        <div class="gd-time-picker__spinner">
            <!-- 中央选中带：上下分隔线标出当前行，两列共用 -->
            <span class="gd-time-picker__band" aria-hidden="true"></span>
            <div ref="hourColEl" class="gd-time-picker__col" role="listbox" :aria-label="t('common.hour')"
                @scroll.passive="handleScroll('hour')">
                <button v-for="h in HOUR_RANGE" :key="h" type="button" role="option"
                    :aria-selected="hour === h"
                    class="gd-time-picker__row" :class="{ 'is-selected': hour === h }"
                    @click="pick('hour', h)">
                    {{ pad2(h) }}
                </button>
            </div>
            <div ref="minuteColEl" class="gd-time-picker__col" role="listbox" :aria-label="t('common.minute')"
                @scroll.passive="handleScroll('minute')">
                <button v-for="m in MINUTE_RANGE" :key="m" type="button" role="option"
                    :aria-selected="minute === m"
                    class="gd-time-picker__row" :class="{ 'is-selected': minute === m }"
                    @click="pick('minute', m)">
                    {{ pad2(m) }}
                </button>
            </div>
        </div>
    </GdPopover>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import GdPopover from "./GdPopover.vue";
import { Clock16Regular } from "@vicons/fluent";
import { combineTime, HOUR_RANGE, MINUTE_RANGE, pad2 } from "./gdDateTime";

defineOptions({ name: "GdTimePicker", inheritAttrs: false });

/**
 * 时:分选择（替代 el-time-picker format="HH:mm"）。
 * 模型 = "HH:mm" 字符串；点行立即 emit，面板由点外关闭。
 */

const props = withDefaults(defineProps<{
    modelValue: string;
    placeholder?: string;
    size?: "small" | "default";
    /** 圆角形态：rounded 矩形圆角（默认，与 GdInput 一致）；pill 全圆角胶囊 */
    shape?: "rounded" | "pill";
}>(), {
    modelValue: "",
    placeholder: "",
    size: "default",
    shape: "rounded",
});

const emit = defineEmits<{
    "update:modelValue": [value: string];
}>();

const { t } = useI18n();

const show = ref(false);
const hovered = ref(false);
const triggerRef = ref<HTMLElement | null>(null);

const hour = computed(() => {
    const match = props.modelValue.match(/^(\d{1,2}):/);
    return match ? Math.min(23, Math.max(0, Number(match[1]))) : -1;
});
const minute = computed(() => {
    const match = props.modelValue.match(/:(\d{1,2})$/);
    return match ? Math.min(59, Math.max(0, Number(match[1]))) : -1;
});
const hasValue = computed(() => !!props.modelValue);

// ==================== 滚轮定位（中央选中带） ====================
/** 行高必须与样式一致：列上下各留 (224-28)/2 = 98px 空白后，
    scrollTop = 值 × ROW_H 时该行正好落在视口中央（= 中央选中带） */
const ROW_H = 28;

const hourColEl = ref<HTMLElement | null>(null);
const minuteColEl = ref<HTMLElement | null>(null);

function scrollColTo(el: HTMLElement | null, value: number) {
    if (!el || value < 0) return;
    el.scrollTop = value * ROW_H;
}

watch(show, async (val) => {
    if (!val) return;
    await nextTick();
    scrollColTo(hourColEl.value, hour.value);
    scrollColTo(minuteColEl.value, minute.value);
});

/**
 * 滚动停止后取最近一行作为选中值，并把列吸附到该行。
 * 吸附不靠「屏蔽标志」而是靠幂等判断：scrollTop 已落在整格上就不再改动，
 * 因此程序化赋值与吸附各自触发的 scroll 事件只会算出同一个值、不会互相打架。
 *
 * 防抖 90ms：连续滚动时不断重置，只有真正停下才落位。
 * 不用 CSS scroll-snap——mandatory 在吸附动画期间会锁住滚动输入，
 * 快速连滚会表现为「卡住滚不动，停一下又能滚」。
 */
let scrollTimer: number | null = null;
function handleScroll(part: "hour" | "minute") {
    if (scrollTimer !== null) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
        scrollTimer = null;
        const el = part === "hour" ? hourColEl.value : minuteColEl.value;
        if (!el) return;
        const max = part === "hour" ? 23 : 59;
        const value = Math.min(max, Math.max(0, Math.round(el.scrollTop / ROW_H)));
        // 自由滚动可能停在半行：拉回最近格线，保证任何时候都恰好对齐中央带
        // （容差 0.5px 兜住小数像素比，避免反复赋值）
        if (Math.abs(el.scrollTop - value * ROW_H) > 0.5) {
            el.scrollTop = value * ROW_H;
        }
        const h = part === "hour" ? value : Math.max(0, hour.value);
        const m = part === "minute" ? value : Math.max(0, minute.value);
        const next = combineTime(h, m);
        if (next !== props.modelValue) emit("update:modelValue", next);
    }, 90);
}

// ==================== 选择 ====================
function pick(part: "hour" | "minute", value: number) {
    const h = part === "hour" ? value : Math.max(0, hour.value);
    const m = part === "minute" ? value : Math.max(0, minute.value);
    emit("update:modelValue", combineTime(h, m));
    // 点中的行归位到中央带（瞬时对齐，与滚动吸附落到同一格线）
    scrollColTo(part === "hour" ? hourColEl.value : minuteColEl.value, value);
}

function togglePanel() {
    show.value = !show.value;
}

function handleTriggerKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        togglePanel();
    }
}

// ==================== 样式（触发器壳与 GdSelect 同一 token 套路） ====================
const sizeMap = {
    // small 与 GdSelect/GdInput 的 small 档保持一致（同排摆放时高度对齐，都是 28px）
    small: { height: "h-[28px]", paddingX: "px-2", icon: "size-3.5" },
    default: { height: "h-[32px]", paddingX: "px-2.5", icon: "size-4" },
} as const;
const sizeSpec = computed(() => sizeMap[props.size] ?? sizeMap.default);
const resolvedSize = computed(() => props.size);

const triggerClasses = computed((): string => {
    const s = sizeSpec.value;
    return [
        // gd-time-picker 基类是主题插件的稳定定位钩子，配合 data-open / data-size 换肤，不要改名
        "gd-time-picker",
        "group relative flex w-full min-w-0 cursor-pointer box-border items-center border leading-none",
        // 圆角形态：默认矩形圆角（与 GdInput 表单控件一致），pill = 全圆角胶囊
        props.shape === "pill" ? "rounded-full" : "rounded-md",
        "transition-colors duration-200",
        s.height,
        s.paddingX,
        "gap-1.5",
        // filled 变体；打开态用 data-open 替换 GdSelect 的 focus-within 套路
        "bg-[var(--gd-color-field-bg)] border-transparent",
        "md:hover:bg-[var(--gd-color-field-bg-hover)]",
        show.value ? "bg-[var(--gd-color-field-bg-focus)] border-[var(--gd-color-field-focus-border)]" : "",
    ].filter(Boolean).join(" ");
});
</script>

<style scoped>
/* 行高必须与脚本里的 ROW_H 常量一致（28px）：
   配合列的 98px 上下留白，scrollTop = 值 × ROW_H 时该行正好落在中央选中带 */
.gd-time-picker__spinner {
    position: relative;
    display: flex;
    gap: 2px;
    padding: 4px;
}

/* 中央选中带：上下两条发丝线横跨两列，标出「当前行」。
   位置 = 列容器上内边距(4px) + 列视口居中偏移 (224-28)/2 = 102px；
   两列各自把选中值滚到这条带里，选中值因此永远在同一行 */
.gd-time-picker__band {
    position: absolute;
    left: 4px;
    right: 4px;
    top: 102px;
    height: 28px;
    border-top: 1px solid var(--gd-color-border);
    border-bottom: 1px solid var(--gd-color-border);
    pointer-events: none;
    z-index: 0;
}

/* 滚动对齐由脚本在滚动停止后整格吸附（见 handleScroll），
   不用 CSS scroll-snap：mandatory 在吸附动画期间会锁住滚动输入，
   快速连滚时表现为「卡住滚不动，停一下又能滚」 */
.gd-time-picker__col {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    /* 两列均分面板宽度：缺 flex 时列宽会收缩到内容宽（实测 29px），
       数字挤在左侧一小条里、滚动条压住数字 */
    flex: 1 1 0;
    min-width: 0;
    height: 224px;
    overflow-y: auto;
    scrollbar-width: thin;
}

/* 上下留白 = (列高 - 行高) / 2，作为真实的可滚动内容而非 padding：
   有它首/尾项也能滚到正中；且 scrollTop = 值 × 行高 时该行恰好居中
   （98px 留白正好抵消居中偏移，不留冗余计算） */
.gd-time-picker__col::before,
.gd-time-picker__col::after {
    content: "";
    flex: 0 0 98px;
}

.gd-time-picker__row {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 28px;
    flex-shrink: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--gd-color-text);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: color 0.15s ease;
    padding: 0;
}

.gd-time-picker__row:hover {
    background: var(--gd-color-field-bg-hover);
}

/* 选中项只用加粗区分（中央带已经标出位置，再叠一层主色实底显得吵） */
.gd-time-picker__row.is-selected {
    color: var(--gd-color-text);
    font-weight: 600;
}
</style>
