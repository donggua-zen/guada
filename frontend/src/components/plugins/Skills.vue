<template>
    <div class="flex-1 overflow-hidden">
        <!-- 头部区域 -->
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
            <span>Skills</span>
        </div>

        <!-- 占位内容 -->
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-[#1e1e1e]">
            <div class="p-12 text-center">
                <el-icon size="64" class="mb-4 opacity-50 text-gray-400">
                    <ConstructionOutlined />
                </el-icon>
                <div class="text-xl font-medium text-gray-600 dark:text-gray-300 mb-2">
                    正在开发中
                </div>
                <div class="text-sm text-gray-500 dark:text-gray-400">
                    Skills 功能即将上线，敬请期待...
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus'
import { ConstructionOutlined } from '@vicons/material'
</script>
