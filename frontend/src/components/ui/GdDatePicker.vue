<template>
    <!-- 触发器：与 GdSelect/GdInput 同一视觉壳（filled 灰底无边框），胶囊圆角由消费方按需覆盖 -->
    <!-- v-bind="$attrs"：fragment 根（触发器 + Teleport 面板）不会自动继承外部 class/style，
         缺这一句消费方的 class="sched-date" / "setting-control wide" 会被静默丢弃 -->
    <div ref="triggerRef" v-bind="$attrs" :class="triggerClasses" :data-open="show" data-variant="filled" :data-size="resolvedSize"
        role="combobox" :aria-expanded="show" aria-haspopup="dialog" tabindex="0"
        @click="togglePanel" @keydown="handleTriggerKeydown" @mouseenter="hovered = true" @mouseleave="hovered = false">
        <CalendarLtr16Regular class="shrink-0 text-[var(--gd-color-field-text-placeholder)]" :class="sizeSpec.icon" />
        <span class="min-w-0 flex-1 truncate text-[14px] leading-none"
            :class="hasValue ? 'text-[var(--gd-color-field-text)]' : 'text-[var(--gd-color-field-text-placeholder)]'">
            {{ displayText || placeholder || '' }}
        </span>
        <span v-if="clearable && hasValue && hovered" class="ml-1.5 flex shrink-0 items-center">
            <button type="button" :tabindex="-1" aria-label="清空"
                class="flex size-4 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 md:hover:text-[var(--gd-color-field-text)]"
                @click.stop="handleClear">
                <svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
            </button>
        </span>
    </div>

    <!-- 日历面板：GdPopover 承担定位/翻转/点击外部关闭/Esc -->
    <GdPopover v-model:show="show" :anchor-el="triggerRef" :width="300" align="start" popper-class="gd-date-picker__panel">
        <div class="gd-date-picker__panel-inner flex flex-col gap-1.5 p-1">
            <!-- 头部：上/下月 + 当前月 -->
            <div class="flex items-center justify-between px-1">
                <button type="button" class="gd-date-picker__nav" :aria-label="t('common.prevMonth')" @click="viewShift(-1)">
                    <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 3 5 8l5 5" />
                    </svg>
                </button>
                <span class="text-[13px] font-medium leading-none text-[var(--gd-color-text)]">{{ monthLabel }}</span>
                <button type="button" class="gd-date-picker__nav" :aria-label="t('common.nextMonth')" @click="viewShift(1)">
                    <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m6 3 5 5-5 5" />
                    </svg>
                </button>
            </div>
            <!-- 星期行（周日起始） -->
            <div class="grid grid-cols-7 gap-1 px-0.5">
                <span v-for="wd in weekdayLabels" :key="wd.key"
                    class="flex h-6 items-center justify-center text-[11px] leading-none text-[var(--gd-color-text-gray)]">
                    {{ wd.label }}
                </span>
            </div>
            <!-- 日格 -->
            <div class="grid grid-cols-7 gap-1 px-0.5">
                <button v-for="(cell, i) in monthCells" :key="i" type="button"
                    class="gd-date-picker__cell"
                    :class="{
                        'gd-date-picker__cell--outside': !cell.inMonth,
                        'gd-date-picker__cell--today': !selectedDate && sameDay(cell.date, today),
                        'gd-date-picker__cell--selected': selectedDate && sameDay(cell.date, selectedDate),
                    }"
                    :aria-selected="!!(selectedDate && sameDay(cell.date, selectedDate))"
                    @click="pickDay(cell.date)">
                    {{ cell.date.getDate() }}
                </button>
            </div>
            <!-- 底部时间行：时/分/秒 + 此刻 + 清除 -->
            <div class="flex items-center gap-1.5 border-t border-[var(--gd-color-border)] px-1 pb-0.5 pt-2">
                <GdInput v-model="hourText" type="number" size="tiny" class="w-11" :min="0" :max="23" @change="emitFromInputs" />
                <span class="text-[12px] text-[var(--gd-color-text-gray)]">:</span>
                <GdInput v-model="minuteText" type="number" size="tiny" class="w-11" :min="0" :max="59" @change="emitFromInputs" />
                <span class="text-[12px] text-[var(--gd-color-text-gray)]">:</span>
                <GdInput v-model="secondText" type="number" size="tiny" class="w-11" :min="0" :max="59" @change="emitFromInputs" />
                <span class="flex-1" />
                <button type="button" class="gd-date-picker__action" @click="pickNow">{{ t('common.now') }}</button>
                <button v-if="clearable" type="button" class="gd-date-picker__action" @click="handleClear">{{ t('common.clear') }}</button>
            </div>
        </div>
    </GdPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import GdPopover from "./GdPopover.vue";
import GdInput from "./GdInput.vue";
import { CalendarLtr16Regular } from "@vicons/fluent";
import { t } from "@/locales";
import {
    buildMonthCells,
    combineDateTime,
    sameDay,
    splitDateTime,
    toLocalDateTimeString,
    type DateTimeParts,
} from "./gdDateTime";

defineOptions({ name: "GdDatePicker", inheritAttrs: false });

/**
 * 日期时间选择（替代 el-date-picker type="datetime"）。
 * 模型 = "YYYY-MM-DD HH:mm:ss" 字符串；点日格/改时间立即 emit，面板由点外关闭。
 */

const props = withDefaults(defineProps<{
    modelValue: string;
    clearable?: boolean;
    placeholder?: string;
    size?: "small" | "default";
    /** 圆角形态：rounded 矩形圆角（默认，与 GdInput 一致）；pill 全圆角胶囊 */
    shape?: "rounded" | "pill";
}>(), {
    modelValue: "",
    clearable: false,
    placeholder: "",
    size: "default",
    shape: "rounded",
});

const emit = defineEmits<{
    "update:modelValue": [value: string];
}>();

const { locale } = useI18n();

const show = ref(false);
const hovered = ref(false);
const triggerRef = ref<HTMLElement | null>(null);

// ==================== 模型拆解 ====================
const parts = computed<DateTimeParts>(() => splitDateTime(props.modelValue));
const hasValue = computed(() => !!props.modelValue);
const selectedDate = computed<Date | null>(() => (props.modelValue
    ? new Date(parts.value.y, parts.value.m - 1, parts.value.d)
    : null));

// ==================== 视图月状态（打开时对齐选中值） ====================
const viewYear = ref(parts.value.y);
const viewMonth = ref(parts.value.m); // 1-12

watch(show, (val) => {
    if (!val) return;
    viewYear.value = parts.value.y;
    viewMonth.value = parts.value.m;
});

function viewShift(delta: number) {
    const next = new Date(viewYear.value, viewMonth.value - 1 + delta, 1);
    viewYear.value = next.getFullYear();
    viewMonth.value = next.getMonth() + 1;
}

const monthCells = computed(() => buildMonthCells(viewYear.value, viewMonth.value));
const today = new Date();

const monthLabel = computed(() => {
    const date = new Date(viewYear.value, viewMonth.value - 1, 1);
    return new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "long" }).format(date);
});

const weekdayLabels = computed(() => {
    // common.weekday.sunday…saturday：zh 取末字（周日→日），en 取前 2 字母（Sun）
    const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    return keys.map((key) => {
        const full = t(`common.weekday.${key}`);
        const label = locale.value.startsWith("zh") ? full.slice(-1) : full.slice(0, 2);
        return { key, label };
    });
});

// ==================== 时间输入 ====================
const hourText = ref(String(parts.value.h));
const minuteText = ref(String(parts.value.mi));
const secondText = ref(String(parts.value.s));

watch(parts, (p) => {
    hourText.value = String(p.h);
    minuteText.value = String(p.mi);
    secondText.value = String(p.s);
});

function emitFromInputs() {
    const h = clampInput(hourText.value, 23);
    const mi = clampInput(minuteText.value, 59);
    const s = clampInput(secondText.value, 59);
    const base = selectedDate.value ?? new Date(viewYear.value, viewMonth.value - 1, today.getDate());
    emit("update:modelValue", combineDateTime(base, h, mi, s));
}

function clampInput(text: string, max: number): number {
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.min(max, Math.max(0, n));
}

// ==================== 选择 ====================
function pickDay(date: Date) {
    emit("update:modelValue", combineDateTime(date, parts.value.h, parts.value.mi, parts.value.s));
}

function pickNow() {
    emit("update:modelValue", toLocalDateTimeString(new Date()));
    show.value = false;
}

function handleClear() {
    emit("update:modelValue", "");
}

function togglePanel() {
    if (show.value) {
        show.value = false;
        return;
    }
    // 打开前同步时间输入框，避免上次清空的残影
    hourText.value = String(parts.value.h);
    minuteText.value = String(parts.value.mi);
    secondText.value = String(parts.value.s);
    show.value = true;
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
        // gd-date-picker 基类是主题插件的稳定定位钩子，配合 data-open / data-size 换肤，不要改名
        "gd-date-picker",
        "group relative flex w-full min-w-0 cursor-pointer box-border items-center border leading-none",
        // 圆角形态：默认矩形圆角（与 GdInput 表单控件一致），pill = 全圆角胶囊
        props.shape === "pill" ? "rounded-full" : "rounded-md",
        "transition-colors duration-200",
        s.height,
        s.paddingX,
        props.clearable && hasValue.value ? "" : "gap-1.5",
        // filled 变体；打开态用 data-open 替换 GdSelect 的 focus-within 套路
        "bg-[var(--gd-color-field-bg)] border-transparent",
        "md:hover:bg-[var(--gd-color-field-bg-hover)]",
        show.value ? "bg-[var(--gd-color-field-bg-focus)] border-[var(--gd-color-field-focus-border)]" : "",
    ].filter(Boolean).join(" ");
});

const displayText = computed(() => props.modelValue || "");
</script>

<style scoped>
.gd-date-picker__nav {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    padding: 0;
}

.gd-date-picker__nav:hover {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}

.gd-date-picker__cell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--gd-color-text);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    padding: 0;
}

.gd-date-picker__cell:hover {
    background: var(--gd-color-field-bg-hover);
}

.gd-date-picker__cell--outside {
    color: var(--gd-color-text-disabled);
    opacity: 0.55;
}

.gd-date-picker__cell--today {
    box-shadow: inset 0 0 0 1px var(--gd-color-primary);
    color: var(--gd-color-primary-text, var(--gd-color-primary));
}

.gd-date-picker__cell--selected {
    background: var(--gd-color-primary);
    color: #fff;
}

.gd-date-picker__action {
    border: none;
    background: transparent;
    color: var(--gd-color-primary);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    padding: 2px 4px;
}

.gd-date-picker__action:hover {
    opacity: 0.8;
}
</style>
