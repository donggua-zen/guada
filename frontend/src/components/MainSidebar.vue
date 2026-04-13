<template>
  <div
    class="flex flex-col h-full bg-[var(--color-conversation-bg)] border-r border-[var(--color-conversation-border)] transition-all duration-300"
    :style="{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }">
    <!-- 顶部 Logo/标题 -->
    <div class="px-2.5 py-4 flex items-center justify-center">
      <div
        class="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-600)] flex items-center justify-center shadow-md">
        <span class="text-white font-semibold text-sm">AI</span>
      </div>
    </div>

    <!-- 导航菜单 -->
    <div class="flex-1 py-5 px-2 space-y-1">
      <!-- 对话 -->
      <div @click="handleNavClick('chat')" :class="[
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
      <div @click="handleNavClick('characters')" :class="[
        'nav-item group',
        activeTab === 'characters' ? 'nav-item-active' : 'nav-item-inactive'
      ]">
        <div class="nav-icon">
          <AlternateEmailTwotone v-if="activeTab === 'characters'" class="w-5 h-5" />
          <PeopleOutline v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">助手</span>
      </div>

      <!-- 系统设置 -->
      <div @click="handleNavClick('setting')" :class="[
        'nav-item group',
        currentActiveTab === 'setting' ? 'nav-item-active' : 'nav-item-inactive'
      ]">
        <div class="nav-icon">
          <SettingsTwotone v-if="currentActiveTab === 'setting'" class="w-5 h-5" />
          <SettingsOutlined v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">设置</span>
      </div>

      <!-- 知识库 -->
      <div @click="handleNavClick('knowledge-base')" :class="[
        'nav-item group',
        currentActiveTab === 'knowledge-base' ? 'nav-item-active' : 'nav-item-inactive'
      ]">
        <div class="nav-icon">
          <MenuBookOutlined v-if="currentActiveTab === 'knowledge-base'" class="w-5 h-5" />
          <MenuBookOutlined v-else class="w-5 h-5" />
        </div>
        <span class="nav-label">知识</span>
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

      <div class="user-profile" @click="handleUserProfileClick">
        <div class="user-avatar">
          <Avatar type="user" :round="true" :src="authStore.user?.avatarUrl" :name="authStore.user?.nickname || authStore.user?.username" />
        </div>
        <span class="user-name">{{ authStore.user?.username || '用户' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Avatar } from './ui'
import { useTheme } from "../composables/useTheme";
import { useSessionStore } from '../stores/session'

// 主题
const { isDark, toggleDark } = useTheme()
const sessionStore = useSessionStore()

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
  NightlightRound,
  MenuBookOutlined
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
  if (routeName === 'AccountCenter') return 'account'
  if (routeName === 'SystemSettings') return 'setting'
  if (routeName === 'KnowledgeBase') return 'knowledge-base'
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
  } else if (tab === 'setting') {
    // 跳转到系统设置，默认显示第一个标签页
    router.replace({ name: 'SystemSettings' })
  } else if (tab === 'knowledge-base') {
    router.replace({ name: 'KnowledgeBase' })
  }
}

// 处理用户头像点击 - 跳转到账户中心
const handleUserProfileClick = (): void => {
  router.replace({ name: 'AccountCenter' })
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
