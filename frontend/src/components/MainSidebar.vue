<template>
  <div
    class="flex flex-col h-full bg-(--color-sidebar-bg) border-r border-(--color-sidebar-border)"
    :style="{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }">
    <!-- 顶部 Logo/标题 -->
    <div class="px-2.5 py-4 flex items-center justify-center cursor-pointer" @click="openGuide">
      <div
        class="w-9 h-9 rounded-xl bg-linear-to-br from-(--color-primary) to-(--color-primary-600) flex items-center justify-center shadow-md">
        <span class="text-white font-semibold text-sm">AI</span>
      </div>
    </div>

    <!-- 导航菜单 -->
    <div class="flex-1 py-5 px-2 space-y-1">
      <!-- 对话 -->
      <div @click="handleNavClick('chat')"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out group"
        :class="activeTab === 'chat' ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out group-hover:scale-110">
          <ChatbubbleEllipses v-if="activeTab === 'chat'" class="w-5 h-5" />
          <ChatbubbleEllipsesOutline v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">对话</span>
      </div>

      <!-- 助手 -->
      <div @click="handleNavClick('characters')"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out group"
        :class="activeTab === 'characters' ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out group-hover:scale-110">
          <AlternateEmailTwotone v-if="activeTab === 'characters'" class="w-5 h-5" />
          <PeopleOutline v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">助手</span>
      </div>

      <!-- Bots -->
      <div @click="handleNavClick('bots')"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out group"
        :class="currentActiveTab === 'bots' ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out group-hover:scale-110">
          <PrecisionManufacturingTwotone v-if="currentActiveTab === 'bots'" class="w-5 h-5" />
          <PrecisionManufacturingOutlined v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">Bots</span>
      </div>

      <!-- 知识库 -->
      <div @click="handleNavClick('knowledge-base')"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out group"
        :class="currentActiveTab === 'knowledge-base' ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out group-hover:scale-110">
          <MenuBookOutlined v-if="currentActiveTab === 'knowledge-base'" class="w-5 h-5" />
          <MenuBookOutlined v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">知识</span>
      </div>

      <!-- 插件 -->
      <div @click="handleNavClick('plugins')"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out group"
        :class="currentActiveTab === 'plugins' ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out group-hover:scale-110">
          <ExtensionTwotone v-if="currentActiveTab === 'plugins'" class="w-5 h-5" />
          <ExtensionOutlined v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">插件</span>
      </div>

      <!-- 系统设置 -->
      <div @click="handleNavClick('setting')"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out group"
        :class="currentActiveTab === 'setting' ? 'bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)' : 'text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover)'">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out group-hover:scale-110">
          <SettingsTwotone v-if="currentActiveTab === 'setting'" class="w-5 h-5" />
          <SettingsOutlined v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">设置</span>
      </div>
    </div>

    <!-- 底部用户信息 -->
    <div class="px-2.5 py-3.5">
      <!-- 主题切换按钮 -->
      <div @click="toggleDark"
        class="flex flex-col items-center justify-center px-2 py-2.5 my-0.5 rounded-xl cursor-pointer transition-all duration-250 ease-in-out text-(--color-text-gray) hover:bg-(--color-sidebar-bg-hover) hover:text-(--color-sidebar-text-hover) mb-1">
        <div
          class="w-5 h-5 mb-1 flex items-center justify-center transition-transform duration-200 ease-in-out hover:scale-110">
          <WbSunnyTwotone v-if="isDark" class="w-5 h-5" />
          <NightlightRound v-else class="w-5 h-5" />
        </div>
        <span class="text-[0.6875rem] font-medium tracking-wide">{{ isDark ? '亮色' : '暗色' }}</span>
      </div>

      <!-- 用户头像下拉菜单 -->
      <el-dropdown trigger="hover" placement="top-end" @command="handleUserMenuCommand">
        <div
          class="flex items-center justify-center p-2 rounded-lg cursor-pointer transition-all duration-200 ease-in-out hover:bg-(--color-surface)">

          <Avatar class="w-8 h-8" type="user" :round="true" :src="authStore.user?.avatarUrl"
            :name="authStore.user?.nickname || authStore.user?.username" />

        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              <PersonOutline class="w-4 h-4 mr-2" />
              个人中心
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided>
              <LogOutOutline class="w-4 h-4 mr-2" />
              退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, inject } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Avatar } from './ui'
import { useTheme } from "../composables/useTheme";
import { useSessionStore } from '../stores/session'
import { usePopup } from '../composables/usePopup'

const openGuide = inject('openGuide', () => { })

// 主题
const { isDark, toggleDark } = useTheme()
const sessionStore = useSessionStore()
const { confirm } = usePopup()

// 图标
import {
  ChatbubbleEllipses,
  ChatbubbleEllipsesOutline,
  PeopleOutline,
  PersonOutline,
  LogOutOutline
} from '@vicons/ionicons5'
import {
  AlternateEmailTwotone,
  SettingsOutlined,
  SettingsTwotone,
  WbSunnyTwotone,
  NightlightRound,
  MenuBookOutlined,
  ExtensionOutlined,
  ExtensionTwotone,
  PrecisionManufacturingTwotone,
  PrecisionManufacturingOutlined
} from '@vicons/material'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// Props 定义 - 类型化
const props = defineProps<{
  activeTab?: string;
  sidebarWidth?: string;
}>()

// Emits 类型化
const emit = defineEmits<{
  'update:activeTab': [tab: string]
}>()

// 计算当前激活的 tab（根据路由）
const currentActiveTab = computed(() => {
  const routeName = route.name as string
  if (routeName === 'Chat') return 'chat'
  if (routeName === 'Characters') return 'characters'
  if (routeName === 'Bots') return 'bots'
  if (routeName === 'AccountCenter') return 'account'
  if (routeName === 'SystemSettings') return 'setting'
  if (routeName === 'KnowledgeBase') return 'knowledge-base'
  if (routeName === 'Plugins') return 'plugins'
  return props.activeTab || ''
})

// 监听路由变化，更新 activeTab
watch(currentActiveTab, (newTab) => {
  if (newTab) {
    emit('update:activeTab', newTab)
  }
}, { immediate: true })

// 处理导航点击 - 类型化
const handleNavClick = (tab: string): void => {
  if (tab === 'chat') {
    if (sessionStore.activeSessionId) {
      router.replace({ name: 'Chat', params: { sessionId: sessionStore.activeSessionId } })
    } else {
      router.replace({ name: 'Chat' })
    }
  } else if (tab === 'characters') {
    router.replace({ name: 'Characters' })
  } else if (tab === 'bots') {
    router.replace({ name: 'Bots' })
  } else if (tab === 'setting') {
    // 跳转到系统设置，默认显示第一个标签页
    router.replace({ name: 'SystemSettings' })
  } else if (tab === 'knowledge-base') {
    router.replace({ name: 'KnowledgeBase' })
  } else if (tab === 'plugins') {
    // 跳转到插件页面，默认显示第一个标签页
    router.replace({ name: 'Plugins' })
  }
}

// 处理用户菜单命令
const handleUserMenuCommand = (command: string): void => {
  if (command === 'profile') {
    router.replace({ name: 'AccountCenter' })
  } else if (command === 'logout') {
    // 二次确认退出登录
    confirm('提示', '确定要退出登录吗？', {
      type: 'warning',
      confirmText: '确定',
      cancelText: '取消'
    }).then((confirmed) => {
      if (confirmed) {
        authStore.logout()
        router.replace({ name: 'Login' })
      }
    })
  }
}
</script>
