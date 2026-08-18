<template>
    <!-- @ts-ignore - Element Plus 类型缺失 -->
    <div class="flex w-full gap-4">
        <el-slider v-model="sliderValue" :min="sliderMin" :max="sliderMax" :step="step" :size="size"
            :format-tooltip="formatTooltip" />
        <el-input v-model="inputValue" :style="{ width: `${inputWidth}px` }" placeholder="Please Input"
            @change="handleInputChange" :size="size" clearable>
        </el-input>
    </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { computed } from 'vue';
// @ts-ignore - Element Plus 类型缺失
import { ElSlider, ElInput } from 'element-plus';
// const value = ref(50);
const inputValue = ref<number | string>(50);

// Emits 类型化
const emits = defineEmits<{
    'update:modelValue': [value: number | null]
}>();

// Props 类型化
const props = defineProps<{
    modelValue?: number;
    min?: number;
    max?: number;
    step?: number;
    size?: 'default' | 'small' | 'large';
    optionalDirection?: 'min' | 'max';
    optionalText?: string;
    inputWidth?: number;
}>()

const sliderMin = computed((): number => {
    if (props.optionalDirection === 'min') {
        return (props.min ?? 0) - (props.step ?? 1);
    } else {
        return props.min ?? 0;
    }
})

const sliderMax = computed((): number => {
    if (props.optionalDirection === 'max') {
        return (props.max ?? 100) + (props.step ?? 1);
    } else {
        return props.max ?? 100;
    }
})

const formatTooltip = (val: number): number | string => {
    if (val < (props.min ?? 0) || val > (props.max ?? 100)) {
        return props.optionalText ?? 'Auto';
    }
    return val;
}

const sliderValue = computed({
    get(): number {
        if (props.modelValue == null) {
            if (props.optionalDirection === 'min') {
                return (props.min ?? 0) - (props.step ?? 1);
            } else {
                return (props.max ?? 100) + (props.step ?? 1);
            }
        }
        return props.modelValue;
    },
    set(newValue: number) {
        if (newValue < (props.min ?? 0) || newValue > (props.max ?? 100)) {
            emits('update:modelValue', null);
            return;
        }
        emits('update:modelValue', newValue);
    }
})

watch(sliderValue, (newValue: number | null) => {
    console.log('sliderValue', newValue);
    if (newValue == null || newValue < (props.min ?? 0) || newValue > (props.max ?? 100)) {
        inputValue.value = props.optionalText ?? 'Auto';
        return;
    }
    inputValue.value = newValue;
}, { immediate: true })

const handleInputChange = (val: string): void => {
    const number = parseFloat(val);
    if (isNaN(number)) {
        inputValue.value = props.optionalText ?? 'Auto';
        sliderValue.value = props.optionalDirection === 'min' ? sliderMin.value : sliderMax.value;
        return;
    }
    inputValue.value = number;
    sliderValue.value = number;
};
</script>