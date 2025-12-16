<template>
    <div class="h-full flex flex-col md:max-w-[1180px] md:mx-auto">
        <SidebarLayout v-model:sidebar-visible="sidebarVisible" :show-toggle-button="false"
            :sidebar-width="sidebarWidth" :z-index="51" class="flex-1 overflow-hidden">
            <template #sidebar>
                <div
                    class="flex flex-col w-full h-full border-r border-gray-200 dark:border-gray-700 items-center relative px-3 md:px-0 py-2 pr-3 bg-gray-100 md:bg-white dark:bg-transparent">
                    <div class="lex flex-col w-full" v-for="group in filteredSidebarItems"
                        @click="handleItemClick(item)">
                        <div class="flex-1 flex items-center justify-start mx-2 my-3">
                            <span class="text-md text-gray-400">{{ group.label }}</span>
                        </div>
                        <div class="flex flex-col w-full rounded-lg bg-white md:bg-transparent px-4 md:px-0">
                            <div class="flex items-center justify-centertransition-colors duration-200" :class="{
                                'bg-[var(--color-primary-100)] text-[var(--color-primary)]': !isMobile && currentTabValue === item.path,
                                'border-b border-gray-200 py-3 px-1 last:border-b-0': isMobile,
                                'rounded-lg mx-1 mb-2 mt-1 py-1 px-2 cursor-pointer': !isMobile,
                                'active:bg-[var(--color-primary-100)]': isMobile,
                                'hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-100)]': !isMobile,
                            }" v-for="item in group.items" @click="handleItemClick(item)">
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
                    <div
                        class="relative flex items-center justify-center md:justify-start py-2 border-b-1 border-gray-100 mb-2 mx-0 md:mx-3">
                        <UiButton class="absolute block md:hidden left-1" text style="font-size: 24px"
                            @click="router.back()">
                            <template #icon>
                                <ArrowBackIosFilled />
                            </template>
                        </UiButton>
                        <div class="text-lg">{{ currentItem.label }}</div>
                        <div class="flex items-center"></div>
                    </div>
                    <div class="p-3 md:p-3 md:w-full flex flex-col flex-1 overflow-hidden min-h-0">
                        <template v-if="currentTabValue === 'profile'">
                            <UserProfile ref="userProfileRef" />
                        </template>
                        <template v-else-if="currentTabValue === 'subaccounts'">
                            <UserSubaccounts ref="userSubaccountsRef" />
                        </template>
                        <template v-else-if="currentTabValue === 'security'">
                            <UserSecurity ref="userSecurityRef" />
                        </template>
                        <template v-else-if="currentTabValue === 'models'">
                            <ModelsSettings />
                        </template>
                        <template v-else-if="currentTabValue === 'chat'">
                            <ChatSettings ref="chatSettingsRef" />
                        </template>
                    </div>
                </div>

            </template>
        </SidebarLayout>
    </div>
</template>
<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { SidebarLayout, UiButton } from "../ui";
import UserProfile from './UserProfile.vue'
import UserSubaccounts from './UserSubaccounts.vue'
import UserSecurity from './UserSecurity.vue'
import ModelsSettings from './ModelsSettings.vue';
import ChatSettings from './ChatSettings.vue'

import {
    PersonOutlineOutlined,
    SupervisedUserCircleOutlined,
    VerifiedUserOutlined,
    CloudDownloadOutlined,
    ArrowBackIosFilled,
} from '@vicons/material'

import { useAuthStore } from '../../stores/auth'

import { usePopup } from '../../composables/usePopup'
import { useRouter, useRoute } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
// import { useRoute} from 'vue-router'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

const { toast, notify, confirm } = usePopup()

const authStore = useAuthStore()
const sidebarVisible = ref(true)
const router = useRouter()
const route = useRoute()

const sidebarWidth = computed(() => {
    return isMobile.value ? -1 : 200
})

const props = defineProps({
    visible: Boolean,
    default: {
        type: String,
        default: 'profile'
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
        roles: ['primary'],
        items: [

            {
                label: '模型管理',
                path: 'models',
                icon: CloudDownloadOutlined,
                roles: ['primary'],
            }, {
                label: '对话设置',
                path: 'chat',
                icon: VerifiedUserOutlined,
                roles: ['primary'],
            },]
    },
    {
        label: '账户管理',
        path: null,
        roles: ['primary', 'subaccount'],
        items: [

            {
                label: '账户概览',
                path: 'profile',
                icon: PersonOutlineOutlined,
                roles: ['primary', 'subaccount']
            },
            {
                label: '子账户',
                path: 'subaccounts',
                icon: SupervisedUserCircleOutlined,
                roles: ['primary'],
            },
            {
                label: '安全设置',
                path: 'security',
                icon: VerifiedUserOutlined,
                roles: ['primary', 'subaccount'],
            },
            {
                label: '退出登录',
                path: 'exit',
                icon: CloudDownloadOutlined,
                roles: ['primary', 'subaccount'],
            }]
    }
]

const filteredSidebarItems = computed(() => {
    const userRole = authStore.user?.role || 'primary'
    return sidebarItems
        .filter(item => !item.roles || item.roles.includes(userRole))
        .map(item => {
            // 如果有子项，则也对子项进行过滤
            if (item.items) {
                return {
                    ...item,
                    items: item.items.filter(subItem => !subItem.roles || subItem.roles.includes(userRole))
                }
            }
            return item
        })
        .filter(item => {
            // 过滤掉既没有path也没有有效子项的项目
            return item.path !== null || (item.items && item.items.length > 0)
        })
})

const currentItem = computed(() => {
    for (const item of filteredSidebarItems.value) {
        if (item.items) {
            const subItem = item.items.find(subItem => subItem.path === currentTabValue.value)
            if (subItem) {
                return subItem
            }
        }
    }
    return null
})

const handleItemClick = (item) => {
    if (!item?.path) {
        return;
    }
    if (item.path === 'exit') {
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
    if (isMobile.value)
        sidebarVisible.value = false
    router.push({ name: 'Settings', params: { tab: item.path } })
}

watch(() => isMobile.value, (newState) => {
    if (!newState) {
        console.log('mobile', newState)
        sidebarVisible.value = true
    } else {
        sidebarVisible.value = !route.params.tab
    }
})

watch(() => route.params.tab, (newPath) => {
    console.log('newPath', newPath)
    if (isMobile.value) {
        sidebarVisible.value = !newPath
    }
    currentTabValue.value = newPath
})

onMounted(() => {
    if (isMobile.value) {
        sidebarVisible.value = !route.params.tab
    } else {
        sidebarVisible.value = true
    }
    currentTabValue.value = route.params.tab
})
</script>