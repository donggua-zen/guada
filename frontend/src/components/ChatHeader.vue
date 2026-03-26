<!-- subcomponents/ChatHeader.vue -->
<template>
    <div class="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200/60">
        <!-- 左侧：侧边栏切换按钮 -->
        <div class="flex items-center justify-start min-w-10">
            <el-button 
                v-if="sidebarVisible !== undefined" 
                class="p-2 rounded-lg text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-900 active:translate-x-0 lg:hidden"
                text 
                @click="$emit('toggle-sidebar')"
                :title="sidebarVisible ? '收起侧边栏' : '展开侧边栏'"
            >
                <template #icon>
                    <FormatListBulletedSharp class="w-5 h-5" />
                </template>
            </el-button>
        </div>

        <!-- 中间：标题区域（可选） -->
        <div v-if="title" class="flex items-center justify-center flex-1 min-w-0">
            <h2 class="text-base font-semibold text-gray-800 m-0 truncate">{{ title }}</h2>
        </div>

        <!-- 右侧：更多操作下拉菜单 -->
        <div class="flex items-center justify-end min-w-10">
            <el-dropdown 
                v-if="hasMoreOptions" 
                trigger="hover" 
                @command="handleSelect"
                popper-class="chat-header-dropdown"
            >
                <el-button class="p-2 rounded-lg text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-900 active:rotate-0" text title="更多操作">
                    <MoreVertOutlined class="w-5 h-5" />
                </el-button>
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

<script setup>
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
        default: undefined
    },
    hasMoreOptions: {
        type: Boolean,
        default: true
    },
    title: {
        type: String,
        default: ''
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



<style>
/* 全局下拉菜单样式 */
.chat-header-dropdown .el-dropdown-menu {
    padding: 8px 0;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1), 0 4px 12px rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.08);
}

.chat-header-dropdown .el-dropdown-menu__item {
    padding: 10px 16px;
    margin: 4px 8px;
    border-radius: 8px;
    transition: all 0.2s ease;
    font-size: 14px;
    color: #374151;
}

.chat-header-dropdown .el-dropdown-menu__item > span {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
}

.chat-header-dropdown .el-dropdown-menu__item:hover {
    background: #f3f4f6;
    color: #1f2937;
}

.chat-header-dropdown .el-dropdown-menu__item .v-icon {
    opacity: 0.8;
    transition: opacity 0.2s ease;
    display: inline-flex;
    flex-shrink: 0;
}

.chat-header-dropdown .el-dropdown-menu__item:hover .v-icon {
    opacity: 1;
}

/* 确保图标可见性 */
.chat-header-dropdown .el-dropdown-menu__item svg {
    display: block;
    width: 1em;
    height: 1em;
}
</style>