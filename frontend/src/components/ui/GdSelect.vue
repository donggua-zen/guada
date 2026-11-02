<template>
    <!-- 触发器：与 GdInput 同一视觉壳（filled 默认灰底无边框），filterable 时内嵌原生输入。
         v-bind="$attrs"：fragment 根（触发器 + Teleport 面板）不会自动继承外部 class/style，
         必须显式落到触发器上 -->
    <div ref="triggerRef" v-bind="$attrs" :class="triggerClasses" :data-variant="variant" :data-size="resolvedSize"
        role="combobox" :aria-expanded="show" aria-haspopup="listbox" :aria-activedescendant="show ? activeDescendant : undefined"
        :tabindex="disabled ? -1 : 0" :aria-disabled="disabled || undefined"
        @click="togglePanel" @keydown="handleTriggerKeydown" @mouseenter="hovered = true" @mouseleave="hovered = false">
        <!-- 多选 chips -->
        <template v-if="multiple">
            <span v-for="val in selectedValues" :key="String(val)" class="gd-select__chip inline-flex h-5 shrink-0 items-center gap-0.5 rounded-sm bg-[var(--gd-color-field-option-bg-hover)] px-1.5 text-[12px] leading-none text-[var(--gd-color-field-text)]">
                {{ labelOf(val) }}
                <button v-if="!disabled" type="button" :tabindex="-1" aria-label="移除"
                    class="flex size-3 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 md:hover:text-[var(--gd-color-field-text)]"
                    @click.stop="removeChip(val)">
                    <svg class="size-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                </button>
            </span>
        </template>
        <!-- 单选 label（filterable 面板打开时让位给输入框） -->
        <span v-if="!multiple && !(filterable && show)" class="min-w-0 flex-1 truncate text-[14px] leading-none"
            :class="hasValue ? 'text-[var(--gd-color-field-text)]' : 'text-[var(--gd-color-field-text-placeholder)]'">
            {{ displayLabel || placeholder || '' }}
        </span>
        <!-- filterable 输入框：多选时始终在 chips 末尾，单选时仅面板打开期间渲染 -->
        <input v-if="filterable && (multiple || show)" ref="filterInputRef" v-model="query" type="text"
            class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] leading-none outline-none placeholder:text-[var(--gd-color-field-text-placeholder)]"
            :class="disabled ? 'cursor-not-allowed' : ''" :placeholder="multiple && !selectedValues.length ? (placeholder || '') : ''"
            :disabled="disabled" :aria-controls="`${uid}-listbox`" @keydown="handleFilterKeydown" @compositionstart="compositionStart = true" @compositionend="compositionStart = false">
        <!-- suffix：clearable 清空钮（hover 且有值时替代箭头）+ 转义箭头 -->
        <span v-if="!disabled && clearable && hasValue && hovered" class="ml-1.5 flex shrink-0 items-center">
            <button type="button" :tabindex="-1" aria-label="清空"
                class="flex size-4 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 md:hover:text-[var(--gd-color-field-text)]"
                @click.stop="handleClear">
                <svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
            </button>
        </span>
        <span v-else class="ml-1.5 flex shrink-0 items-center text-[var(--gd-color-field-text-placeholder)]">
            <svg class="size-4 transition-transform duration-200" :class="show ? 'rotate-180' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
            </svg>
        </span>
        <!-- GdOption 子组件的挂载出口：GdOption render null，仅 setup 阶段向本组件注册。
             没有这个 <slot> 出口，Vue 不会实例化插槽内容，所有子组件式下拉都会是"无数据" -->
        <slot></slot>
    </div>

    <!-- 下拉面板：GdPopover 承担定位/翻转/点击外部关闭/Esc -->
    <GdPopover v-model:show="show" :anchor-el="triggerRef" :width="popoverWidth" :max-height="274" align="start"
        popper-class="gd-select__panel">
        <div :id="`${uid}-listbox`" role="listbox" :aria-busy="loading || undefined" class="flex flex-col gap-0.5">
            <!-- loading 态 -->
            <div v-if="loading" class="flex min-h-[32px] items-center justify-center gap-2 px-2 py-1 text-[13px] leading-none text-[var(--gd-color-field-text-placeholder)]">
                <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                </svg>
            </div>
            <!-- 可创建虚拟项 -->
            <div v-else-if="createItem" :id="`${uid}-opt-create`" role="option" :aria-selected="false"
                :class="optionClasses(createItem)" :data-create="true"
                @mouseenter="highlightIndex = 0" @click="selectEntry(createItem)">
                <span class="truncate">新建「{{ createItem.label }}」</span>
            </div>
            <!-- 选项列表 -->
            <template v-if="!loading">
                <div v-for="(entry, index) in filteredEntries" :key="`${entry.create ? 'create' : 'opt'}-${String(entry.value)}`"
                    :id="optionId(index)" role="option" :aria-selected="isSelected(entry.value)" :aria-disabled="entry.disabled || undefined"
                    :class="optionClasses(entry)"
                    @mouseenter="highlightIndex = flattenIndex(index)" @click="selectEntry(entry)">
                    <!-- GdOption 子组件的自定义内容优先，否则显示 label 文本 -->
                    <component :is="slotOf(entry.value)!" v-if="slotOf(entry.value)" />
                    <template v-else>
                        <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
                        <svg v-if="isSelected(entry.value)" class="size-3.5 shrink-0 text-[var(--gd-color-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                        </svg>
                    </template>
                </div>
                <!-- 空态 -->
                <div v-if="!filteredEntries.length && !createItem" class="px-2 py-3 text-center text-[12px] leading-none text-[var(--gd-color-field-text-disabled)]">
                    {{ noDataText }}
                </div>
            </template>
        </div>
    </GdPopover>
</template>
<script setup lang="ts">
import { computed, nextTick, provide, ref, watch } from "vue";
import GdPopover from "./GdPopover.vue";
import { gdSelectKey } from "./gdSelectContext";

defineOptions({ name: "GdSelect", inheritAttrs: false });

export interface GdSelectOption {
    label: string;
    value: string | number;
    disabled?: boolean;
}

interface FlatEntry {
    label: string;
    value: string | number;
    disabled?: boolean;
    create?: boolean;
}

/** GdOption 子组件注册的运行时形态 */
interface RegisteredOption {
    getLabel: () => string;
    getValue: () => string | number;
    getDisabled: () => boolean;
    slot: (() => unknown) | null;
}

// <GdOption> 子组件注册表（与 options prop 二选一或混用，注册顺序即模板顺序）
const childOptions = ref<RegisteredOption[]>([]);
provide(gdSelectKey, {
    register: (option) => {
        childOptions.value.push(option);
        return () => {
            const idx = childOptions.value.indexOf(option);
            if (idx >= 0) childOptions.value.splice(idx, 1);
        };
    },
});

// 归一后的完整选项列表：label 求值是响应式的（t(labelKey) 随语言切换）
const resolvedOptions = computed<GdSelectOption[]>(() => {
    if (childOptions.value.length) {
        return childOptions.value.map((o) => ({ label: o.getLabel(), value: o.getValue(), disabled: o.getDisabled() }));
    }
    return props.options;
});
const slotOf = (value: string | number): (() => unknown) | null =>
    childOptions.value.find((o) => o.getValue() === value)?.slot ?? null;

const props = withDefaults(defineProps<{
    modelValue?: string | number | Array<string | number> | null;
    options?: GdSelectOption[];
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    /** 输入即过滤（label 不区分大小写 includes） */
    filterable?: boolean;
    multiple?: boolean;
    /** 查询无精确匹配时面板顶部出「新建」虚拟项（value = 查询文本） */
    allowCreate?: boolean;
    /** Enter 选中当前高亮项（配 allowCreate 使用） */
    defaultFirstOption?: boolean;
    loading?: boolean;
    variant?: "filled" | "outline";
    size?: "tiny" | "small" | "medium" | "default" | "large";
    noDataText?: string;
    /** 错误态红描边（表单校验行内错误时由 GdFormField 调用方接线） */
    error?: boolean;
}>(), {
    modelValue: "",
    options: () => [],
    size: "medium",
    variant: "filled",
    noDataText: "无数据",
});

const emits = defineEmits<{
    "update:modelValue": [value: string | number | Array<string | number>];
    change: [value: string | number | Array<string | number>];
    "visible-change": [visible: boolean];
}>();

const uid = `gd-select-${Math.random().toString(36).slice(2, 8)}`;
const triggerRef = ref<HTMLElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);
const hovered = ref(false);
const show = ref(false);
const query = ref("");
const compositionStart = ref(false);
const highlightIndex = ref(0); // 在扁平可选列表（含 create 虚拟项）中的下标
const popoverWidth = ref<number | undefined>(undefined);

const multiple = computed(() => props.multiple);
const hasValue = computed(() =>
    multiple.value ? (Array.isArray(props.modelValue) && props.modelValue.length > 0)
        : !(props.modelValue === undefined || props.modelValue === null || props.modelValue === ""));

const selectedValues = computed<Array<string | number>>(() =>
    multiple.value ? (Array.isArray(props.modelValue) ? props.modelValue : []) : []);

const valueLabelMap = computed(() => {
    const map = new Map<string | number, string>();
    for (const opt of resolvedOptions.value) map.set(opt.value, opt.label);
    return map;
});
const labelOf = (value: string | number): string => valueLabelMap.value.get(value) ?? String(value ?? "");
const displayLabel = computed(() => (multiple.value ? "" : hasValue.value ? labelOf(props.modelValue as string | number) : ""));

// ==================== 过滤与扁平列表 ====================
const filteredEntries = computed<FlatEntry[]>(() => {
    const q = query.value.trim().toLowerCase();
    const list = resolvedOptions.value.filter((opt) => !q || String(opt.label).toLowerCase().includes(q));
    return list.map((opt) => ({ label: opt.label, value: opt.value, disabled: opt.disabled }));
});
const createItem = computed<FlatEntry | null>(() => {
    if (!props.allowCreate || props.loading) return null;
    const q = query.value.trim();
    if (!q) return null;
    const exists = resolvedOptions.value.some((opt) => String(opt.label).toLowerCase() === q.toLowerCase());
    return exists ? null : { label: q, value: q, create: true };
});
// 扁平可选列表：create 虚拟项在顶部
const flatEntries = computed<FlatEntry[]>(() => (createItem.value ? [createItem.value, ...filteredEntries.value] : filteredEntries.value));

const optionId = (filteredIndex: number): string => {
    const entry = filteredEntries.value[filteredIndex];
    return entry ? `${uid}-opt-${entry.create ? "create" : String(entry.value)}` : "";
};
const activeDescendant = computed(() => {
    const entry = flatEntries.value[highlightIndex.value];
    return entry ? `${uid}-opt-${entry.create ? "create" : String(entry.value)}` : undefined;
});
// filteredEntries 渲染下标 → 扁平列表下标（create 项占位 0）
const flattenIndex = (filteredIndex: number): number => (createItem.value ? filteredIndex + 1 : filteredIndex);

const firstSelectableIndex = (): number => flatEntries.value.findIndex((e) => !e.disabled);

// ==================== 打开/关闭 ====================
const openPanel = async (): Promise<void> => {
    if (props.disabled || show.value) return;
    query.value = "";
    highlightIndex.value = Math.max(0, firstSelectableIndex());
    popoverWidth.value = triggerRef.value?.offsetWidth || undefined;
    show.value = true;
    await nextTick();
    // 焦点必须落在组件内键盘事件才有人接：filterable 有内嵌输入框，
    // 其余场景焦点拉回触发器（keydown 由 handleTriggerKeydown 转发）
    if (filterable.value) filterInputRef.value?.focus();
    else triggerRef.value?.focus();
    scrollHighlightIntoView();
};
const closePanel = (): void => {
    show.value = false;
    query.value = "";
};
const togglePanel = (): void => {
    if (props.disabled) return;
    if (show.value) closePanel(); else openPanel();
};
watch(show, (visible) => {
    emits("visible-change", visible);
    if (visible) return;
    // 关闭后焦点回到触发器（filterable 的内嵌输入框已随面板销毁），保证后续键盘操作
    triggerRef.value?.focus();
});
// el 语义：面板打开时拉数据（ConnectionSettings 的 @visible-change）

// ==================== 键盘导航 ====================
const moveHighlight = (delta: number): void => {
    const list = flatEntries.value;
    if (!list.length) return;
    let idx = highlightIndex.value;
    for (let step = 0; step < list.length; step++) {
        idx = (idx + delta + list.length) % list.length;
        if (!list[idx].disabled) break;
    }
    highlightIndex.value = idx;
    scrollHighlightIntoView();
};
const jumpHighlight = (end: boolean): void => {
    const list = flatEntries.value;
    const idx = end ? list.length - 1 : 0;
    highlightIndex.value = idx;
    scrollHighlightIntoView();
};
const scrollHighlightIntoView = (): void => {
    nextTick(() => document.getElementById(`${uid}-opt-${flatEntries.value[highlightIndex.value]?.create ? "create" : String(flatEntries.value[highlightIndex.value]?.value)}`)?.scrollIntoView({ block: "nearest" }));
};
const handleFilterKeydown = (e: KeyboardEvent): void => {
    if (!show.value) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openPanel(); }
        return;
    }
    switch (e.key) {
        case "ArrowDown": e.preventDefault(); moveHighlight(1); break;
        case "ArrowUp": e.preventDefault(); moveHighlight(-1); break;
        case "Home": e.preventDefault(); jumpHighlight(false); break;
        case "End": e.preventDefault(); jumpHighlight(true); break;
        case "Enter":
            e.preventDefault();
            if (compositionStart.value) return;
            selectHighlighted();
            break;
        case "Escape": closePanel(); break; // GdPopover 也会 emit false，这里先清 query
        default: break;
    }
};
// 非 filterable 触发器（div tabindex=0）接收键盘；filterable 的触发器也可能持有焦点
// （点击打开瞬间、面板关闭回焦），此时同样要处理导航键
const handleTriggerKeydown = (e: KeyboardEvent): void => {
    if (!show.value) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openPanel(); }
        return;
    }
    handleFilterKeydown(e);
};

// ==================== 选中逻辑 ====================
const isSelected = (value: string | number): boolean =>
    multiple.value ? selectedValues.value.includes(value) : props.modelValue === value;

const selectEntry = (entry: FlatEntry): void => {
    if (entry.disabled || props.disabled) return;
    if (multiple.value) {
        const next = selectedValues.value.slice();
        const idx = next.indexOf(entry.value);
        if (idx >= 0) next.splice(idx, 1); else next.push(entry.value);
        emits("update:modelValue", next);
        emits("change", next);
        query.value = ""; // el 行为：多选选择后清空查询，面板保持打开
        highlightIndex.value = Math.max(0, firstSelectableIndex());
    } else {
        const changed = props.modelValue !== entry.value;
        emits("update:modelValue", entry.value);
        if (changed) emits("change", entry.value);
        closePanel();
    }
};
const selectHighlighted = (): void => {
    const entry = flatEntries.value[highlightIndex.value];
    if (entry && !entry.disabled) selectEntry(entry);
};
const removeChip = (value: string | number): void => {
    const next = selectedValues.value.filter((v) => v !== value);
    emits("update:modelValue", next);
    emits("change", next);
};
const handleClear = (): void => {
    const empty = multiple.value ? [] : "";
    emits("update:modelValue", empty);
    emits("change", empty);
};

// 高亮跟随过滤结果：查询变化时重置到首个可选顶
watch([query, resolvedOptions], () => {
    if (!show.value) return;
    highlightIndex.value = Math.max(0, firstSelectableIndex());
});

// ==================== 样式（触发器壳与 GdInput 同一 token 套路） ====================
interface SizeSpec {
    height: string;
    paddingX: string;
    icon: string;
}
const sizeMap: Record<string, SizeSpec> = {
    tiny: { height: "h-[24px]", paddingX: "px-2", icon: "[&_svg:not([class*='size-'])]:size-3" },
    small: { height: "h-[28px]", paddingX: "px-2", icon: "[&_svg:not([class*='size-'])]:size-3.5" },
    medium: { height: "h-[32px]", paddingX: "px-2.5", icon: "[&_svg:not([class*='size-'])]:size-4" },
};
const resolveSize = (): SizeSpec => {
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key === "default" ? "medium" : key] || sizeMap.medium;
};
const resolvedSize = computed((): string => {
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key] && key !== "default" ? key : "medium";
});
const filterable = computed(() => props.filterable);

const triggerClasses = computed((): string => {
    const s = resolveSize();
    const classes: string[] = [
        // gd-select 基类是主题插件的稳定定位钩子，配合 data-variant / data-size 换肤，不要改名
        "gd-select",
        "group relative flex w-full min-w-0 box-border rounded-md border",
        // 多选 chips 换行需要撑开高度；单选固定档位高度
        multiple.value ? "min-h-[32px] flex-wrap items-center py-1" : "items-center",
        "leading-none",
        "transition-colors duration-200",
        s.paddingX,
        s.icon,
    ];
    if (!multiple.value) classes.push(s.height);
    if (props.disabled) {
        classes.push("cursor-not-allowed");
        classes.push(props.variant === "outline"
            ? "bg-[var(--gd-color-field-outline-bg)] border-[var(--gd-color-field-outline-border)] opacity-60"
            : "bg-[var(--gd-color-field-bg-disabled)] border-transparent");
    } else if (props.error) {
        classes.push(
            "bg-[var(--gd-color-field-bg)]",
            "border-[var(--gd-color-danger)]",
            "md:hover:bg-[var(--gd-color-field-bg-hover)]",
        );
    } else if (props.variant === "outline") {
        classes.push(
            "cursor-pointer bg-[var(--gd-color-field-outline-bg)] border-[var(--gd-color-field-outline-border)]",
            "md:hover:border-[var(--gd-color-field-outline-border-hover)]",
            show.value ? "border-[var(--gd-color-field-focus-border)]" : "",
        );
    } else {
        classes.push(
            "cursor-pointer bg-[var(--gd-color-field-bg)] border-transparent",
            "md:hover:bg-[var(--gd-color-field-bg-hover)]",
            show.value
                ? "bg-[var(--gd-color-field-bg-focus)] border-[var(--gd-color-field-focus-border)]"
                : "",
        );
    }
    return classes.filter(Boolean).join(" ");
});

const optionClasses = (entry: FlatEntry): string => {
    const highlighted = flatEntries.value[highlightIndex.value] === entry;
    return [
        "gd-select-option relative flex min-h-[28px] w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-[14px] leading-none transition-colors duration-150",
        entry.disabled
            ? "cursor-not-allowed text-[var(--gd-color-field-text-disabled)]"
            : highlighted ? "bg-[var(--gd-color-field-option-bg-hover)] text-[var(--gd-color-field-text)]" : "text-[var(--gd-color-field-text)]",
        isSelected(entry.value) ? "font-medium" : "",
    ].filter(Boolean).join(" ");
};

defineExpose({
    focus: (): void => triggerRef.value?.focus(),
    open: openPanel,
    close: closePanel,
});
</script>
