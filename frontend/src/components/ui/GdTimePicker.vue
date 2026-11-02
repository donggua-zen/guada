<template>
    <!-- 触发器：与 GdSelect/GdInput 同一视觉壳（filled 灰底无边框） -->
    <div ref="triggerRef" :class="triggerClasses" :data-open="show" data-variant="filled" :data-size="resolvedSize"
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

    <!-- 时/分两列滚动列表：GdPopover 承担定位/翻转/点击外部关闭/Esc -->
    <GdPopover v-model:show="show" :anchor-el="triggerRef" :width="220" :max-height="248" align="start"
        popper-class="gd-time-picker__panel">
        <div class="flex gap-1 p-1">
            <div class="gd-time-picker__col" role="listbox" :aria-label="t('common.hour')">
                <button v-for="h in HOUR_RANGE" :key="h" type="button" role="option"
                    :aria-selected="hour === h" :ref="(el) => registerRow(hourColRef, h, el)"
                    class="gd-time-picker__row" :class="{ 'gd-time-picker__row--selected': hour === h }"
                    @click="pick('hour', h)">
                    {{ pad2(h) }}
                </button>
            </div>
            <div class="gd-time-picker__col" role="listbox" :aria-label="t('common.minute')">
                <button v-for="m in MINUTE_RANGE" :key="m" type="button" role="option"
                    :aria-selected="minute === m" :ref="(el) => registerRow(minuteColRef, m, el)"
                    class="gd-time-picker__row" :class="{ 'gd-time-picker__row--selected': minute === m }"
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
}>(), {
    modelValue: "",
    placeholder: "",
    size: "default",
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

// ==================== 滚动定位 ====================
const hourColRef = new Map<number, HTMLElement>();
const minuteColRef = new Map<number, HTMLElement>();

function registerRow(map: Map<number, HTMLElement>, value: number, el: unknown) {
    // :ref 函数在更新时以 null 回调，清掉旧条目
    if (el instanceof HTMLElement) map.set(value, el);
    else map.delete(value);
}

watch(show, async (val) => {
    if (!val) return;
    await nextTick();
    scrollColTo(hourColRef, hour.value);
    scrollColTo(minuteColRef, minute.value);
});

function scrollColTo(map: Map<number, HTMLElement>, value: number) {
    if (value < 0) return;
    map.get(value)?.scrollIntoView({ block: "center" });
}

// ==================== 选择 ====================
function pick(part: "hour" | "minute", value: number) {
    const h = part === "hour" ? value : Math.max(0, hour.value);
    const m = part === "minute" ? value : Math.max(0, minute.value);
    emit("update:modelValue", combineTime(h, m));
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
    small: { height: "h-[26px]", paddingX: "px-2", icon: "size-3.5" },
    default: { height: "h-[32px]", paddingX: "px-2.5", icon: "size-4" },
} as const;
const sizeSpec = computed(() => sizeMap[props.size] ?? sizeMap.default);
const resolvedSize = computed(() => props.size);

const triggerClasses = computed((): string => {
    const s = sizeSpec.value;
    return [
        // gd-time-picker 基类是主题插件的稳定定位钩子，配合 data-open / data-size 换肤，不要改名
        "gd-time-picker",
        "group relative flex w-full min-w-0 cursor-pointer box-border items-center rounded-md border leading-none",
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
.gd-time-picker__col {
    display: flex;
    flex-direction: column;
    gap: 2px;
    height: 224px;
    overflow-y: auto;
    padding: 2px;
    scrollbar-width: thin;
}

.gd-time-picker__row {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--gd-color-text);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    padding: 0;
    flex-shrink: 0;
}

.gd-time-picker__row:hover {
    background: var(--gd-color-field-bg-hover);
}

.gd-time-picker__row--selected {
    background: var(--gd-color-primary);
    color: #fff;
}
</style>
