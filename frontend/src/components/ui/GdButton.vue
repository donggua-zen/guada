<template>
    <button type="button" :disabled="isDisabled" :aria-busy="loading || undefined" :style="btnThemeStyle"
        :class="btnClasses" :data-variant="resolvedType" :data-size="resolvedSize" @click="handleClick">
        <span v-if="loading || $slots.icon"
            class="flex items-center justify-center align-middle leading-none shrink-0" :class="iconClasses">
            <svg v-if="loading" class="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            </svg>
            <slot v-else name="icon"></slot>
        </span>
        <!-- 纯文字标签：text-box-trim 把行盒裁到字形边缘（cap 顶到基线）再交给 flex 居中。
             CJK 字体 ascent/descent 不对称（14px 雅黑 15/4，汉字墨迹 11/1），按行盒居中恒定偏下约 0.5px；
             裁剪后居中作用于墨迹本身，不需要 1px padding 补偿。不支持的浏览器退化为行盒居中。
             含图标（el-icon/svg/组件）的插槽不走裁剪，保留按钮的 flex 居中，避免影响图标基线 -->
        <span v-if="isTextOnlyLabel()"
            class="gd-button__label block leading-none [text-box-trim:trim-both] [text-box-edge:cap_alphabetic]">
            <slot></slot>
        </span>
        <slot v-else></slot>
    </button>
</template>
<script setup lang="ts">
import { Comment, Fragment, Text, computed, useSlots, type CSSProperties, type VNode } from "vue";

const $slots = useSlots();

// Emits 类型化
const emits = defineEmits<{
    click: [event: MouseEvent]
}>();
// Props 类型化（error 为 danger 的插件契约别名）
const props = withDefaults(defineProps<{
    type?: "default" | "primary" | "secondary" | "danger" | "error" | "warning";
    size?: "tiny" | "small" | "default" | "medium" | "large";
    disabled?: boolean;
    loading?: boolean;
    link?: boolean;
    text?: boolean;
    plain?: boolean;
    round?: boolean;
    roundFull?: boolean;
    circle?: boolean;
    border?: boolean;
    block?: boolean;
}>(), {
    type: "default",
    size: "medium",
});
// 点击处理 - loading/disabled 时原生 button 不会触发 click
const handleClick = (e: MouseEvent): void => {
    emits("click", e);
};
const isDisabled = computed(() => props.disabled || props.loading);
// 颜色映射 - 类型化
interface ButtonTheme {
    color: string;
    bg: string;
    text: string;
    border: string;
    hoverBorder: string;
    activeBorder: string;
    disabledBorder: string;
    hoverBg: string;
    activeBg?: string;
    disabledBg: string;
    disabledText: string;
}

const colorMap: Record<string, ButtonTheme> = {
    default: {
        // 浅灰底中性按钮：底由 text 混入 surface 派生（亮色≈#F1F1F1，暗色自动反转为深灰），
        // hover/active 逐级加深。不用 surface-subtle（3.5% 在亮色下太淡，几乎看不出来）
        color: 'var(--gd-color-text)',
        bg: 'color-mix(in srgb, var(--gd-color-text) 5.5%, var(--gd-color-surface))',
        text: 'var(--gd-color-text)',
        border: 'var(--gd-color-border)',
        hoverBorder: 'var(--gd-color-border)',
        activeBorder: 'var(--gd-color-border)',
        disabledBorder: 'var(--gd-color-border)',
        hoverBg: 'color-mix(in srgb, var(--gd-color-text) 9%, var(--gd-color-surface))',
        activeBg: 'color-mix(in srgb, var(--gd-color-text) 14%, var(--gd-color-surface))',
        disabledBg: 'color-mix(in srgb, var(--gd-color-text) 4%, var(--gd-color-surface))',
        disabledText: 'var(--gd-color-text-disabled)',
    },
    primary: {
        color: 'var(--gd-color-primary)',
        bg: 'var(--gd-color-primary)',
        text: 'var(--gd-color-primary-text)',
        border: 'var(--gd-color-primary)',
        hoverBorder: 'var(--gd-color-primary-hover)',
        activeBorder: 'var(--gd-color-primary-active)',
        disabledBorder: 'var(--gd-color-primary-disabled)',
        hoverBg: 'var(--gd-color-primary-hover)',
        activeBg: 'var(--gd-color-primary-active)',
        disabledBg: 'var(--gd-color-primary-disabled)',
        disabledText: 'var(--gd-color-primary-text-disabled)',
    },
    secondary: {
        color: 'var(--gd-color-secondary)',
        bg: 'var(--gd-color-secondary)',
        text: 'var(--gd-color-secondary-text)',
        border: 'var(--gd-color-secondary)',
        hoverBorder: 'var(--gd-color-secondary-hover)',
        activeBorder: 'var(--gd-color-secondary-active)',
        disabledBorder: 'var(--gd-color-secondary-disabled)',
        hoverBg: 'var(--gd-color-secondary-hover)',
        activeBg: 'var(--gd-color-secondary-active)',
        disabledBg: 'var(--gd-color-secondary-disabled)',
        disabledText: 'var(--gd-color-secondary-text-disabled)',
    },
    danger: {
        color: 'var(--gd-color-danger)',
        bg: 'var(--gd-color-danger)',
        text: 'var(--gd-color-danger-text)',
        border: 'var(--gd-color-danger)',
        hoverBorder: 'var(--gd-color-danger-hover)',
        activeBorder: 'var(--gd-color-danger-active)',
        disabledBorder: 'var(--gd-color-danger-disabled)',
        hoverBg: 'var(--gd-color-danger-hover)',
        activeBg: 'var(--gd-color-danger-active)',
        disabledBg: 'var(--gd-color-danger-disabled)',
        disabledText: 'var(--gd-color-danger-text-disabled)',
    },
    warning: {
        color: 'var(--gd-color-warning)',
        bg: 'var(--gd-color-warning)',
        text: 'var(--gd-color-warning-text)',
        border: 'var(--gd-color-warning)',
        hoverBorder: 'var(--gd-color-warning-hover)',
        activeBorder: 'var(--gd-color-warning-active)',
        disabledBorder: 'var(--gd-color-warning-disabled)',
        hoverBg: 'var(--gd-color-warning-hover)',
        activeBg: 'var(--gd-color-warning-active)',
        disabledBg: 'var(--gd-color-warning-disabled)',
        disabledText: 'var(--gd-color-warning-text-disabled)',
    }
};
// error 是 danger 的别名（插件契约沿用旧名）
colorMap.error = colorMap.danger;

// 尺寸映射 - 类型化（对齐 zcode：所有档位统一 14px 字号，只变高度/内边距/图标）
interface SizeClasses {
    icon: string;
    iconPadding: string;
    text: string;
    padding: string;
    circle: string;
    svg: string;
}

const sizeMap: Record<string, SizeClasses> = {
    // 档位整体上移一格（用户视角「小一号命名」）：tiny=24 / small=28 / medium=32；
    // large 暂不实现，传入时回落 medium（resolveSize 处理）
    tiny: {
        icon: "w-3 h-3",
        iconPadding: "mr-1",
        text: "text-[14px]",
        padding: "px-2 h-[24px]",
        circle: "w-[24px] h-[24px]",
        svg: "[&_svg:not([class*='size-'])]:size-3",
    },
    small: {
        icon: "w-3.5 h-3.5",
        iconPadding: "mr-1",
        text: "text-[14px]",
        padding: "px-2 h-[28px]",
        circle: "w-[28px] h-[28px]",
        svg: "[&_svg:not([class*='size-'])]:size-3.5",
    },
    medium: {
        icon: "w-4 h-4",
        iconPadding: "mr-1",
        text: "text-[14px]",
        padding: "px-2.5 h-[32px]",
        circle: "w-[32px] h-[32px]",
        svg: "[&_svg:not([class*='size-'])]:size-4",
    },
}
const resolveSize = (): SizeClasses => {
    // default / 未实现档位（如 large）统一回落 medium
    const key = (props.size || "medium").toLowerCase();
    return sizeMap[key === "default" ? "medium" : key] || sizeMap.medium;
};
/**
 * 默认插槽是否「纯文字」（只有文本节点，没有元素/组件）。
 *
 * 纯文字才用 text-box-trim 做光学居中：它裁剪的是文字行盒，作用在 glyph 上。
 * 含图标/自定义内容时（<el-icon>、<svg>、组件），插槽内容高度由图标决定，
 * 走裁剪反而会让图标与文字基线错位；这类内容继续由按钮自身的 flex 居中处理。
 */
const isTextOnlyLabel = (): boolean => {
    const hasText = (list: unknown[]): boolean =>
        list.some((node) => {
            if (Array.isArray(node)) return hasText(node);
            if (typeof node === "string") return node.trim().length > 0;
            if (node === null || node === undefined || typeof node !== "object") return false;
            const vnode = node as VNode;
            if (vnode.type === Text) return typeof vnode.children === "string" && vnode.children.trim().length > 0;
            if (vnode.type === Fragment) return hasText((vnode.children as unknown[]) ?? []);
            return false;
        });
    const hasElement = (list: unknown[]): boolean =>
        list.some((node) => {
            if (Array.isArray(node)) return hasElement(node);
            if (node === null || node === undefined || typeof node !== "object") return false;
            const vnode = node as VNode;
            if (vnode.type === Text || vnode.type === Comment) return false;
            if (vnode.type === Fragment) return hasElement((vnode.children as unknown[]) ?? []);
            return true;
        });
    const nodes = ($slots.default?.() ?? []) as unknown[];
    return hasText(nodes) && !hasElement(nodes);
};
// 主题插件钩子：data-variant 归一后的类型名（error 视作 danger），data-size 归一后的档位
const resolvedType = computed((): string => {
    const key = (props.type || "default").toLowerCase();
    return key === "error" ? "danger" : key;
});
const resolvedSize = computed((): string => {
    const key = (props.size || "medium").toLowerCase();
    // default 与未实现档位（large）的 data-size 也归一为实际渲染档位，主题钩子才准
    return sizeMap[key] && key !== "default" ? key : "medium";
});
const btnThemeStyle = computed((): CSSProperties => {
    const key = (props.type || "default").toLowerCase();
    const theme = colorMap[key] || colorMap.default;
    const baseStyles = {
        '--btn-base-color': theme.color,
        '--btn-base-text': theme.text,
        '--btn-base-border': theme.border,
        '--btn-base-hover': theme.hoverBg,
    };

    if (props.link) {
        // 类型色文字、无底无边，hover 靠透明度变化（对齐 el-button link 语义）
        return {
            ...baseStyles,
            '--btn-bg': 'transparent',
            '--btn-hover': 'transparent',
            '--btn-active': 'transparent',
            '--btn-bg-disabled': 'transparent',
            '--btn-text': 'var(--btn-base-color)',
            '--btn-text-disabled': 'var(--gd-color-text-disabled)',
            '--btn-border': 'transparent',
        };
    }
    if (props.text) {
        return {
            ...baseStyles,
            '--btn-bg': 'transparent',
            // hover 用半透明 text 色叠加，任意底色（白/灰/暗）上都可见；
            // 不能再用 surface——亮色下是纯白，白底上 hover 完全不可见
            '--btn-hover': `color-mix(in srgb, var(--gd-color-text) 7%, transparent)`,
            '--btn-active': `color-mix(in srgb, var(--gd-color-text) 11%, transparent)`,
            '--btn-bg-disabled': 'transparent',
            '--btn-text': 'var(--btn-base-color)',
            '--btn-text-disabled': 'var(--gd-color-text-disabled)',
            '--btn-border': `none`,
        }
    }
    if (props.plain && key === "default") {
        // 白底灰边的次要按钮：底走 surface，让它在有底色的容器（行 hover、灰面板）上仍然凸出来。
        // default 的填充底本身就是 5.5% text，和行 hover 的 surface-subtle-hover 同值，
        // 叠在一起会糊成一片，所以 plain 在 default 上必须是「白底 + 描边」而不是「灰底」。
        // 描边用 text 派生的半透明色：--gd-color-border(#e8e8e8) 压在 5.5% 灰底上只差 9 级明度，1px 看不见。
        return {
            ...baseStyles,
            '--btn-bg': 'var(--gd-color-surface)',
            '--btn-text': 'var(--btn-base-text)',
            '--btn-bg-disabled': 'var(--gd-color-surface)',
            '--btn-text-disabled': 'var(--gd-color-text-disabled)',
            '--btn-border': `color-mix(in srgb, var(--gd-color-text) 15%, transparent)`,
            '--btn-border-hover': `color-mix(in srgb, var(--gd-color-text) 24%, transparent)`,
            '--btn-border-active': `color-mix(in srgb, var(--gd-color-text) 30%, transparent)`,
            '--btn-border-disabled': `color-mix(in srgb, var(--gd-color-text) 8%, transparent)`,
            '--btn-hover': `color-mix(in srgb, var(--gd-color-text) 9%, var(--gd-color-surface))`,
            '--btn-active': `color-mix(in srgb, var(--gd-color-text) 14%, var(--gd-color-surface))`,
        }
    }
    if (props.plain && key !== "default") {
        // 浅底描边：10% 底 + 半透明描边，hover/active 加深底色
        return {
            ...baseStyles,
            '--btn-bg': `color-mix(in srgb, var(--btn-base-color) 10%, transparent)`,
            '--btn-text': 'var(--btn-base-color)',
            '--btn-text-disabled': 'var(--gd-color-text-disabled)',
            '--btn-bg-disabled': `color-mix(in srgb, var(--btn-base-color) 10%, transparent)`,
            '--btn-border': `color-mix(in srgb, var(--btn-base-color) 50%, transparent)`,
            '--btn-border-hover': 'var(--btn-base-color)',
            '--btn-border-active': 'var(--btn-base-color)',
            '--btn-border-disabled': `color-mix(in srgb, var(--btn-base-color) 30%, transparent)`,
            '--btn-hover': `color-mix(in srgb, var(--btn-base-color) 25%, transparent)`,
            '--btn-active': `color-mix(in srgb, var(--btn-base-color) 30%, transparent)`,
        };
    }
    return {
        ...baseStyles,
        '--btn-bg': theme.bg,
        '--btn-text': 'var(--btn-base-text)',
        '--btn-hover': theme.hoverBg,
        '--btn-active': theme.activeBg,
        '--btn-bg-disabled': theme.disabledBg,
        '--btn-text-disabled': theme.disabledText,
        '--btn-border': `var(--btn-base-border)`,
        '--btn-border-hover': theme.hoverBorder,
        '--btn-border-active': theme.activeBorder,
        '--btn-border-disabled': theme.disabledBorder,
    };
});

const iconClasses = computed((): string => {
    let classes: string[] = [];
    const sizeClasses = resolveSize();
    classes.push(sizeClasses.icon);
    // 只有当存在默认插槽（文字内容）时才添加图标右边距
    if ($slots.default) {
        classes.push(sizeClasses.iconPadding);
    }
    return classes.join(" ");
});

const btnClasses = computed((): string => {
    const sizeClasses = resolveSize();
    const disabled = isDisabled.value;
    let classes: string[] = [
        // gd-button 基类是主题插件（plugins/guada-themes）的稳定定位钩子，
        // 配合 data-variant / data-size 做拟物化换肤，不要改名
        "gd-button",
        props.block ? "flex w-full" : "inline-flex",
        "cursor-pointer items-center justify-center align-middle whitespace-nowrap",
        // 行高显式取 1：按钮高度是固定整数档位，不能让文字继承 preflight 的 1.5
        // （14 × 1.5 = 21px 行盒在 24/28/32px 按钮里会落出半像素偏移）
        "leading-none",
        // 只过渡颜色：transition-all 会在尺寸/布局变化时批量触发非合成动画
        "transition-colors duration-200",
        "disabled:cursor-not-allowed",
        "focus:outline-none",
        sizeClasses.svg,
    ];

    if (props.link) {
        classes.push(
            `bg-transparent text-[var(--btn-text)]`,
            !disabled ? `md:hover:opacity-80 active:opacity-60` : '',
            `disabled:text-[var(--btn-text-disabled)]`,
        );
    } else if (props.text) {
        classes.push(
            `bg-transparent text-[var(--btn-text)]`,
            !disabled ? `md:hover:bg-[var(--btn-hover)]` : '',
            `active:bg-[var(--btn-active)]`,
            `disabled:text-[var(--btn-text-disabled)]`,
        );
    } else {
        classes.push(
            `bg-[var(--btn-bg)]`,
            `text-[var(--btn-text)]`,
            !disabled ? `md:hover:bg-[var(--btn-hover)]` : '',
            `active:bg-[var(--btn-active)]`,
            `disabled:bg-[var(--btn-bg-disabled)]`,
            `disabled:text-[var(--btn-text-disabled)]`,
        );
        // plain 隐含描边（对齐 el-button plain）
        if (props.border || props.plain) {
            classes.push(
                `border border-[var(--btn-border)]`,
                !disabled ? `md:hover:border-[var(--btn-border-hover)]` : '',
                `active:border-[var(--btn-border-active)]`,
                `disabled:border-[var(--btn-border-disabled)]`,
            );
        }
    }

    if (props.round || props.roundFull || props.circle) {
        classes.push("rounded-full");
    } else {
        classes.push("rounded-md");
    }

    if (props.circle) {
        // 圆形图标钮：宽高相等，去掉水平 padding
        classes.push("p-0", sizeClasses.circle);
    } else {
        classes.push(sizeClasses.padding);
    }

    classes.push(sizeClasses.text);
    return classes.filter(Boolean).join(" ");
});
</script>
