<template>
    <div class="h-full flex">
        <Teleport v-if="portalReady" to="#settings-sidebar-portal">
            <!-- 设置侧边栏：Teleport 到全局侧边栏位置以复用侧边栏背景与透明度 -->
            <div
                class="h-full sidebar-transparent-bg global-sidebar flex flex-col overflow-hidden">
                <!-- macOS：侧边栏按钮为整行铺满无法左预留，顶部腾出 28px 给红绿灯 -->
                <div v-if="isMac" class="h-7 shrink-0 drag-region"></div>
                <!-- 返回应用 -->
                <div class="px-3 pt-3 pb-2">
                    <div @click="goBack"
                        class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:bg-(--gd-color-sidebar-bg-hover) hover:text-(--gd-color-sidebar-text-hover) transition-all duration-200">
                        <ArrowBackIosNewTwotone class="w-4 h-4" />
                        <span>{{ t('settings.system.backToApp') }}</span>
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
                                    ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
                                    : 'text-(--gd-color-text) hover:bg-(--gd-color-sidebar-bg-hover) hover:text-(--gd-color-sidebar-text-hover)'">
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
                    <span class="text-sm text-gray-400 dark:text-gray-500">{{ t('settings.system.title') }}</span>
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
                        <template v-else-if="currentTabValue === 'community'">
                            <CommunityPanel />
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
                        <template v-else-if="isPluginTab">
                            <component
                                :is="activePluginItem?._item.component"
                                v-bind="activePluginItem?._item.props"
                            />
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
import CommunityPanel from './CommunityPanel.vue'
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
    Chat24Regular,
} from '@vicons/fluent'

import { ArrowBackIosNewTwotone, PersonOutlineOutlined, VerifiedUserOutlined } from '@vicons/material'

import { useAuthStore } from '../../stores/auth'
import PageHeader from '@/components/PageHeader.vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePluginSlots } from '../../stores/pluginSlots'
import { PuzzleCube20Regular, PuzzleCube24Regular } from '@vicons/fluent'

const { t } = useI18n()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

// 设置项分组映射
const groupMap = computed<Record<string, string>>(() => ({
    general: t('settings.system.groups.general'),
    'default-models': t('settings.system.groups.general'),
    ocr: t('settings.system.groups.general'),
    browser: t('settings.system.groups.general'),
    connections: t('settings.system.groups.general'),
    appearance: t('settings.system.groups.personalization'),
    search: t('settings.system.groups.personalization'),
    about: t('settings.system.groups.system'),
    community: t('settings.system.groups.system'),
    'session-groups': t('settings.system.groups.dataManagement'),
    'session-archived': t('settings.system.groups.dataManagement'),
    plugin: t('settings.system.groups.system'),
    profile: t('settings.system.groups.account'),
    security: t('settings.system.groups.account'),
}))

// ── 插件 slots（v2）：把已启用插件的设置页并入侧边栏 ──
const pluginSlots = usePluginSlots()
onMounted(() => pluginSlots.init())
const pluginSidebarItems = computed(() =>
  pluginSlots
    .resolve('settings')
    .filter((item) => item.meta?.label)
    .map((item) => ({
      label: item.meta.label,
      path: `plugin:${item.pluginId}:${item.component}`,
      icon: PuzzleCube20Regular,
      _item: item,
    })),
)

// 设置项菜单
const sidebarItems = computed(() => [
    {
        label: t('settings.system.tabs.general'),
        path: 'general',
        icon: Settings16Regular,
    },
    {
        label: t('settings.system.tabs.defaultModels'),
        path: 'default-models',
        icon: Grid16Regular,
    },
    {
        label: t('settings.system.tabs.ocr'),
        path: 'ocr',
        icon: ScanText24Regular,
    },
    {
        label: t('settings.system.tabs.appearance'),
        path: 'appearance',
        icon: Image24Regular,
    },
    {
        label: t('settings.system.tabs.search'),
        path: 'search',
        icon: Search16Regular,
    },
    {
        label: t('settings.system.tabs.browser'),
        path: 'browser',
        icon: Globe24Regular,
    },
    {
        label: t('settings.system.tabs.about'),
        path: 'about',
        icon: Info24Regular,
    },
    {
        label: t('settings.system.tabs.community'),
        path: 'community',
        icon: Chat24Regular,
    },
    {
        label: t('settings.system.tabs.connections'),
        path: 'connections',
        icon: Cloud24Regular,
    },
    {
        label: t('settings.system.tabs.sessionGroups'),
        path: 'session-groups',
        icon: Folder20Regular,
    },
    {
        label: t('settings.system.tabs.sessionArchived'),
        path: 'session-archived',
        icon: Archive20Regular,
    },
    {
        label: t('settings.system.tabs.profile'),
        path: 'profile',
        icon: PersonOutlineOutlined,
    },
    {
        label: t('settings.system.tabs.security'),
        path: 'security',
        icon: VerifiedUserOutlined,
    },
])

// 单账户：菜单全量显示（原按 role 过滤已移除）
const filteredSidebarItems = computed(() => [
    ...sidebarItems.value,
    ...pluginSidebarItems.value,
])

// 按分组组织侧边栏项
const groupedSidebarItems = computed(() => {
    const items = filteredSidebarItems.value
    const groupOrder = [
        t('settings.system.groups.general'),
        t('settings.system.groups.personalization'),
        t('settings.system.groups.dataManagement'),
        t('settings.system.groups.account'),
        t('settings.system.groups.system'),
    ]
    const groups: Record<string, typeof items> = {}
    for (const g of groupOrder) groups[g] = []
    for (const item of items) {
        const g = groupMap.value[item.path] || t('settings.system.groups.system')
        if (!groups[g]) groups[g] = []
        groups[g].push(item)
    }
    return groupOrder
        .filter(g => groups[g].length > 0)
        .map(g => ({ label: g, items: groups[g] }))
})

// 获取默认标签页
const getDefaultTabPath = () => {
    return filteredSidebarItems.value[0]?.path || 'general'
}

const currentTabValue = ref(getDefaultTabPath())
// ── 插件 slots（v2）：当前激活的插件 tab ──
const isPluginTab = computed(() => currentTabValue.value.startsWith('plugin:'))
const activePluginItem = computed(() =>
  pluginSidebarItems.value.find((i) => i.path === currentTabValue.value),
)

const isMac = typeof window !== 'undefined' &&
  window.electronAPI !== undefined &&
  window.electronAPI.platform === 'darwin'

// Teleport 目标就绪标志：确保 #settings-sidebar-portal 已挂载到 DOM
const portalReady = ref(false)

// 当前标签标题
const currentTabLabel = computed(() => {
    const item = filteredSidebarItems.value.find(i => i.path === currentTabValue.value)
    return item?.label || t('settings.system.settings')
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

<style scoped>
/* 顶部红绿灯预留区可拖拽窗口 */
.drag-region {
  -webkit-app-region: drag;
}
</style>
