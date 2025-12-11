<template>
    <n-modal v-model:show="modalVisible" :title="currentItem.label" :mask-closable="false" :auto-focus="false"
        style="max-width: 90vw;width: 1100px; height: 60vh;" header-class="ml-2" content-class="overflow-hidden"
        preset="card">
        <div class="h-full flex flex-col">
            <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-width="220" :z-index="51"
                class="flex-1 overflow-hidden">
                <template #sidebar>
                    <div class="flex flex-col h-full border-r border-gray-200 items-center relative py-2 pr-3 bg-white">
                        <div class="w-full py-1 flex items-center justify-center  px-2 mb-3 rounded-lg transition-colors duration-200"
                            :class="{
                                'bg-[var(--primary-color-100)] text-[var(--primary-color)]': currentTabValue === item.path,
                                'cursor-pointer hover:text-[var(--primary-color)] hover:bg-[var(--primary-color-100)]': item.path
                            }" v-for="item in filteredSidebarItems" @click="handleItemClick(item)">
                            <div v-if="item.path" class="flex-1 w-full flex items-center gap-x-2">
                                <component :is="item.icon" class="w-5 h-5"></component>
                                <span class="text-md">{{ item.label }}</span>
                            </div>
                            <div v-else class="flex-1 w-full flex items-center justify-start">
                                <span class="text-md text-gray-400">{{ item.label }}</span>
                            </div>
                        </div>
                    </div>
                </template>
                <template #content>
                    <div class="px-3 h-full">
                        <div class="w-full h-full flex flex-col overflow-hidden min-h-0">
                            <template v-if="currentTabValue === '/user/profile'">
                                <UserProfile ref="userProfileRef" />
                            </template>
                            <template v-else-if="currentTabValue === '/user/subaccounts'">
                                <UserSubaccounts ref="userSubaccountsRef" />
                            </template>
                            <template v-else-if="currentTabValue === '/user/security'">
                                <UserSecurity ref="userSecurityRef" />
                            </template>
                            <template v-else-if="currentTabValue === '/settings/models'">
                                <ModelsSettings />
                            </template>
                            <template v-else-if="currentTabValue === '/settings/chat'">
                                <ChatSettings ref="chatSettingsRef" />
                            </template>
                        </div>
                    </div>

                </template>
            </SidebarLayout>
        </div>
    </n-modal>
</template>
<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { SidebarLayout } from "../ui";
import UserProfile from './UserProfile.vue'
import UserSubaccounts from './UserSubaccounts.vue'
import UserSecurity from './UserSecurity.vue'
import ModelsSettings from './ModelsSettings.vue';
import ChatSettings from './ChatSettings.vue'
import { NModal } from 'naive-ui';

import {
    PersonOutlineOutlined,
    SupervisedUserCircleOutlined,
    VerifiedUserOutlined,
    CloudDownloadOutlined,
} from '@vicons/material'

import { useAuthStore } from '../../stores/auth'

import { usePopup } from '../../composables/usePopup'
import { useRouter } from 'vue-router'

const { toast, notify, confirm } = usePopup()

const authStore = useAuthStore()
const sidebarVisible = ref(true)
const router = useRouter()

const props = defineProps({
    visible: Boolean,
    default: {
        type: String,
        default: '/user/profile'
    }
})

const currentTabValue = ref(props.default)

const emits = defineEmits(['update:visible'])
const modalVisible = computed({
    get() {
        return props.visible
    },
    set(value) {
        emits('update:visible', value)
    }
});

watch(() => props.visible, (value) => {
    if (value) {
        currentTabValue.value = props.default
    }
})

// 添加密码表单数据

const sidebarItems = [
    {
        label: '系统设置',
        path: null,
        roles: ['primary', 'subaccount'],
    },
    {
        label: '模型管理',
        path: '/settings/models',
        icon: CloudDownloadOutlined,
        roles: ['primary'],
    }, {
        label: '对话设置',
        path: '/settings/chat',
        icon: VerifiedUserOutlined,
        roles: ['primary'],
    },
    {
        label: '账户管理',
        path: null,
        roles: ['primary', 'subaccount'],
    },
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
        roles: ['primary', 'subaccount'],
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
    if (item.path === null) {
        return;
    }
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