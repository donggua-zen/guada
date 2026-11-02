<template>
    <!-- 外层包一层 gd-input-number 主题钩子（winxp 等主题可定位数字输入整体）；
         内部 GdInput 的 gd-input 壳自动继承主题对输入域的规则 -->
    <div class="gd-input-number contents" :data-size="(size === 'default' || size === 'large' ? 'medium' : size)">
        <GdInput ref="inputRef" :model-value="inputText" type="text" :variant="variant" :size="size" :shape="shape"
            :placeholder="placeholder" :disabled="disabled" :error="error" inputmode="decimal"
            :class="attrs.class" :style="[attrs.style, stepperReserveStyle]" @update:model-value="handleInput" @focus="emit('focus', $event)"
            @blur="handleBlur" @keyup.enter="handleEnter">
        <!-- suffix 合成槽：单位插槽 + 右排步进按钮 -->
        <template v-if="$slots.suffix || (controls && !disabled)" #suffix>
            <slot name="suffix"></slot>
            <!-- 步进钮贴右缘：绝对定位脱离内容流（wrapper 是 relative），
                 左侧 1px 分隔线 + 满高两等分，右侧圆角贴合壳的内圆角 -->
            <span v-if="controls && !disabled"
                class="absolute inset-y-0 right-0 flex w-4 flex-col overflow-hidden border-l border-[var(--gd-color-border)]"
                :class="shape === 'pill' ? 'rounded-r-full' : 'rounded-r-[5px]'">
                <button type="button" :tabindex="-1" aria-label="增加" :disabled="atMax"
                    class="flex min-h-0 w-full flex-1 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 md:hover:bg-[var(--gd-color-field-option-bg-hover)] md:hover:text-[var(--gd-color-field-text)]"
                    @click.stop="stepBy(1)" @mousedown.prevent>
                    <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m18 15-6-6-6 6" />
                    </svg>
                </button>
                <button type="button" :tabindex="-1" aria-label="减少" :disabled="atMin"
                    class="flex min-h-0 w-full flex-1 cursor-pointer items-center justify-center border-0 border-t border-[var(--gd-color-border)] bg-transparent p-0 text-[var(--gd-color-field-text-placeholder)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 md:hover:bg-[var(--gd-color-field-option-bg-hover)] md:hover:text-[var(--gd-color-field-text)]"
                    @click.stop="stepBy(-1)" @mousedown.prevent>
                    <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
            </span>
        </template>
        </GdInput>
    </div>
</template>
<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import GdInput from "./GdInput.vue";

defineOptions({ name: "GdInputNumber", inheritAttrs: false });

const props = withDefaults(defineProps<{
    /** null 透传：空=未设置（如 temperature=null 表示用模型默认），不强制回落 min/0 */
    modelValue?: number | null;
    min?: number;
    max?: number;
    step?: number;
    /** true = 右排上下步进钮（默认）；false = 纯数字输入 */
    controls?: boolean;
    variant?: "filled" | "outline";
    size?: "tiny" | "small" | "medium" | "default" | "large";
    /** 圆角形态：rounded 矩形圆角（默认）；pill 全圆角胶囊（透传给 GdInput） */
    shape?: "rounded" | "pill";
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
}>(), {
    modelValue: null,
    min: -Infinity,
    max: Infinity,
    step: 1,
    controls: true,
    shape: "rounded",
    variant: "filled",
    size: "medium",
});

const emit = defineEmits<{
    "update:modelValue": [value: number | null];
    change: [value: number | null];
    focus: [event: FocusEvent];
}>();

const attrs = useAttrs();
const inputRef = ref<InstanceType<typeof GdInput> | null>(null);

/** 步进钮绝对定位贴右缘后，给 wrapper 补右内距（覆盖 GdInput 自带 px），
 *  避免输入文本/单位插槽被压在步进钮下面 */
const stepperReserveStyle = computed((): Record<string, string> | null => {
    if (!props.controls || props.disabled) return null;
    return { paddingRight: "24px" };
});

// 输入框里的文本：外部值变化时同步（null → 空串显示 placeholder）
const inputText = computed((): string => (props.modelValue === null || props.modelValue === undefined ? "" : String(props.modelValue)));

/** step 小数位数（0.1 → 1，0.05 → 2）：步进结果按它 round，避免 0.1+0.2 浮点尾巴 */
const stepDecimals = computed((): number => {
    const s = String(props.step);
    const idx = s.indexOf(".");
    return idx === -1 ? 0 : s.length - idx - 1;
});
const roundToStep = (v: number): number => Number(v.toFixed(Math.min(stepDecimals.value, 6)));

const clamp = (v: number): number => Math.min(Math.max(v, props.min), props.max);

/** 解析输入文本：空/非法 → null；合法 → clamp 后 emit */
const commit = (text: string, emitChange: boolean): void => {
    const trimmed = text.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
        emit("update:modelValue", null);
        if (emitChange) emit("change", null);
        return;
    }
    const value = clamp(Number(trimmed));
    emit("update:modelValue", value);
    if (emitChange) emit("change", value);
};

const handleInput = (text: string): void => {
    // 输入过程中不 clamp（允许清空后重新键入），只在 blur/Enter/步进时定值
    const trimmed = text.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
        emit("update:modelValue", null);
        return;
    }
    emit("update:modelValue", Number(trimmed));
};
const handleBlur = (): void => {
    commit(inputText.value, true);
};
const handleEnter = (): void => {
    commit(inputText.value, true);
};

// ==================== 步进 ====================
const atMin = computed(() => props.modelValue !== null && props.modelValue <= props.min);
const atMax = computed(() => props.modelValue !== null && props.modelValue >= props.max);
const stepBy = (direction: 1 | -1): void => {
    if (props.disabled) return;
    // null 时步进从 min 起步（无 min 边界则从 step 起步）
    const base = props.modelValue ?? (Number.isFinite(props.min) ? props.min : 0);
    const next = clamp(roundToStep(base + direction * props.step));
    emit("update:modelValue", next);
    emit("change", next);
};

defineExpose({
    focus: (): void => inputRef.value?.focus(),
    blur: (): void => inputRef.value?.blur(),
});
</script>
