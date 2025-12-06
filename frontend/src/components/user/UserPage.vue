<template>
    <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-width="220">
        <template #sidebar>
            <div class="flex flex-col h-full border-r border-gray-200 items-center relative p-3">
                <div class="h-12"></div>
                <div class="w-full cursor-pointer h-10 flex items-center justify-center hover:text-[var(--primary-color)] hover:bg-[var(--secondary-color)] px-6 py-3 mb-3 rounded-full transition-colors duration-200"
                    :class="{ 'bg-[var(--secondary-color)] text-[var(--primary-color)]': currentTabValue === item.path }"
                    v-for="item in filteredSidebarItems" @click="handleItemClick(item)">
                    <div class="flex-1 w-full flex items-center gap-x-2">
                        <component :is="item.icon" class="w-5 h-5"></component>
                        <span class="text-md">{{ item.label }}</span>
                    </div>
                </div>
            </div>
        </template>
        <template #content>
            <div class="w-full h-full flex flex-col bg-[var(--bg)]">
                <div class="rounded-2xl h-full m-0 flex flex-col bg-white p-6">
                    <div class="text-xl font-bold mb-6">{{ currentItem.label }}</div>
                    <template v-if="currentTabValue === '/user/profile'">
                        <UserProfile ref="userProfileRef" />
                    </template>
                    <template v-else-if="currentTabValue === '/user/subaccounts'">
                        <UserSubaccounts ref="userSubaccountsRef" />
                    </template>
                    <template v-else-if="currentTabValue === '/user/security'">
                        <UserSecurity ref="userSecurityRef" />
                    </template>
                </div>
            </div>
        </template>
    </SidebarLayout>
</template>
<script setup>
import { ref, onMounted, computed } from 'vue'
import SidebarLayout from '../layout/SidebarLayout.vue'
import UserProfile from './UserProfile.vue'
import UserSubaccounts from './UserSubaccounts.vue'
import UserSecurity from './UserSecurity.vue'
import {
    NButton,
    NForm,
    NFormItem,
    NInput,
    NIcon,
    NDropdown,
    NModal,
    c
} from 'naive-ui'

import {
    PersonOutlineOutlined,
    SupervisedUserCircleOutlined,
    VerifiedUserOutlined,
    CloudDownloadOutlined,
    MoreVertOutlined,
    EditOutlined,
    DeleteOutlineOutlined
} from '@vicons/material'

import { useAuthStore } from '../../stores/auth'

import { usePopup } from '../../composables/usePopup'
import { apiService } from '../../services/ApiService'
import { useRouter } from 'vue-router'

const { toast, notify, confirm } = usePopup()

const authStore = useAuthStore()
const sidebarVisible = ref(true)
const currentTabValue = ref('/user/profile')
const userProfileRef = ref(null)
const userSubaccountsRef = ref(null)
const userSecurityRef = ref(null)
const router = useRouter()

// 添加密码表单数据

const sidebarItems = [
    {
        label: '账户概览',
        path: '/user/profile',
        icon: PersonOutlineOutlined,
        roles: ['primary', 'subaccount']
    },
    {
        label: '子账户',
        path: '/user/subaccounts',
        icon: SupervisedUserCircleOutlined,
        roles: ['primary'],
    },
    {
        label: '安全设置',
        path: '/user/security',
        icon: VerifiedUserOutlined,
        roles: ['primary', 'subaccount'],
    },
    {
        label: '退出登录',
        path: '/user/exit',
        icon: CloudDownloadOutlined,
        roles: ['primary'],
    }
]

const filteredSidebarItems = computed(() => {
    const userRole = authStore.user?.role || 'primary'
    return sidebarItems.filter(item => !item.roles || item.roles.includes(userRole))
})

const currentItem = computed(() => {
    return filteredSidebarItems.value.find(item => item.path === currentTabValue.value)
})

const handleItemClick = (item) => {
    if (item.path === '/user/exit') {
        async function logout() {
            const result = await confirm('退出登录', '确定要退出登录吗？')
            if (result) {
                authStore.logout()
                router.push({ name: 'Login' })
            }
        }
        logout()
        return;
    }
    currentTabValue.value = item.path
}

onMounted(() => {
    // 设置默认选中项为第一个可见菜单项
    if (filteredSidebarItems.value.length > 0 && !currentItem.value) {
        currentTabValue.value = filteredSidebarItems.value[0].path
    }
})
</script>