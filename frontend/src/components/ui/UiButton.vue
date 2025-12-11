<template>
    <button :class="btnClasses" @click="handleClick">
        <slot></slot>
    </button>
</template>
<script setup>
import { defineEmits, defineProps, computed, useAttrs } from "vue";
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
    rounded: {
        type: Boolean,
        default: true
    },
    roundFull: {
        type: Boolean,
        default: false
    },
    border: {
        type: Boolean,
        default: true
    },
    size: {
        type: String,
        default: "md"
    }
})
const handleClick = (e) => {
    emits("click", e);
};

const typeClasses = {
    'default': {
        'base': "text-[var(--primary-text)] hover:bg-[var(--tertiary-color)]",
    },
    'primary': {
        'base': "bg-[var(--primary-color)] text-[var(--primary-text)] hover:bg-[var(--primary-color-hover)]",
        'disabled': "bg-[var(--primary-color)]",
    },
    'secondary': {
        'base': "bg-[var(--secondary-color)] text-[var(--secondary-text)] hover:bg-[var(--secondary-color-hover)]",
        'disabled': "bg-[var(--secondary-color-disabled)]",
    },
    'tertiary': {
        'base': "bg-[var(--tertiary-color)] text-[var(--tertiary-text)] hover:bg-[var(--tertiary-color-hover)]",
    }
};

// defineOptions({
//     inheritAttrs: false // 禁用自动继承
// })
// const attrs = useAttrs()
const btnClasses = computed(() => {
    let classes = [
        "display-inline cursor-pointer flex items-center justify-center transition-colors duration-200",
    ];
    if (typeClasses[props.type]) {
        classes.push(typeClasses[props.type].base);
    }

    if (props.roundFull) {
        classes.push("rounded-full");
    } else if (props.rounded) {
        classes.push("rounded-sm");
    }
    if (props.border) {
        classes.push("border border-gray-200");
    }
    if (props.size === "small") {
        classes.push("text-[13px] px-3 py-0.5");
    } else if (props.size === "large") {
        classes.push("text-lg px-2 py-1");
    } else if (props.size === "medium") {
        classes.push("text-[14px] px-3 py-1.5");
    } else if (props.size === "base") {

    }


    return classes.join(" ");
});
</script>