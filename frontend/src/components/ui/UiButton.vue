<template>
    <button type="button" :disabled="disabled" :style="btnThemeStyle" :class="btnClasses" @click="handleClick">
        <div v-if="$slots.icon" name="icon" class="flex items-center justify-center align-middle leading-none"
            :class="iconClasses">
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
        color: 'var(--color-text)',
        bg: 'transparent',
        text: 'var(--color-text)',
        border: 'var(--color-border)',
        hoverBorder: 'var(--color-border)',
        activeBorder: 'var(--color-border)',
        disabledBorder: 'var(--color-surface)',
        hoverBg: 'var(--color-surface)',
        disabledBg: 'transparent',
        disabledText: 'var(--color-text-disabled)',
    },
    primary: {
        color: 'var(--color-primary)',
        bg: 'var(--color-primary)',
        text: 'var(--color-primary-text)',
        border: 'var(--color-primary)',
        hoverBorder: 'var(--color-primary-hover)',
        activeBorder: 'var(--color-primary-active)',
        disabledBorder: 'var(--color-primary-disabled)',
        hoverBg: 'var(--color-primary-hover)',
        activeBg: 'var(--color-primary-active)',
        disabledBg: 'var(--color-primary-disabled)',
        disabledText: 'var(--color-primary-text-disabled)',
    },
    secondary: {
        color: 'var(--color-secondary)',
        bg: 'var(--color-secondary)',
        text: 'var(--color-secondary-text)',
        border: 'var(--color-secondary)',
        hoverBorder: 'var(--color-secondary-hover)',
        activeBorder: 'var(--color-secondary-active)',
        disabledBorder: 'var(--color-secondary-disabled)',
        disabledText: 'var(--color-secondary-text-disabled)',
        hoverBg: 'var(--color-secondary-hover)',
        activeBg: 'var(--color-secondary-active)',
        disabledBg: 'var(--color-secondary-disabled)',
        disabledText: 'var(--color-secondary-text-disabled)',
    },
    error: {
        color: 'var(--color-error)',
        bg: 'var(--color-error)',
        text: 'var(--color-error-text)',
        border: 'var(--color-error)',
        hoverBorder: 'var(--color-error-hover)',
        activeBorder: 'var(--color-error-active)',
        disabledBorder: 'var(--color-error-disabled)',
        hoverBg: 'var(--color-error-hover)',
        activeBg: 'var(--color-error-active)',
        disabledBg: 'var(--color-error-disabled)',
        disabledText: 'var(--color-error-text-disabled)',
    },
    warning: {
        color: 'var(--color-warning)',
        bg: 'var(--color-warning)',
        text: 'var(--color-warning-text)',
        border: 'var(--color-warning)',
        hoverBorder: 'var(--color-warning-hover)',
        activeBorder: 'var(--color-warning-active)',
        disabledBorder: 'var(--color-warning-disabled)',
        hoverBg: 'var(--color-warning-hover)',
        activeBg: 'var(--color-warning-active)',
        disabledBg: 'var(--color-warning-disabled)',
        disabledText: 'var(--color-warning-text-disabled)',
    }
};

const sizeMap = {
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
const btnThemeStyle = computed(() => {
    const theme = colorMap[props.type.toLowerCase()] || colorMap.default;
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
            '--btn-hover': `var(--color-surface)`,
            '--btn-active': `color-mix(in srgb, var(--color-surface) 50%, transparent)`,
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

    const sizeClasses = sizeMap[props.size.toLowerCase()] || sizeMap.medium;
    classes.push(sizeClasses.text, sizeClasses.padding);
    return classes.join(" ");
});
</script>