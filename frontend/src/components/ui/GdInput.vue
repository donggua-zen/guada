<template>
    <div ref="wrapperRef" :class="wrapperClasses" :style="wrapperStyle" :data-variant="variant"
        :data-size="resolvedSize" @focusin="handleFocusin" @focusout="handleFocusout" @click="handleWrapperClick">
        <!-- prefix 插槽（el 同名）：mousedown.prevent 防止点击图标时输入框失焦 -->
        <span v-if="$slots.prefix && !isTextarea" class="gd-input__prefix" :class="prefixClasses" @mousedown.prevent>
            <slot name="prefix"></slot>
        </span>
        <textarea v-if="isTextarea" v-bind="nativeAttrs" ref="inputRef" :class="textareaClasses" :style="textareaStyle"
            :value="displayValue" @input="handleInput"></textarea>
        <input v-else v-bind="nativeAttrs" ref="inputRef" :class="nativeInputClasses" :type="nativeType"
            :value="displayValue" @input="handleInput">
        <!-- 字数统计：textarea 下绝对定位到右下角（对齐 el-input 行为） -->
        <span v-if="showWordLimit" class="gd-input__count shrink-0 select-none leading-none text-[12px] text-[var(--gd-color-field-text-disabled)]"
            :class="isTextarea ? 'pointer-events-none absolute right-2 bottom-1.5' : 'ml-1.5'">
            {{ (displayValue ?? '').length }}/{{ maxlength }}
        </span>
        <span v-if="hasSuffix" class="gd-input__suffix" :class="suffixClasses" @mousedown.prevent>
            <button v-if="showClear" type="button" :tabindex="-1" aria-label="清空"
                class="gd-input__clear flex size-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 md:hover:text-[var(--gd-color-field-text)]"
                @click.stop="handleClear">
                <svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
            </button>
            <button v-if="passwordToggleVisible" type="button" :tabindex="-1"
                :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
                class="gd-input__password-toggle flex size-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 md:hover:text-[var(--gd-color-field-text)]"
                @click.stop="togglePassword">
                <svg v-if="passwordVisible" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                <svg v-else class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            </button>
            <slot name="suffix"></slot>
        </span>
    </div>
</template>
<script setup lang="ts">
import { computed, ref, useAttrs, useSlots, type CSSProperties, type StyleValue } from "vue";

defineOptions({ inheritAttrs: false, name: "GdInput" });

const $slots = useSlots();
const attrs = useAttrs();

const props = withDefaults(defineProps<{
    modelValue?: string | number | null;
    type?: "text" | "textarea" | "password" | "number";
    /** filled：灰底无边框（默认）；outline：白底描边（视觉=原 el-input，引用 --gd-color-input-* token，主题覆盖即换肤） */
    variant?: "filled" | "outline";
    size?: "tiny" | "small" | "medium" | "default" | "large";
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    clearable?: boolean;
    showPassword?: boolean;
    maxlength?: number | string;
    showWordLimit?: boolean;
    /** textarea 专用：行数 */
    rows?: number | string;
    /** textarea 自动增高：field-sizing: content 按内容长高，minRows/maxRows 换算 min/max-height（不依赖 JS 测高） */
    autosize?: boolean | { minRows?: number; maxRows?: number };
    /** 手动设置 textarea 的 resize 行为（默认 vertical） */
    resize?: "none" | "both" | "horizontal" | "vertical";
    /** 错误态红描边。表单校验态由 GdFormField 显式传 error，不再依赖 el-form 的 .is-error 钩子 */
    error?: boolean;
    /** 圆角形态：rounded 矩形圆角（默认，表单统一语言）；pill 全圆角胶囊 */
    shape?: "rounded" | "pill";
}>(), {
    modelValue: "",
    type: "text",
    variant: "filled",
    size: "medium",
    rows: undefined,
    autosize: false,
    resize: undefined,
    maxlength: undefined,
    shape: "rounded",
});

const emits = defineEmits<{
    "update:modelValue": [value: string];
    input: [value: string];
    change: [value: string];
    clear: [];
    focus: [event: FocusEvent];
    blur: [event: FocusEvent];
}>();

const wrapperRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const focused = ref(false);
const passwordVisible = ref(false);
// change 事件对齐 el 语义：focus 时记录值，blur 时值有变化才 emit
let valueAtFocus: string | null = null;

const isTextarea = computed(() => props.type === "textarea");
const passwordToggleVisible = computed(() => props.type === "password" && props.showPassword);
const nativeType = computed(() => {
    if (props.type === "password") return passwordToggleVisible.value && passwordVisible.value ? "text" : "password";
    return props.type;
});

const displayValue = computed(() => (props.modelValue ?? "") as string);
const handleInput = (e: Event): void => {
    const value = (e.target as HTMLInputElement).value;
    emits("update:modelValue", value);
    emits("input", value);
};

const handleFocusin = (e: FocusEvent): void => {
    focused.value = true;
    valueAtFocus = String(displayValue.value ?? "");
    emits("focus", e);
};
const handleFocusout = (e: FocusEvent): void => {
    // 焦点在 wrapper 内部转移（如点眼睛钮）不算 blur
    if (wrapperRef.value?.contains(e.relatedTarget as Node)) return;
    focused.value = false;
    const value = String(displayValue.value ?? "");
    if (valueAtFocus !== null && value !== valueAtFocus) emits("change", value);
    valueAtFocus = null;
    emits("blur", e);
};
const handleWrapperClick = (): void => {
    if (!props.disabled) inputRef.value?.focus();
};

const showClear = computed(() =>
    props.clearable && !props.disabled && !props.readonly && String(displayValue.value ?? "") !== "");
const handleClear = (): void => {
    emits("update:modelValue", "");
    emits("input", "");
    emits("change", "");
    emits("clear");
    inputRef.value?.focus();
};
const togglePassword = (): void => {
    passwordVisible.value = !passwordVisible.value;
    inputRef.value?.focus();
};
const hasSuffix = computed(() => !isTextarea.value && (showClear.value || passwordToggleVisible.value || !!$slots.suffix));
const showWordLimit = computed(() => props.showWordLimit && props.maxlength !== undefined);

// 原生属性透传：@keyup.enter、autofocus、spellcheck、inputmode、name、id 等全部落在原生元素上
const nativeAttrs = computed<Record<string, unknown>>(() => {
    const { class: _, style: __, ...rest } = attrs;
    return {
        ...rest,
        placeholder: props.placeholder,
        disabled: props.disabled || undefined,
        readonly: props.readonly || undefined,
        maxlength: props.maxlength,
        rows: isTextarea.value ? computedRows.value : undefined,
        "aria-invalid": props.error || undefined,
    };
});

// ==================== 尺寸（与 GdButton 同表：统一 14px 字号、整数高度、无亚像素） ====================
interface SizeSpec {
    height: string;
    paddingX: string;
    /** prefix/suffix 插槽内 svg 的自动尺寸（显式 size-* 的不受约束，同 GdButton） */
    icon: string;
}
const sizeMap: Record<string, SizeSpec> = {
    tiny: { height: "h-[24px]", paddingX: "px-2", icon: "[&_svg:not([class*='size-'])]:size-3" },
    small: { height: "h-[28px]", paddingX: "px-2", icon: "[&_svg:not([class*='size-'])]:size-3.5" },
    medium: { height: "h-[32px]", paddingX: "px-2.5", icon: "[&_svg:not([class*='size-'])]:size-4" },
};
const resolveSize = (): SizeSpec => {
    // default / 未实现档位（large）统一回落 medium，与 GdButton 一致
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key === "default" ? "medium" : key] || sizeMap.medium;
};
const resolvedSize = computed((): string => {
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key] && key !== "default" ? key : "medium";
});

// ==================== autosize ====================
const computedRows = computed((): number => {
    const r = Number(props.rows);
    return Number.isFinite(r) && r > 0 ? r : 2;
});
const textareaLineHeight = 20; // 14px 字号 × 1.43 ≈ 20px 整数行高
const textareaPaddingY = 8;    // py-2
const textareaStyle = computed((): StyleValue => {
    const style: Record<string, string> = { resize: props.resize || "vertical" };
    if (props.autosize) {
        const opts = props.autosize === true
            ? { minRows: computedRows.value }
            : { minRows: props.autosize.minRows ?? computedRows.value, maxRows: props.autosize.maxRows };
        style["min-height"] = `${opts.minRows * textareaLineHeight + textareaPaddingY * 2}px`;
        if (opts.maxRows) style["max-height"] = `${opts.maxRows * textareaLineHeight + textareaPaddingY * 2}px`;
    }
    return style as CSSProperties;
});

// ==================== 样式类 ====================
const wrapperClasses = computed((): string => {
    const s = resolveSize();
    const classes: string[] = [
        // gd-input 基类是主题插件（plugins/guada-themes）的稳定定位钩子，
        // 配合 data-variant / data-size 做拟物化换肤，不要改名。
        // 宽度固定 w-full：需要定宽时由消费方包一层带 w-* 的容器（不要指望 w-11 直接覆盖，
        // 同元素上两个宽度工具类特异性相同，谁生效取决于 Tailwind 产物顺序）
        "gd-input",
        "group",
        "relative flex w-full min-w-0 items-center box-border",
        // 边框常驻 1px（filled 用透明色）：error/focus 切换描边时几何不跳动
        "border",
        // 圆角形态：默认矩形圆角（表单统一语言），pill = 全圆角胶囊
        props.shape === "pill" ? "rounded-full" : "rounded-md",
        // 行高显式 1：不能继承 preflight 的 1.5（14×1.5=21px 行盒在整数高度里落出半像素偏移）
        "leading-none",
        "transition-colors duration-200",
        s.paddingX,
        s.icon,
    ];
    if (isTextarea.value) {
        classes.push("py-2 items-start");
    } else {
        classes.push(s.height);
    }
    // disabled 不输出交互态 class（同 GdButton）
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
            "bg-[var(--gd-color-field-outline-bg)]",
            "border-[var(--gd-color-field-outline-border)]",
            "md:hover:border-[var(--gd-color-field-outline-border-hover)]",
            "focus-within:border-[var(--gd-color-field-focus-border)]",
        );
    } else {
        // filled：灰底无边框，hover 加深一档，focus 回到 surface 底 + 主色描边
        classes.push(
            "bg-[var(--gd-color-field-bg)]",
            "border-transparent",
            "md:hover:bg-[var(--gd-color-field-bg-hover)]",
            "focus-within:bg-[var(--gd-color-field-bg-focus)]",
            "focus-within:border-[var(--gd-color-field-focus-border)]",
        );
    }
    if (attrs.class) classes.push(String(attrs.class));
    return classes.filter(Boolean).join(" ");
});
const wrapperStyle = computed((): StyleValue => (attrs.style ?? {}) as CSSProperties);

const nativeInputClasses = computed((): string => [
    "min-w-0 flex-1 border-0 bg-transparent p-0 outline-none",
    "text-[14px] leading-none text-[var(--gd-color-field-text)]",
    "placeholder:text-[var(--gd-color-field-text-placeholder)]",
    props.disabled ? "cursor-not-allowed text-[var(--gd-color-field-text-disabled)]" : "",
].filter(Boolean).join(" "));

const textareaClasses = computed((): string => [
    "min-w-0 flex-1 border-0 bg-transparent p-0 outline-none",
    // self-stretch 而非 h-full：壳是 flex 容器（textarea 变体 items-start），
    // 交叉轴拉伸是 flex 自身机制，不依赖百分比高度；h-full 在「壳高度由 flex 拉伸得来」
    // 的场景下没有确定基准，会回落成 auto（rows 高度）。壳高度为 auto 时 stretch 也不改变布局
    "self-stretch",
    "text-[14px] leading-[20px] text-[var(--gd-color-field-text)]",
    "placeholder:text-[var(--gd-color-field-text-placeholder)]",
    props.disabled ? "cursor-not-allowed text-[var(--gd-color-field-text-disabled)]" : "",
].filter(Boolean).join(" "));

const prefixClasses = computed((): string => [
    "flex shrink-0 items-center text-[var(--gd-color-field-text-placeholder)]",
    resolveSize().icon,
    "mr-1.5",
].join(" "));

const suffixClasses = computed((): string => [
    "flex shrink-0 items-center text-[var(--gd-color-field-text-placeholder)]",
    resolveSize().icon,
    "ml-1.5",
].join(" "));

defineExpose({
    /** 对齐 el-input 的 ref 方法，迁移时 $refs.input.focus() 调用零改动 */
    focus: (): void => inputRef.value?.focus(),
    blur: (): void => inputRef.value?.blur(),
    select: (): void => inputRef.value?.select(),
    input: inputRef,
});
</script>
