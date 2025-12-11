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
</template>
<script setup>
import { UiButton } from '../ui';
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
    'Tertiary',
    'Error',
    'Warning',
];
</script>