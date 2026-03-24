<template>
  <div
    class="flex flex-col h-full bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)] transition-all duration-300"
    :style="{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }">
    <!-- 顶部 Logo/标题 -->
    <div class="px-2.5 py-4 flex items-center justify-center border-b border-[var(--color-conversation-border)]">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-600)] flex items-center justify-center shadow-md">
        <span class="text-white font-semibold text-sm">AI</span>
      </div>
    </div>

    <!-- 导航菜单 -->
    <div class="flex-1 py-5 px-2 space-y-1">
      <!-- 对话 -->
      <div @click="handleNavClick('chat')"
        :class="[
          'nav-item group',
          activeTab === 'chat' ? 'nav-item-active' : 'nav-item-inactive'
        ]">
        <div class="nav-icon">
          <ChatbubbleEllipses v-if="activeTab === 'chat'" class="w-5 h-5" />
          <ChatbubbleEllipsesOutline v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">对话</span>
      </div>

      <!-- 助手 -->
      <div @click="handleNavClick('characters')"
        :class="[
          'nav-item group',
          activeTab === 'characters' ? 'nav-item-active' : 'nav-item-inactive'
        ]">
        <div class="nav-icon">
          <AlternateEmailTwotone v-if="activeTab === 'characters'" class="w-5 h-5" />
          <PeopleOutline v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">助手</span>
      </div>

      <!-- 设置 -->
      <div @click="handleNavClick('settings')"
        :class="[
          'nav-item group',
          activeTab === 'settings' ? 'nav-item-active' : 'nav-item-inactive'
        ]">
        <div class="nav-icon">
          <SettingsTwotone v-if="activeTab === 'settings'" class="w-5 h-5" />
          <SettingsOutlined v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">设置</span>
      </div>
    </div>

    <!-- 底部用户信息 -->
    <div class="px-2.5 py-3.5 border-t border-[var(--color-conversation-border)]">
      <!-- 主题切换按钮 -->
      <div @click="toggleDark"
        class="nav-item nav-item-inactive mb-1 cursor-pointer hover:bg-[var(--color-conversation-bg-hover)]">
        <div class="nav-icon">
          <WbSunnyTwotone v-if="isDark" class="w-5 h-5" />
          <NightlightRound v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">{{ isDark ? '亮色' : '暗色' }}</span>
      </div>
      
      <div class="user-profile">
        <div class="user-avatar">
          <Avatar type="user" :round="true" :src="authStore.user?.avatar_url" />
        </div>
        <span class="user-name">{{ authStore.user?.nickname || '用户' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Avatar } from './ui'
import { useTheme } from "../composables/useTheme";

// 主题
const { isDark, toggleDark } = useTheme()

// 图标
import {
  ChatbubbleEllipses,
  ChatbubbleEllipsesOutline,
  PeopleOutline
} from '@vicons/ionicons5'
import {
  AlternateEmailTwotone,
  SettingsOutlined,
  SettingsTwotone,
  WbSunnyTwotone,
  NightlightRound
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
/* 导航项样式 */
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.625rem 0.5rem;
  margin: 0.125rem 0;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.nav-item-inactive {
  color: var(--color-text-gray);
}

.nav-item-inactive:hover {
  background-color: var(--color-conversation-bg-hover);
  color: var(--color-conversation-text-hover);
}

.nav-item-active {
  background-color: var(--color-conversation-bg-active);
  color: var(--color-conversation-text-active);
}

.nav-icon {
  width: 1.25rem;
  height: 1.25rem;
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.nav-item:hover .nav-icon {
  transform: scale(1.1);
}

.nav-label {
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* 用户信息样式 */
.user-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.user-profile:hover {
  background-color: var(--color-surface);
}

.user-avatar {
  width: 2rem;
  height: 2rem;
  margin-bottom: 0.375rem;
}

.user-name {
  font-size: 0.6875rem;
  color: var(--color-text-gray);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dark .user-name {
  color: var(--color-text-disabled);
}
</style>
