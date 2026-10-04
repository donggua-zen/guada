<template>
    <div class="p-4">
        <template v-for="size in sizes" :key="size">
            <h1>{{ size }}</h1>
            <div class="flex flex-wrap gap-4 mb-4">
                <GdButton v-for="theme in themes" :key="theme" :type="theme" :size="size">{{ theme }}</GdButton>
            </div>
            <div class="flex flex-wrap gap-4 mb-4">
                <GdButton v-for="theme, index in themes" :key="theme" :type="theme" :size="size">
                    <template #icon>
                        <component :is="icons[index]" />
                    </template>
                    {{ theme }}
                </GdButton>
            </div>
            <h1>{{ size }} plain</h1>
            <div class="flex flex-wrap gap-4 mb-4">
                <GdButton plain v-for="theme in themes" :key="theme" :type="theme" :size="size">{{ theme }}</GdButton>
            </div>
            <h1>{{ size }} text</h1>
            <div class="flex flex-wrap gap-4 mb-4">
                <GdButton text v-for="theme in themes" :key="theme" :type="theme" :size="size">{{ theme }}</GdButton>
            </div>
        </template>
        <div class="flex flex-wrap gap-4 mb-4">
            <GdButton disabled v-for="theme, index in themes" :key="theme" :type="theme">
                <template #icon>
                    <component :is="icons[index]" />
                </template>
                {{ theme }}
            </GdButton>
        </div>
    </div>

    <div class="flex flex-wrap gap-4 mb-4">
        <gd-slider-optional v-model:value="value1" optional-direction="max" optional-text="No Limit"/>
        <gd-slider-optional v-model:value="value2" optional-direction="min" />
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
import GdSliderOptional from '../ui/GdSliderOptional.vue'
const value1 = ref(50);
const value2 = ref(50);

import GdButton from '../ui/GdButton.vue';
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