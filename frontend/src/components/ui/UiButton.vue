<template>
    <div :class="btnClasses" @click="handleClick">
        <slot></slot>
    </div>
</template>
<script setup>
import { defineEmits, defineProps, computed } from "vue";
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
})
const handleClick = (e) => {
    emits("click", e);
};

const typeClasses = {
    'default': "text-[var(--primary-text-color)] hover:bg-[var(--secondary)]",
    'primary': "bg-[var(--primary)] text-white hover:bg-[var(--primary-light)]",
    'text': "hover:text-[var(--primary)] hover:bg-[var(--tertiary)]"
};


const btnClasses = computed(() => {
    let classes = [
        "cursor-pointer px-1.5 py-1 flex items-center justify-center transition-colors duration-200",
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
    return classes.join(" ");
});
</script>