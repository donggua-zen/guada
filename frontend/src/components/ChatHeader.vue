<!-- subcomponents/ChatHeader.vue -->
<template>
    <div class="flex items-center justify-center py-2 px-5">
        <div class="">
            <UiButton text @click="$emit('toggle-sidebar')" :class="{ 'lg:hidden': sidebarVisible }">
                <template #icon>
                    <FormatListBulletedSharp />
                </template>
            </UiButton>
        </div>

        <UiButton text class="lg:mx-0 mx-auto" @click="$emit('open-switch-model', $event)">
            {{ currentModelName }}
            <SettingsTwotone class="w-4 h-4 ml-2" />
        </UiButton>

        <div class="flex items-center lg:flex-1 justify-end">
            <UiButton text @click="toggleDark">
                <template #icon>
                    <WbSunnyTwotone v-if="isDark" class="w-5 h-5" />
                    <NightlightRound v-else class="w-5 h-5" />
                </template>
                {{ isDark ? '亮色' : '暗色' }}
            </UiButton>

            <n-dropdown trigger="hover" :options="moreOptions" @select="handleSelect" v-if="hasMoreOptions">
                <UiButton class="more-btn" :border="false" title="更多操作" text>
                    <MoreVertOutlined class="w-5.5 h-5.5" />
                </UiButton>
            </n-dropdown>
        </div>
    </div>
</template>

<script setup>
import { ref, h } from 'vue';
import { NDropdown, NIcon } from "naive-ui";
import { UiButton } from "./ui";
// 主题
import { useTheme } from "../composables/useTheme";
const { isDark, toggleDark } = useTheme()
import {
    SettingsTwotone,
    FormatListBulletedSharp,
    MoreVertOutlined,
    DeleteTwotone,
    FileDownloadOutlined,
    FileUploadOutlined,
    WbSunnyTwotone,
    NightlightRound
} from "@vicons/material";

const props = defineProps({
    currentModelName: {
        type: String,
        required: true
    },
    sidebarVisible: {
        type: Boolean,
    },
    hasMoreOptions: {
        type: Boolean,
        default: true
    }
});

const emit = defineEmits([
    'toggle-sidebar',
    'open-switch-model',
    'select-more-option'
]);

// 更多操作下拉菜单选项
const moreOptions = ref([
    {
        label: "清空记录",
        key: "clear",
        icon: () => h(NIcon, null, { default: () => h(DeleteTwotone) })
    },
    {
        label: "导出记录",
        key: "export",
        icon: () => h(NIcon, null, { default: () => h(FileDownloadOutlined) })
    },
    {
        label: "导入记录",
        key: "import",
        icon: () => h(NIcon, null, { default: () => h(FileUploadOutlined) })
    }
]);

const handleSelect = (key) => {
    emit('select-more-option', key);
};
</script>