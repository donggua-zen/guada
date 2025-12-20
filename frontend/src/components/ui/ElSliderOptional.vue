<template>
    <div class="flex w-full gap-4">
        <el-slider v-model="sliderValue" :min="sliderMin" :max="sliderMax" :step="step" :size="size"
            :format-tooltip="formatTooltip" />
        <el-input v-model="inputValue" :style="{ width: `${inputWidth}px` }" placeholder="Please Input"
            @change="handleInputChange" :size="size" clearable>
        </el-input>
    </div>
</template>
<script setup>
import { ref, watch } from 'vue';
import { computed } from 'vue';
// const value = ref(50);
const inputValue = ref(50);
const emits = defineEmits(['update:modelValue']);
const props = defineProps({
    modelValue: {
        type: Number,
        default: 50
    },
    min: {
        type: Number,
        default: 0
    },
    max: {
        type: Number,
        default: 100
    },
    step: {
        type: Number,
        default: 1
    },
    size: {
        type: String,
        default: 'default'
    },
    optionalDirection: {
        type: String,
        default: 'min'
    },
    optionalText: {
        type: String,
        default: 'Auto'
    },
    inputWidth: {
        type: Number,
        default: 120
    }
})

const sliderMin = computed(() => {
    if (props.optionalDirection === 'min') {
        return props.min - props.step;
    } else {
        return props.min;
    }
})

const sliderMax = computed(() => {
    if (props.optionalDirection === 'max') {
        return props.max + props.step;
    } else {
        return props.max;
    }
})

const formatTooltip = (val) => {
    if (val < props.min || val > props.max) {
        return props.optionalText;
    }
    return val;
}

const sliderValue = computed({
    get() {
        if (props.modelValue == null) {
            if (props.optionalDirection === 'min') {
                return props.min - props.step;
            } else {
                return props.max + props.step;
            }
        }
        return props.modelValue;
    },
    set(newValue) {
        if (newValue < props.min || newValue > props.max) {
            emits('update:modelValue', null);
            return;
        }
        emits('update:modelValue', newValue);
    }
})

watch(sliderValue, (newValue) => {
    console.log('sliderValue', newValue);
    if (newValue < props.min || newValue > props.max || newValue == null) {
        inputValue.value = props.optionalText;
        return;
    }
    inputValue.value = newValue;
}, { immediate: true })

const handleInputChange = (val) => {
    const number = parseFloat(val);
    if (isNaN(number)) {
        inputValue.value = props.optionalText;
        sliderValue.value = props.optionalDirection === 'min' ? sliderMin.value : sliderMax.value;
        return;
    }
    inputValue.value = number;
    sliderValue.value = number;
};
</script>