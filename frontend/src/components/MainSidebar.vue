<template>
  <div
    class="flex flex-col h-full bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)] transition-all duration-200"
    :style="{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }">
    <!-- 顶部 Logo/标题 -->
    <div class="px-3 py-4 flex items-center justify-center border-b border-gray-100 dark:border-gray-800">
      <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
        <span class="text-white font-bold text-sm">AI</span>
      </div>
    </div>

    <!-- 导航菜单 -->
    <div class="flex-1 py-4">
      <!-- 对话 -->
      <div @click="handleNavClick('chat')"
        :class="[
          'px-3 py-3 cursor-pointer flex flex-col items-center justify-center transition-all duration-200 mx-2 rounded-xl',
          {
            'bg-[var(--color-conversation-bg-active)] text-[var(--color-conversation-text-active)]': activeTab === 'chat',
            'text-gray-500 hover:bg-[var(--color-conversation-bg-hover)] hover:text-[var(--color-conversation-text-hover)]': activeTab !== 'chat'
          }
        ]"
        class="group">
        <div class="w-6 h-6 mb-1">
          <ChatbubbleEllipses v-if="activeTab === 'chat'" class="w-full h-full" />
          <ChatbubbleEllipsesOutline v-else class="w-full h-full" />
        </div>
        <span class="text-xs font-medium">对话</span>
      </div>

      <!-- 助手 -->
      <div @click="handleNavClick('characters')"
        :class="[
          'px-3 py-3 cursor-pointer flex flex-col items-center justify-center transition-all duration-200 mx-2 rounded-xl mt-2',
          {
            'bg-[var(--color-conversation-bg-active)] text-[var(--color-conversation-text-active)]': activeTab === 'characters',
            'text-gray-500 hover:bg-[var(--color-conversation-bg-hover)] hover:text-[var(--color-conversation-text-hover)]': activeTab !== 'characters'
          }
        ]"
        class="group">
        <div class="w-6 h-6 mb-1">
          <AlternateEmailTwotone v-if="activeTab === 'characters'" class="w-full h-full" />
          <PeopleOutline v-else class="w-full h-full" />
        </div>
        <span class="text-xs font-medium">助手</span>
      </div>

      <!-- 设置 -->
      <div @click="handleNavClick('settings')"
        :class="[
          'px-3 py-3 cursor-pointer flex flex-col items-center justify-center transition-all duration-200 mx-2 rounded-xl mt-2',
          {
            'bg-[var(--color-conversation-bg-active)] text-[var(--color-conversation-text-active)]': activeTab === 'settings',
            'text-gray-500 hover:bg-[var(--color-conversation-bg-hover)] hover:text-[var(--color-conversation-text-hover)]': activeTab !== 'settings'
          }
        ]"
        class="group">
        <div class="w-6 h-6 mb-1">
          <SettingsTwotone v-if="activeTab === 'settings'" class="w-full h-full" />
          <SettingsOutlined v-else class="w-full h-full" />
        </div>
        <span class="text-xs font-medium">设置</span>
      </div>
    </div>

    <!-- 底部用户信息 -->
    <div class="px-3 py-4 border-t border-gray-100 dark:border-gray-800">
      <div @click="handleNavClick('settings')"
        class="cursor-pointer flex flex-col items-center justify-center p-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors duration-200">
        <div class="w-8 h-8 mb-1">
          <Avatar type="user" :round="true" :src="authStore.user?.avatar_url" />
        </div>
        <span class="text-xs text-gray-600 dark:text-gray-400 truncate max-w-full">{{ authStore.user?.nickname || '用户' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Avatar } from './ui'

// 图标
import {
  ChatbubbleEllipses,
  ChatbubbleEllipsesOutline,
  PeopleOutline
} from '@vicons/ionicons5'
import {
  AlternateEmailTwotone,
  SettingsOutlined,
  SettingsTwotone
} from '@vicons/material'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const props = defineProps({
  activeTab: {
    type: String,
    default: 'chat',
    validator: (value) => ['chat', 'characters', 'settings'].includes(value)
  },
  sidebarWidth: {
    type: String,
    default: '64px'  // 优化为更紧凑的宽度
  }
})

const emit = defineEmits(['update:activeTab'])

// 处理导航点击
const handleNavClick = (tab) => {
  if (tab === 'chat') {
    router.replace({ name: 'Chat' })
  } else if (tab === 'characters') {
    router.replace({ name: 'Characters' })
  } else if (tab === 'settings') {
    router.replace({ name: 'Settings' })
  }
}
</script>

<style scoped>
/* 确保过渡动画流畅 */
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}
</style>
