<template>
    <div class="p-4">
        <template v-for="size in sizes">
            <h1>{{ size }}</h1>
            <div class="flex flex-wrap gap-4 mb-4">
                <UiButton v-for="theme in themes" :type="theme" :size="size">{{ theme }}</UiButton>
            </div>
            <div class="flex flex-wrap gap-4 mb-4">
                <UiButton v-for="theme, index in themes" :type="theme" :size="size">
                    <template #icon>
                        <component :is="icons[index]" />
                    </template>
                    {{ theme }}
                </UiButton>
            </div>
            <h1>{{ size }} plain</h1>
            <div class="flex flex-wrap gap-4 mb-4">
                <UiButton plain v-for="theme in themes" :type="theme" :size="size">{{ theme }}</UiButton>
            </div>
            <h1>{{ size }} text</h1>
            <div class="flex flex-wrap gap-4 mb-4">
                <UiButton text v-for="theme in themes" :type="theme" :size="size">{{ theme }}</UiButton>
            </div>
        </template>
        <div class="flex flex-wrap gap-4 mb-4">
            <UiButton disabled v-for="theme, index in themes" :type="theme">
                <template #icon>
                    <component :is="icons[index]" />
                </template>
                {{ theme }}
            </UiButton>
        </div>
    </div>

    <div class="flex flex-wrap gap-4 mb-4">
        <el-slider-optional v-model:value="value1" optional-direction="max" optional-text="No Limit"/>
        <el-slider-optional v-model:value="value2" optional-direction="min" />
    </div>
</template>
<style>
.n-button:not(.n-button--disabled):focus {
    outline: none;
    background-color: var(--n-color);
    color: var(--n-text-color);
}

.n-button:not(.n-button--disabled):focus .n-button__state-border {
    /* display: none; */
    border: var(--n-border);
}

.n-button:not(.n-button--disabled):hover {
    color: var(--n-text-color-hover);
    background-color: var(--n-color-hover);
}

.n-button:not(.n-button--disabled):hover .n-button__state-border {
    /* display: none; */

    border: var(--n-border-hover);
}
</style>
<script setup>

import { ref, watch } from 'vue';
import ElSliderOptional from '../ui/ElSliderOptional.vue'
const value1 = ref(50);
const value2 = ref(50);

import UiButton from '../ui/UiButton.vue';
// 图标导入
import {
    SettingsTwotone,
    FormatListBulletedSharp,
    MoreVertOutlined,
    FileDownloadOutlined,
    DeleteTwotone,
    FileUploadOutlined
} from "@vicons/material";

const icons = [
    SettingsTwotone,
    FormatListBulletedSharp,
    MoreVertOutlined,
    FileDownloadOutlined,
    DeleteTwotone,
    FileUploadOutlined
]

const sizes = [
    'small',
    'medium',
    'large',
];
const themes = [
    'default',
    'Primary',
    'Secondary',
    // 'Tertiary',
    'Error',
    'Warning',
];
</script>