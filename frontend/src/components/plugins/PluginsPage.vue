<template>
    <div class="h-full overflow-hidden flex flex-col">
        <PageHeader :title="t('plugins.page.title')" />
        <div class="flex-1 flex flex-col overflow-hidden">
            <div class="shrink-0 px-4 w-full md:max-w-260 md:mx-auto">
                <GdTabs v-model="currentTabValue" :tabs="gdTabs" @change="handleTabChange" />
            </div>
            <div class="flex-1 overflow-auto pb-4" style="scrollbar-gutter: stable both-edges;">
                <div class="py-3 px-4 w-full md:max-w-260 md:mx-auto">
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
import { useI18n } from 'vue-i18n'
import MCPServers from './MCPServers.vue'
import LocalTools from './LocalTools.vue'
import Skills from './Skills.vue'

import {
    Dumbbell16Regular,
    WrenchScrewdriver24Regular,
    Code24Regular
} from '@vicons/fluent'

import PageHeader from '@/components/PageHeader.vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()

// 插件设置 Tab 菜单
const sidebarItems = computed(() => [
    {
        label: t('plugins.page.tabLocalTools'),
        path: 'local-tools',
        icon: WrenchScrewdriver24Regular,
    },
    {
        label: t('plugins.page.tabSkills'),
        path: 'skills',
        icon: Code24Regular,
    },
    {
        label: t('plugins.page.tabMcp'),
        path: 'mcp',
        icon: Dumbbell16Regular,
    },
])

// Tab 数据（用于模板渲染）
const tabItems = computed(() => sidebarItems.value)
const gdTabs = computed(() => tabItems.value.map(item => ({ name: item.path, label: item.label, icon: item.icon })))

// 获取默认标签页
const getDefaultTabPath = () => {
    return sidebarItems.value[0]?.path || 'mcp'
}

const currentTabValue = ref(getDefaultTabPath())

// Tab 切换处理
const handleTabChange = (tabName: string | number) => {
    const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
    // 显式丢掉 view：二级视图属于当前 tab，不带过去才不会一进来就停在市场
    router.replace({ name: 'Plugins', params: { tab: tabPath }, query: { ...route.query, view: undefined } })
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

</style>
