<template>
    <div class="h-full flex">
        <Teleport v-if="portalReady" to="#settings-sidebar-portal">
            <!-- 设置侧边栏：Teleport 到全局侧边栏位置以获得毛玻璃效果 -->
            <div
                class="h-full sidebar-transparent-bg global-sidebar flex flex-col overflow-hidden shadow-[inset_-4px_0_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_-4px_0_12px_rgba(0,0,0,0.3)]">
                <!-- 返回应用 -->
                <div class="px-3 pt-3 pb-2">
                    <div @click="goBack"
                        class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover) transition-all duration-200">
                        <ArrowBackIosNewTwotone class="w-4 h-4" />
                        <span>返回应用</span>
                    </div>
                </div>
                <!-- 分组列表 -->
                <ScrollContainer class="flex-1 py-3">
                    <div v-for="group in groupedSidebarItems" :key="group.label" class="mb-2">
                        <div
                            class="px-4 pt-2 pb-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                            {{ group.label }}
                        </div>
                        <div class="px-2 space-y-1">
                            <div v-for="item in group.items" :key="item.path" @click="handleItemClick(item.path)"
                                class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-200"
                                :class="currentTabValue === item.path
                                    ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
                                    : 'text-(--color-text) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
                                <component :is="item.icon" class="w-4.5 h-4.5 shrink-0" />
                                <span class="text-sm font-medium">{{ item.label }}</span>
                            </div>
                        </div>
                    </div>
                </ScrollContainer>
            </div>
        </Teleport>

        <!-- 内容区 -->
        <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
            <PageHeader>
                <template #title>
                    <span class="text-sm text-gray-400 dark:text-gray-500">系统设置</span>
                    <span class="text-sm text-gray-300 dark:text-gray-600 mx-1.5">·</span>
                    <span class="text-sm font-semibold text-gray-800 dark:text-[#e8e9ed]">{{ currentTabLabel }}</span>
                </template>
            </PageHeader>
            <div class="flex-1 overflow-hidden flex flex-col md:max-w-220 md:mx-auto w-full">
                <div class="flex-1 overflow-hidden py-3">
                    <ScrollContainer class="h-full p-4">
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
                        <template v-else-if="currentTabValue === 'search'">
                            <SearchSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'browser'">
                            <BrowserSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'about'">
                            <AboutPanel />
                        </template>
                        <template v-else-if="currentTabValue === 'session-groups'">
                            <SessionGroupManage />
                        </template>
                        <template v-else-if="currentTabValue === 'session-archived'">
                            <ArchivedSessions />
                        </template>
                        <template v-else-if="currentTabValue === 'profile'">
                            <UserProfile />
                        </template>
                        <template v-else-if="currentTabValue === 'security'">
                            <UserSecurity />
                        </template>
                        <template v-else-if="currentTabValue === 'connections'">
                            <ConnectionSettings />
                        </template>
                    </ScrollContainer>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import DefaultModelSettings from './DefaultModelSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import OcrSettings from './OcrSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import SearchSettings from './SearchSettings.vue'
import BrowserSettings from './BrowserSettings.vue'
import AboutPanel from '../plugins/AboutPanel.vue'
import SessionGroupManage from './SessionGroupManage.vue'
import ArchivedSessions from './ArchivedSessions.vue'
import UserProfile from './UserProfile.vue'
import UserSecurity from './UserSecurity.vue'
import ConnectionSettings from './ConnectionSettings.vue'
import ScrollContainer from '../ui/ScrollContainer.vue'

import {
    Grid16Regular,
    Settings16Regular,
    ScanText24Regular,
    Info24Regular,
    Image24Regular,
    Search16Regular,
    Globe24Regular,
    Folder20Regular,
    Archive20Regular,
    Cloud24Regular,
} from '@vicons/fluent'

import { ArrowBackIosNewTwotone, PersonOutlineOutlined, VerifiedUserOutlined } from '@vicons/material'

import { useAuthStore } from '../../stores/auth'
import PageHeader from '@/components/PageHeader.vue'
import { useRouter, useRoute } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

// 设置项分组映射
const groupMap: Record<string, string> = {
    general: '常规',
    'default-models': '常规',
    ocr: '常规',
    appearance: '个性化',
    search: '个性化',
    browser: '系统',
    about: '系统',
    'session-groups': '数据管理',
    'session-archived': '数据管理',
    connections: '系统',
    profile: '账户',
    security: '账户',
}

// 设置项菜单
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
        label: '搜索设置',
        path: 'search',
        icon: Search16Regular,
        roles: ['primary'],
    },
    {
        label: '浏览器',
        path: 'browser',
        icon: Globe24Regular,
        roles: ['primary'],
    },
    {
        label: '关于',
        path: 'about',
        icon: Info24Regular,
        roles: ['primary'],
    },
    {
        label: '远程连接',
        path: 'connections',
        icon: Cloud24Regular,
        roles: ['primary'],
    },
    {
        label: '分组管理',
        path: 'session-groups',
        icon: Folder20Regular,
        roles: ['primary'],
    },
    {
        label: '归档管理',
        path: 'session-archived',
        icon: Archive20Regular,
        roles: ['primary'],
    },
    {
        label: '账户概览',
        path: 'profile',
        icon: PersonOutlineOutlined,
        roles: ['primary', 'subaccount'],
    },
    {
        label: '安全设置',
        path: 'security',
        icon: VerifiedUserOutlined,
        roles: ['primary', 'subaccount'],
    },
]

// 根据用户角色过滤菜单项
const filteredSidebarItems = computed(() => {
    const userRole = authStore.user?.role || 'primary'
    return sidebarItems.filter(item => !item.roles || item.roles.includes(userRole))
})

// 按分组组织侧边栏项
const groupedSidebarItems = computed(() => {
    const items = filteredSidebarItems.value
    const groupOrder = ['常规', '个性化', '系统', '数据管理', '账户']
    const groups: Record<string, typeof items> = {}
    for (const g of groupOrder) groups[g] = []
    for (const item of items) {
        const g = groupMap[item.path] || '常规'
        if (!groups[g]) groups[g] = []
        groups[g].push(item)
    }
    return groupOrder
        .filter(g => groups[g].length > 0)
        .map(g => ({ label: g, items: groups[g] }))
})

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

// Teleport 目标就绪标志：确保 #settings-sidebar-portal 已挂载到 DOM
const portalReady = ref(false)

// 当前标签标题
const currentTabLabel = computed(() => {
    const item = filteredSidebarItems.value.find(i => i.path === currentTabValue.value)
    return item?.label || '设置'
})

// 点击侧边栏项
const handleItemClick = (path: string) => {
    currentTabValue.value = path
    router.replace({ name: 'SystemSettings', params: { tab: path } })
}

// 返回应用
const goBack = () => {
    router.replace({ name: 'Chat', params: { sessionId: 'new-session' } })
}

// 监听路由参数变化
watch(() => route.params.tab, (newPath) => {
    const tabPath = Array.isArray(newPath) ? newPath[0] : (newPath as string)
    if (tabPath && tabPath !== currentTabValue.value) {
        currentTabValue.value = tabPath
    }
})

onMounted(() => {
    if (!route.params.tab) {
        const defaultTab = getDefaultTabPath()
        router.replace({ name: 'SystemSettings', params: { tab: defaultTab } })
    } else {
        const tabParam = Array.isArray(route.params.tab) ? route.params.tab[0] : (route.params.tab as string)
        currentTabValue.value = tabParam
    }
    // 等待 DOM 提交完成后再启用 Teleport，避免刷新时目标尚未插入 document
    nextTick(() => {
        portalReady.value = !!document.getElementById('settings-sidebar-portal')
    })
})
</script>
