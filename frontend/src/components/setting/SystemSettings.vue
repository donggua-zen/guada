<template>
    <div class="h-full">
        <PageHeader  title="系统设置" />
        <div class="h-full flex flex-col md:max-w-220 md:mx-auto">
            <div class="flex-1 overflow-hidden flex flex-col ">
                <div class="p-4">
                    <el-tabs v-model="currentTabValue" @tab-change="handleTabChange" class="system-settings-tabs">
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
                    <ScrollContainer class="h-full  p-4">
                        <template v-if="currentTabValue === 'general'">
                            <GeneralSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'default-models'">
                            <DefaultModelSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'ocr'">
                            <OcrSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'appearance'">
                            <AppearanceSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'about'">
                            <AboutPanel />
                        </template>
                    </ScrollContainer>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { ElTabs, ElTabPane } from 'element-plus'
import DefaultModelSettings from './DefaultModelSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import OcrSettings from './OcrSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AboutPanel from '../plugins/AboutPanel.vue'

import {
    Grid16Regular,
    Settings16Regular,
    ScanText24Regular,
    Info24Regular,
    Image24Regular
} from '@vicons/fluent'

import { useAuthStore } from '../../stores/auth'
import PageHeader from '@/components/PageHeader.vue'
import { useRouter, useRoute } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

// 系统设置 Tab 菜单
const sidebarItems = [
    {
        label: '通用设置',
        path: 'general',
        icon: Settings16Regular,
        roles: ['primary'],
    },
    {
        label: '默认模型',
        path: 'default-models',
        icon: Grid16Regular,
        roles: ['primary'],
    },
    {
        label: 'OCR 设置',
        path: 'ocr',
        icon: ScanText24Regular,
        roles: ['primary'],
    },
    {
        label: '外观',
        path: 'appearance',
        icon: Image24Regular,
        roles: ['primary'],
    },
    {
        label: '关于',
        path: 'about',
        icon: Info24Regular,
        roles: ['primary'],
    },
]

// 根据用户角色过滤菜单项
const filteredSidebarItems = computed(() => {
    const userRole = authStore.user?.role || 'primary'
    return sidebarItems.filter(item => !item.roles || item.roles.includes(userRole))
})

// Tab 数据（用于模板渲染）
const tabItems = computed(() => filteredSidebarItems.value)

// 获取默认标签页
const getDefaultTabPath = () => {
    const userRole = authStore.user?.role || 'primary'
    const firstValidItem = filteredSidebarItems.value.find(item => {
        if (!item.roles || item.roles.includes(userRole)) {
            return item.path
        }
        return false
    })
    return firstValidItem?.path || 'general'
}

const currentTabValue = ref(getDefaultTabPath())

// Tab 切换处理
const handleTabChange = (tabName: string | number) => {
    const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
    router.replace({ name: 'SystemSettings', params: { tab: tabPath } })
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
        router.replace({ name: 'SystemSettings', params: { tab: defaultTab } })
    } else {
        // 确保 route.params.tab 是字符串类型
        const tabParam = Array.isArray(route.params.tab) ? route.params.tab[0] : (route.params.tab as string)
        currentTabValue.value = tabParam
    }
})
</script>

<style scoped>
.system-settings-tabs :deep(.el-tabs__header) {
    margin-bottom: 0;
}

.system-settings-tabs :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
}

.system-settings-tabs :deep(.el-tabs__item) {
    padding: 0 18px;
    height: 44px;
    line-height: 44px;
    font-size: 14px;
}
</style>
