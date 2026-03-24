<!-- subcomponents/ChatHeader.vue -->
<template>
    <div class="flex items-center justify-center py-2 px-5">
        <div class="">
            <el-button text @click="$emit('toggle-sidebar')" :class="{ 'lg:hidden': sidebarVisible }">
                <template #icon>
                    <FormatListBulletedSharp />
                </template>
            </el-button>
        </div>

        <div class="flex items-center lg:flex-1 justify-end">
            <el-dropdown trigger="hover" @command="handleSelect" v-if="hasMoreOptions">
                <el-button class="more-btn" text title="更多操作">
                    <MoreVertOutlined class="w-5.5 h-5.5" />
                </el-button>
                <template #dropdown>
                    <el-dropdown-menu>
                        <el-dropdown-item command="clear">
                            <DeleteTwotone class="w-4 h-4 mr-2 inline-block" />
                            清空记录
                        </el-dropdown-item>
                        <el-dropdown-item command="export">
                            <FileDownloadOutlined class="w-4 h-4 mr-2 inline-block" />
                            导出记录
                        </el-dropdown-item>
                        <el-dropdown-item command="import">
                            <FileUploadOutlined class="w-4 h-4 mr-2 inline-block" />
                            导入记录
                        </el-dropdown-item>
                    </el-dropdown-menu>
                </template>
            </el-dropdown>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import {
    FormatListBulletedSharp,
    MoreVertOutlined,
    DeleteTwotone,
    FileDownloadOutlined,
    FileUploadOutlined
} from "@vicons/material";

// Element Plus 组件导入
import {
    ElButton,
    ElDropdown,
    ElDropdownMenu,
    ElDropdownItem
} from 'element-plus';

const props = defineProps({
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
    'select-more-option'
]);

const handleSelect = (command) => {
    emit('select-more-option', command);
};
</script>