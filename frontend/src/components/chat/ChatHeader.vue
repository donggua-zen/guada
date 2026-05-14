<!-- subcomponents/ChatHeader.vue -->
<template>
    <div class="flex items-center justify-between gap-4 px-3 h-13">
        <!-- 左侧：侧边栏切换按钮 -->
        <div class="flex items-center justify-start min-w-10 ">
            <div v-if="sidebarVisible !== undefined"
                class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] active:translate-x-0"
                @click="$emit('toggle-sidebar')" :title="sidebarVisible ? '收起侧边栏' : '展开侧边栏'">
                <LeftBarIcon class="w-5 h-5" />
            </div>
        </div>

        <!-- 中间：标题区域（可选） -->
        <div v-if="title" class="flex items-center justify-center flex-1 min-w-0">
            <h2 class="text-base font-semibold text-gray-800 dark:text-[#e8e9ed] m-0 truncate">{{ title }}</h2>
        </div>

        <!-- 右侧：更多操作下拉菜单 -->
        <div class="flex items-center justify-end min-w-10 gap-2">
            <!-- 工作目录按钮（仅 Electron 环境且有会话时显示） -->
            <div v-if="isElectron && sessionId"
                class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] flex items-center justify-center"
                @click="$emit('toggle-workspace')" 
                :title="workspaceVisible ? '关闭工作目录' : '打开工作目录'">
                <el-icon class="w-5 h-5">
                    <FolderOpened />
                </el-icon>
            </div>

            <!-- 记忆管理按钮 -->
            <div v-if="showMemoButton"
                class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] flex items-center justify-center"
                @click="$emit('toggle-memo')" title="记忆管理">
                <el-icon class="w-5 h-5">
                    <Reading />
                </el-icon>
            </div>

            <el-dropdown v-if="hasMoreOptions" trigger="hover" @command="handleSelect"
                popper-class="chat-header-dropdown">
                <div class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] active:rotate-0 flex items-center justify-center"
                    text title="更多操作">
                    <MoreVertOutlined class="w-5 h-5" />
                </div>
                <template #dropdown>
                    <el-dropdown-menu>
                        <el-dropdown-item command="clear">
                            <span class="flex items-center gap-2">
                                <DeleteTwotone class="w-4 h-4" />
                                <span>清空记录</span>
                            </span>
                        </el-dropdown-item>
                        <el-dropdown-item command="export">
                            <span class="flex items-center gap-2">
                                <FileDownloadOutlined class="w-4 h-4" />
                                <span>导出记录</span>
                            </span>
                        </el-dropdown-item>
                        <el-dropdown-item command="import">
                            <span class="flex items-center gap-2">
                                <FileUploadOutlined class="w-4 h-4" />
                                <span>导入记录</span>
                            </span>
                        </el-dropdown-item>
                    </el-dropdown-menu>
                </template>
            </el-dropdown>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    FormatListBulletedSharp,
    MoreVertOutlined,
    DeleteTwotone,
    FileDownloadOutlined,
    FileUploadOutlined
} from "@vicons/material";

// Element Plus 组件导入
import {
    ElDropdown,
    ElDropdownMenu,
    ElDropdownItem
} from 'element-plus';

// Element Plus 图标导入
import { Reading, FolderOpened } from '@element-plus/icons-vue';

import LeftBarIcon from '../icons/LeftBarIcon.vue';

// Props - 类型化
const props = defineProps<{
    sidebarVisible?: boolean;
    hasMoreOptions?: boolean;
    showMemoButton?: boolean;
    title?: string;
    sessionId?: string;
    workspaceVisible?: boolean; // 新增：工作目录可见性状态
}>();

// Emits - 类型化
const emit = defineEmits<{
    'toggle-sidebar': []
    'toggle-memo': []
    'toggle-workspace': [] // 新增：切换工作目录
    'select-more-option': [command: string]
}>();

// 判断是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const handleSelect = (command: string): void => {
    emit('select-more-option', command);
};
</script>