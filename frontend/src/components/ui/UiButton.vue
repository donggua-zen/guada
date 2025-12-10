<template>
    <div :class="btnClasses" @click="handleClick">
        <slot></slot>
    </div>
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
    round: {
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
    'default': "text-[var(--primary-text-color)] hover:bg-[var(--tertiary-color)]",
    'primary': "bg-[var(--primary-color)] text-white hover:bg-[var(--primary-light)]",
    'text': "hover:text-[var(--primary-color)] hover:bg-[var(--tertiary-color)]"
};

// defineOptions({
//     inheritAttrs: false // 禁用自动继承
// })
// const attrs = useAttrs()
const btnClasses = computed(() => {
    let classes = [
        "cursor-pointer flex items-center justify-center transition-colors duration-200",
    ];
    if (typeClasses[props.type]) {
        classes.push(typeClasses[props.type]);
    }

    if (props.roundFull) {
        classes.push("rounded-full");
    } else if (props.round) {
        classes.push("rounded-md");
    }
    if (props.border) {
        classes.push("border border-gray-200");
    }
    if (props.size === "sm") {
        classes.push("text-sm px-2 py-1");
    } else if (props.size === "lg") {
        classes.push("text-lg px-2 py-1");
    } else if (props.size === "md") {
        classes.push("text-base px-2 py-1");
    } else if (props.size === "base") {

    }


    return classes.join(" ");
});
</script>