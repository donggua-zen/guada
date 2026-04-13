<template>
    <div class="h-full flex flex-col md:max-w-295 md:mx-auto">
        <SidebarLayout v-model:sidebar-visible="sidebarVisible" :show-toggle-button="false"
            :sidebar-width="sidebarWidth" :z-index="51" class="flex-1 overflow-hidden">
            <template #sidebar>
                <div
                    class="flex flex-col w-full h-full border-r border-gray-200 dark:border-gray-700 items-center relative px-3 md:px-0 py-2 pr-3 bg-gray-100 md:bg-white dark:bg-transparent">
                    <div class="lex flex-col w-full">
                        <div class="flex-1 flex items-center justify-start mx-2 my-3">
                            <span class="text-md text-gray-400">系统设置</span>
                        </div>
                        <div class="flex flex-col w-full rounded-lg bg-white md:bg-transparent px-4 md:px-0">
                            <div v-for="item in sidebarItems" 
                                @click="handleItemClick(item)"
                                class="flex items-center justify-center transition-colors duration-200" 
                                :class="{
                                    'bg-(--color-primary-100) text-(--color-primary)': !isMobile && currentTabValue === item.path,
                                    'border-b border-gray-200 py-3 px-1 last:border-b-0': isMobile,
                                    'rounded-lg mx-1 mb-2 mt-1 py-1 px-2 cursor-pointer': !isMobile,
                                    'active:bg-(--color-primary-100)': isMobile,
                                    'hover:text-(--color-primary) hover:bg-(--color-primary-100)': !isMobile,
                                }">
                                <div class="flex-1 w-full flex items-center gap-x-2">
                                    <component :is="item.icon" class="w-5 h-5"></component>
                                    <span class="text-md">{{ item.label }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
            <template #content>
                <div class="h-full flex flex-col" v-if="currentItem">
                    <!-- <div
                        class="relative flex items-center justify-center md:justify-start py-2 border-b-1 border-gray-100 mb-2 mx-0 md:mx-3">
                        <el-button v-if="isMobile" class="absolute block left-1" text style="font-size: 24px"
                            @click="router.back()">
                            <template #icon>
                                <ArrowBackIosFilled />
                            </template>
                        </el-button>
                        <div class="text-lg">{{ currentItem.label }}</div>
                        <div class="flex items-center"></div>
                    </div> -->
                    <div class="p-3 md:p-3 md:w-full flex flex-col flex-1 overflow-hidden min-h-0">
                        <template v-if="currentTabValue === 'models'">
                            <ModelsSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'default-models'">
                            <DefaultModelSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'mcp'">
                            <MCPServers />
                        </template>
                    </div>
                </div>
            </template>
        </SidebarLayout>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { SidebarLayout } from "../ui";
import { ElButton } from 'element-plus';
import ModelsSettings from './ModelsSettings.vue';
import DefaultModelSettings from './DefaultModelSettings.vue'
import MCPServers from './MCPServers.vue'

import {
    CloudDownloadOutlined,
    ArrowBackIosFilled,
    DnsOutlined,
} from '@vicons/material'

import { useAuthStore } from '../../stores/auth'
import { useRouter, useRoute } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')

const authStore = useAuthStore()
const sidebarVisible = ref(true)
const router = useRouter()
const route = useRoute()

const sidebarWidth = computed(() => {
    return isMobile.value ? -1 : 200
})

// 系统设置侧边栏菜单
const sidebarItems = [
    {
        label: '模型管理',
        path: 'models',
        icon: CloudDownloadOutlined,
        roles: ['primary'],
    }, 
    {
        label: '默认模型',
        path: 'default-models',
        icon: DnsOutlined,
        roles: ['primary'],
    },
    {
        label: 'MCP 服务器',
        path: 'mcp',
        icon: DnsOutlined,
        roles: ['primary'],
    },
]

// 根据用户角色过滤菜单项
const filteredSidebarItems = computed(() => {
    const userRole = authStore.user?.role || 'primary'
    return sidebarItems.filter(item => !item.roles || item.roles.includes(userRole))
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
    return firstValidItem?.path || 'models'
}

const currentTabValue = ref(getDefaultTabPath())

const currentItem = computed(() => {
    return filteredSidebarItems.value.find(item => item.path === currentTabValue.value) || null
})

const handleItemClick = (item: any) => {
    if (!item?.path) {
        return;
    }
    if (isMobile.value) {
        sidebarVisible.value = false
    }
    router.replace({ name: 'SystemSettings', params: { tab: item.path } })
}

watch(() => isMobile.value, (newState) => {
    if (!newState) {
        sidebarVisible.value = true
    } else {
        sidebarVisible.value = !route.params.tab
    }
})

watch(() => route.params.tab, (newPath) => {
    if (isMobile.value) {
        sidebarVisible.value = !newPath
    }
    // 确保 newPath 是字符串类型
    const tabPath = Array.isArray(newPath) ? newPath[0] : (newPath as string)
    currentTabValue.value = tabPath || getDefaultTabPath()
})

onMounted(() => {
    if (isMobile.value) {
        sidebarVisible.value = !route.params.tab
    } else {
        sidebarVisible.value = true
    }
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
