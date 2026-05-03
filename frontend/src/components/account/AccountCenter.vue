<template>
    <div class="bg-(--color-sidebar-bg) h-full">
        <div class="h-full flex flex-col md:max-w-200 md:mx-auto p-4">
            <div class="flex-1 overflow-hidden flex flex-col">
                <div class="border-gray-200 dark:border-gray-700">
                    <el-tabs v-model="currentTabValue" @tab-change="handleTabChange" class="account-center-tabs">
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
                    <div class="h-full overflow-y-auto">
                        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 max-w-4xl mx-auto">
                            <template v-if="currentTabValue === 'profile'">
                                <UserProfile ref="userProfileRef" />
                            </template>
                            <!-- <template v-else-if="currentTabValue === 'subaccounts'">
                                <UserSubaccounts ref="userSubaccountsRef" />
                            </template> -->
                            <template v-else-if="currentTabValue === 'security'">
                                <UserSecurity ref="userSecurityRef" />
                            </template>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { ElTabs, ElTabPane } from 'element-plus'
import UserProfile from './UserProfile.vue'
// import UserSubaccounts from './UserSubaccounts.vue'
import UserSecurity from './UserSecurity.vue'

import {
    PersonOutlineOutlined,
    VerifiedUserOutlined,
} from '@vicons/material'

import { useAuthStore } from '../../stores/auth'
import { useRouter, useRoute } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

// 账户中心 Tab 菜单（暂时隐藏子账户）
const sidebarItems = [
    {
        label: '账户概览',
        path: 'profile',
        icon: PersonOutlineOutlined,
        roles: ['primary', 'subaccount']
    },
    // {
    //     label: '子账户',
    //     path: 'subaccounts',
    //     icon: SupervisedUserCircleOutlined,
    //     roles: ['primary'],
    // },
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
    return firstValidItem?.path || 'profile'
}

const currentTabValue = ref(getDefaultTabPath())

// Tab 切换处理
const handleTabChange = (tabName: string | number) => {
    const tabPath = typeof tabName === 'string' ? tabName : String(tabName)
    router.replace({ name: 'AccountCenter', params: { tab: tabPath } })
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
        router.replace({ name: 'AccountCenter', params: { tab: defaultTab } })
    } else {
        // 确保 route.params.tab 是字符串类型
        const tabParam = Array.isArray(route.params.tab) ? route.params.tab[0] : (route.params.tab as string)
        currentTabValue.value = tabParam
    }
})
</script>

<style scoped>
.account-center-tabs :deep(.el-tabs__header) {
    margin-bottom: 0;
}

.account-center-tabs :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
}

.account-center-tabs :deep(.el-tabs__item) {
    padding: 0 18px;
    height: 44px;
    line-height: 44px;
    font-size: 14px;
}
</style>
