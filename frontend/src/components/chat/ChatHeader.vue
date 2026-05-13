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
                @click="handleOpenWorkspace" title="打开工作目录">
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
    ElDropdownItem,
    ElMessage
} from 'element-plus';

// Element Plus 图标导入
import { Reading, FolderOpened } from '@element-plus/icons-vue';

import LeftBarIcon from '../icons/LeftBarIcon.vue';
import { apiService } from '@/services/ApiService';

// Props - 类型化
const props = defineProps<{
    sidebarVisible?: boolean;
    hasMoreOptions?: boolean;
    showMemoButton?: boolean;
    title?: string;
    sessionId?: string; // 新增：会话 ID
}>();

// Emits - 类型化
const emit = defineEmits<{
    'toggle-sidebar': []
    'toggle-memo': []
    'select-more-option': [command: string]
}>();

// 判断是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

const handleSelect = (command: string): void => {
    emit('select-more-option', command);
};

/**
 * 打开工作目录
 */
const handleOpenWorkspace = async (): Promise<void> => {
    if (!props.sessionId) {
        ElMessage.warning('当前没有活动的会话');
        return;
    }

    try {
        // 1. 从后端获取工作目录路径
        const response = await apiService.getWorkspacePath(props.sessionId);
        const workspacePath = response.workspacePath;

        // 2. 调用 Electron 接口打开文件夹
        if ((window as any).electronAPI?.openFolder) {
            const result = await (window as any).electronAPI.openFolder(workspacePath);
            if (!result.success) {
                ElMessage.error(`打开工作目录失败: ${result.error}`);
            }
        } else {
            ElMessage.error('当前环境不支持打开文件夹');
        }
    } catch (error: any) {
        console.error('获取工作目录失败:', error);
        ElMessage.error(error.message || '获取工作目录失败');
    }
};
</script>