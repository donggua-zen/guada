<template>
    <button type="button" :disabled="disabled" :style="btnThemeStyle" :class="btnClasses" @click="handleClick">
        <div v-if="$slots.icon" name="icon" class="flex items-center justify-center align-middle leading-none"
            :class="iconClasses">
            <slot name="icon"></slot>
        </div>
        <slot></slot>
    </button>
</template>
<script setup lang="ts">
import { computed, useSlots } from "vue";

const $slots = useSlots();

// Emits 类型化
const emits = defineEmits<{
    click: [event: MouseEvent]
}>();
// Props 类型化
const props = defineProps<{
    type?: string;
    disabled?: boolean;
    round?: boolean;
    roundFull?: boolean;
    border?: boolean;
    block?: boolean;
    size?: string;
    plain?: boolean;
    text?: boolean;
}>()
// 点击处理 - 类型化
const handleClick = (e: MouseEvent): void => {
    emits("click", e);
};
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
        color: 'var(--gd-color-text)',
        bg: 'transparent',
        text: 'var(--gd-color-text)',
        border: 'var(--gd-color-border)',
        hoverBorder: 'var(--gd-color-border)',
        activeBorder: 'var(--gd-color-border)',
        disabledBorder: 'var(--gd-color-surface)',
        hoverBg: 'var(--gd-color-surface)',
        disabledBg: 'transparent',
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
    error: {
        color: 'var(--gd-color-error)',
        bg: 'var(--gd-color-error)',
        text: 'var(--gd-color-error-text)',
        border: 'var(--gd-color-error)',
        hoverBorder: 'var(--gd-color-error-hover)',
        activeBorder: 'var(--gd-color-error-active)',
        disabledBorder: 'var(--gd-color-error-disabled)',
        hoverBg: 'var(--gd-color-error-hover)',
        activeBg: 'var(--gd-color-error-active)',
        disabledBg: 'var(--gd-color-error-disabled)',
        disabledText: 'var(--gd-color-error-text-disabled)',
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

// 尺寸映射 - 类型化
interface SizeClasses {
    icon: string;
    iconPadding: string;
    text: string;
    padding: string;
}

const sizeMap: Record<string, SizeClasses> = {
    small: {
        icon: "w-3.5 h-3.5",
        iconPadding: "mr-0.5",
        text: "text-[12px]",
        padding: "px-3 h-[26px]",
    },
    medium: {
        icon: "w-4 h-4",
        iconPadding: "mr-1",
        text: "text-[14px]",
        padding: "px-3 h-[30px]",
    },
    large: {
        icon: "w-5 h-5",
        iconPadding: "mr-1.5",
        text: "text-[16px]",
        padding: "px-4 h-[40px]",
    },
}
const btnThemeStyle = computed((): any => {
    const theme = colorMap[(props.type || 'default').toLowerCase()] || colorMap.default;
    const baseStyles = {
        '--btn-base-color': theme.color,
        '--btn-base-text': theme.text,
        '--btn-base-border': theme.border,
        '--btn-base-hover': theme.hoverBg,
    };

    if (props.plain && props.type != "default") {
        // 使用透明度创建浅色背景
        return {
            ...baseStyles,
            '--btn-bg': `color-mix(in srgb, var(--btn-base-color) 10%, transparent)`,
            '--btn-text': 'var(--btn-base-color)',
            '--btn-border': `var(--btn-base-border)`,
            '--btn-border-hover': theme.hoverBorder,
            '--btn-border-active': theme.activeBorder,
            '--btn-hover': `color-mix(in srgb, var(--btn-base-color) 25%, transparent)`,
            '--btn-active': `color-mix(in srgb, var(--btn-base-color) 30%, transparent)`,
            '--outline': 'none',
        };
    }
    if (props.text) {
        return {
            ...baseStyles,
            '--btn-bg': 'transparent',
            '--btn-hover': `var(--gd-color-surface)`,
            '--btn-active': `color-mix(in srgb, var(--gd-color-surface) 50%, transparent)`,
            '--btn-text': 'var(--btn-base-color)',
            '--btn-border': `none`,
        }
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
        '--outline': `color-mix(in srgb, var(--btn-base-color) 20%, transparent)`,
    };
});
// defineOptions({
//     inheritAttrs: false // 禁用自动继承
// })
// const attrs = useAttrs()

const iconClasses = computed((): string => {
    let classes: string[] = [];
    const sizeClasses = sizeMap[(props.size || 'medium').toLowerCase()] || sizeMap.medium;
    classes.push(sizeClasses.icon);
    // 只有当存在默认插槽（文字内容）时才添加图标右边距
    if ($slots.default) {
        classes.push(sizeClasses.iconPadding);
    }
    return classes.join(" ");
});

const btnClasses = computed((): string => {
    let classes: string[] = [
        props.block ? "flex w-full" : "inline-flex",
        "cursor-pointer items-center justify-center align-middle transition-all duration-200",
        "disabled:cursor-not-allowed",
    ];

    // if (typeClasses[type]) {
    //     classes.push(typeClasses[type].disabled || "");
    //     classes.push(typeClasses[type].base || "");
    //     classes.push(typeClasses[type].active || "");
    //     classes.push(typeClasses[type].border || "");
    // }  
    // 填充按钮


    classes.push(
        `bg-[var(--btn-bg)]`,
        `text-[var(--btn-text)]`,
        !props.disabled ? `md:hover:bg-[var(--btn-hover)]` : '',
        `active:bg-[var(--btn-active)]`,
        `active:border-[var(--btn-border-active)]`,
        `disabled:bg-[var(--btn-bg-disabled)]`,
        `disabled:text-[var(--btn-text-disabled)]`,
        `focus:outline-none`,
    );

    if (!props.text && props.border) {
        classes.push(
            `border border-[var(--btn-border)]`,
            !props.disabled ? `md:hover:border-[var(--btn-border-hover)]` : '',
            `disabled:border-[var(--btn-border-disabled)]`,
        )
    }

    if (props.round) {
        classes.push("rounded-full");
    } else {
        classes.push("rounded-md");
    }

    const sizeClasses = sizeMap[(props.size || 'medium').toLowerCase()] || sizeMap.medium;
    classes.push(sizeClasses.text, sizeClasses.padding);
    return classes.join(" ");
});
</script>