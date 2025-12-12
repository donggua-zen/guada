<template>
    <button :disabled="disabled" :style="btnThemeStyle" :class="btnClasses" @click="handleClick">
        <div v-if="$slots.icon" name="icon" class="flex items-center justify-center align-middle leading-none" :class="iconClasses">
            <slot name="icon"></slot>
        </div>
        <slot></slot>
    </button>
</template>
<script setup>
import { computed, useSlots } from "vue";
const $slots = useSlots();
const emits = defineEmits(["click"]);
const props = defineProps({
    type: {
        type: String,
        default: "default"
    },
    disabled: {
        type: Boolean,
        default: false
    },
    round: {
        type: Boolean,
        default: false
    },
    roundFull: {
        type: Boolean,
        default: false
    },
    border: {
        type: Boolean,
        default: true
    },
    block: {
        type: Boolean,
        default: false
    },
    size: {
        type: String,
        default: "md"
    },
    disabled: {
        type: Boolean,
        default: false
    },
    plain: {
        type: Boolean,
        default: false
    },
    text: {
        type: Boolean,
        default: false
    }

})
const handleClick = (e) => {
    emits("click", e);
};
const colorMap = {
    default: {
        color: 'var(--text-primary-color)',
        bg: 'transparent',
        text: 'var(--text-primary-color)',
        border: 'var(--text-gray)',
        hoverBorder: 'var(--text-gray)',
        activeBorder: 'var(--text-gray)',
        disabledBorder: 'var(--text-gray)',
        hoverBg: 'var(--tertiary-color)',
        disabledBg: 'var(--tertiary-color-disabled)',
        disabledText: 'var(--text-primary-disabled)',
    },
    primary: {
        color: 'var(--primary-color)',
        bg: 'var(--primary-color)',
        text: 'var(--primary-text)',
        border: 'var(--primary-color)',
        hoverBorder: 'var(--primary-color-hover)',
        activeBorder: 'var(--primary-color-active)',
        disabledBorder: 'var(--primary-color-disabled)',
        hoverBg: 'var(--primary-color-hover)',
        activeBg: 'var(--primary-color-active)',
        disabledBg: 'var(--primary-color-disabled)',
        disabledText: 'var(--primary-text-disabled)',
    },
    secondary: {
        color: 'var(--secondary-color)',
        bg: 'var(--secondary-color)',
        text: 'var(--secondary-text)',
        border: 'var(--secondary-color)',
        hoverBorder: 'var(--secondary-color-hover)',
        activeBorder: 'var(--secondary-color-active)',
        disabledBorder: 'var(--secondary-color-disabled)',
        disabledText: 'var(--secondary-text-disabled)',
        hoverBg: 'var(--secondary-color-hover)',
        activeBg: 'var(--secondary-color-active)',
        disabledBg: 'var(--secondary-color-disabled)',
        disabledText: 'var(--secondary-text-disabled)',
    },
    tertiary: {
        color: 'var(--tertiary-color)',
        bg: 'var(--tertiary-color)',
        text: 'var(--tertiary-text)',
        border: 'var(--tertiary-color)',
        hoverBorder: 'var(--tertiary-color-hover)',
        activeBorder: 'var(--tertiary-color-active)',
        disabledBorder: 'var(--tertiary-color-disabled)',
        hoverBg: 'var(--tertiary-color-hover)',
        activeBg: 'var(--tertiary-color-active)',
        disabledBg: 'var(--tertiary-color-disabled)',
        disabledText: 'var(--tertiary-text-disabled)',
    },
    error: {
        color: 'var(--error-color)',
        bg: 'var(--error-color)',
        text: 'var(--error-text)',
        border: 'var(--error-color)',
        hoverBorder: 'var(--error-color-hover)',
        activeBorder: 'var(--error-color-active)',
        disabledBorder: 'var(--error-color-disabled)',
        hoverBg: 'var(--error-color-hover)',
        activeBg: 'var(--error-color-active)',
        disabledBg: 'var(--error-color-disabled)',
        disabledText: 'var(--error-text-color)',
    },
    warning: {
        color: 'var(--warning-color)',
        bg: 'var(--warning-color)',
        text: 'var(--warning-text)',
        border: 'var(--warning-color)',
        hoverBorder: 'var(--warning-color-hover)',
        activeBorder: 'var(--warning-color-active)',
        disabledBorder: 'var(--warning-color-disabled)',
        hoverBg: 'var(--warning-color-hover)',
        activeBg: 'var(--warning-color-active)',
        disabledBg: 'var(--warning-color-disabled)',
        disabledText: 'var(--warning-text-color)',
    }
};

const sizeMap = {
    small: {
        icon: "w-4 h-4",
        iconPadding: "mr-0.5",
        text: "text-[12px]",
        padding: "px-3 h-[28px]",
    },
    medium: {
        icon: "w-4.5 h-4.5",
        iconPadding: "mr-1",
        text: "text-[14px]",
        padding: "px-3 h-[34px]",
    },
    large: {
        icon: "w-5 h-5",
        iconPadding: "mr-1.5",
        text: "text-[16px]",
        padding: "px-4 h-[40px]",
    },
}
const btnThemeStyle = computed(() => {
    const theme = colorMap[props.type.toLowerCase()] || colorMap.default;
    const baseStyles = {
        '--btn-base-color': theme.color,
        '--btn-base-text': theme.text,
        '--btn-base-border': theme.border,
        '--btn-base-hover': theme.hoverBg,
    };

    if (props.plain) {
        // 使用透明度创建浅色背景
        return {
            ...baseStyles,
            '--btn-bg': `color-mix(in srgb, var(--btn-base-color) 20%, transparent)`,
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
            '--btn-hover': `color-mix(in srgb, var(--text-gray) 50%, transparent)`,
            '--btn-active': `color-mix(in srgb, var(--text-gray) 60%, transparent)`,
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

const iconClasses = computed(() => {
    let classes = [];
    const sizeClasses = sizeMap[props.size.toLowerCase()] || sizeMap.medium;
    classes.push(sizeClasses.icon);
    // 只有当存在默认插槽（文字内容）时才添加图标右边距
    if ($slots.default) {
        classes.push(sizeClasses.iconPadding);
    }
    return classes.join(" ");
});

const btnClasses = computed(() => {
    let classes = [
        props.block ? "flex w-full" : "inline-flex",
        "cursor-pointer items-center justify-center align-middle transition-all duration-200",
        "disabled:cursor-not-allowed",
    ];

    let styleType = 'default'
    if (props.plain) {
        styleType = 'plain'
    } else if (props.text) {
        styleType = 'text'
    }

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
        `hover:bg-[var(--btn-hover)]`,
        `active:bg-[var(--btn-active)]`,
        `active:border-[var(--btn-border-active)]`,
        `disabled:bg-[var(--btn-bg-disabled)]`,
        `disabled:text-[var(--btn-text-disabled)]`,
        `focus:outline-none`,
    );

    if (!props.text && props.border) {
        classes.push(
            `border border-[var(--btn-border)]`,
            `hover:border-[var(--btn-border-hover)]`,
            `disabled:border-[var(--btn-border-disabled)]`,
        )
    }

    if (props.round) {
        classes.push("rounded-full");
    } else {
        classes.push("rounded-md");
    }

    const sizeClasses = sizeMap[props.size.toLowerCase()] || sizeMap.medium;
    classes.push(sizeClasses.text, sizeClasses.padding);
    return classes.join(" ");
});
</script>