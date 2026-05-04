<template>
    <div class="bg-(--color-sidebar-bg) h-full">
        <div class="h-full flex flex-col md:max-w-260 md:mx-auto p-4">
            <div class="flex-1 overflow-hidden flex flex-col">
                <div class="border-gray-200 dark:border-[#232428]">
                    <el-tabs v-model="currentTabValue" @tab-change="handleTabChange" class="plugins-settings-tabs">
                        <el-tab-pane v-for="item in tabItems" :key="item.path" :label="item.label" :name="item.path">
                            <template #label>
                                <div class="flex items-center gap-2">
                                    <component :is="item.icon" class="w-[17px] h-[17px]"></component>
                                    <span class="text-[15px]">{{ item.label }}</span>
                                </div>
                            </template>
                        </el-tab-pane>
                    </el-tabs>
                </div>
                <div class="flex-1 overflow-hidden py-3 md:py-3">
                    <template v-if="currentTabValue === 'mcp'">
                        <MCPServers />
                    </template>
                    <template v-else-if="currentTabValue === 'local-tools'">
                        <LocalTools />
                    </template>
                    <template v-else-if="currentTabValue === 'skills'">
                        <Skills />
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { ElTabs, ElTabPane } from 'element-plus'
import MCPServers from './MCPServers.vue'
import LocalTools from './LocalTools.vue'
import Skills from './Skills.vue'

import {
    Dumbbell16Regular,
    WrenchScrewdriver24Regular,
    Code24Regular
} from '@vicons/fluent'

import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

// 插件设置 Tab 菜单
const sidebarItems = [
    {
        label: 'MCP 服务器',
        path: 'mcp',
        icon: Dumbbell16Regular,
    },
    {
        label: '本地工具',
        path: 'local-tools',
        icon: WrenchScrewdriver24Regular,
    },
    {
        label: 'Skills',
        path: 'skills',
        icon: Code24Regular,
    },
]

// Tab 数据（用于模板渲染）
const tabItems = computed(() => sidebarItems)

// 获取默认标签页
const getDefaultTabPath = () => {
    return sidebarItems[0]?.path || 'mcp'
}

const currentTabValue = ref(getDefaultTabPath())

// Tab 切换处理
const handleTabChange = (tabName: string | number) => {
    const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
    router.replace({ name: 'Plugins', params: { tab: tabPath } })
}

// 监听路由参数变化
watch(() => route.params.tab, (newPath) => {
    // 确保 newPath 是字符串类型
    const tabPath = Array.isArray(newPath) ? newPath[0] : (newPath as string)
    if (tabPath && tabPath !== currentTabValue.value) {
        currentTabValue.value = tabPath
    }
})

onMounted(() => {
    // 如果没有路由参数，则跳转到默认标签页
    if (!route.params.tab) {
        const defaultTab = getDefaultTabPath()
        router.replace({ name: 'Plugins', params: { tab: defaultTab } })
    } else {
        // 确保 route.params.tab 是字符串类型
        const tabParam = Array.isArray(route.params.tab) ? route.params.tab[0] : (route.params.tab as string)
        currentTabValue.value = tabParam
    }
})
</script>

<style scoped>
.plugins-settings-tabs :deep(.el-tabs__header) {
    margin-bottom: 0;
}

.plugins-settings-tabs :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
}

.plugins-settings-tabs :deep(.el-tabs__item) {
    padding: 0 18px;
    height: 44px;
    line-height: 44px;
    font-size: 14px;
}
</style>
