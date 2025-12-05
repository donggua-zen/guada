<template>
  <div class="app-sidebar">
    <!-- 原有的侧边栏按钮 -->
    <div v-for="item in sidebarItems" :key="item.id" class="sidebar-btn" :class="{ active: $route.name === item.id }"
      @click="$emit('change-page', item.id)" :title="item.title">
      <div class="icon-wrapper">
        <component :is="item.icon" :size="20" />
      </div>
      <span>{{ item.title }}</span>
    </div>

    <!-- 新增的设置按钮 -->
    <div class="sidebar-btn settings-btn" title="设置" @click="$emit('open-settings')">
      <div class="icon-wrapper">
        <component :is="SettingsTwotone" :size="20" />
      </div>
      <span>设置</span>
    </div>
  </div>
</template>

<script setup>
import { ChatBubbleTwotone, ContactsTwotone, CloudUploadTwotone, SettingsTwotone, AccountCircleTwotone } from '@vicons/material'

const sidebarItems = [
  {
    id: 'Chat',
    icon: ChatBubbleTwotone,
    title: '对话'
  },
  {
    id: 'Characters',
    icon: ContactsTwotone,
    title: '角色'
  },
  {
    id: 'Models',
    icon: CloudUploadTwotone,
    title: '模型'
  },
  {
    id: 'My',
    icon: AccountCircleTwotone,
    title: '我的'
  }
]

// 定义抛出的事件
defineEmits(['change-page', 'open-settings'])
</script>

<style scoped>
.app-sidebar {
  width: 70px;
  background: var(--sidebar-bg);
  padding: 20px 0;
  height: 100vh;
  border-right: 1px solid var(--sidebar-border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.sidebar-btn {
  width: 60px;
  border-radius: 10px;
  margin-bottom: 15px;
  cursor: pointer;
  flex-direction: column;
  text-align: center;
  color: var(--sidebar-text-color);
  font-size: 25px;
  transition: all 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 5px 0;
}

.icon-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

/* 确保图标大小正确 */
.icon-wrapper :deep(svg) {
  width: 28px;
  height: 28px;
}

.sidebar-btn span {
  display: block;
  text-align: center;
  font-size: 12px;
  padding: 5px 0 0 0;
  margin-top: 2px;
}

.sidebar-btn.active {
  background: var(--sidebar-active-bg);
  color: var(--sidebar-active-text-color);
}

.sidebar-btn:hover {
  background: var(--sidebar-hover-bg);
  color: var(--sidebar-hover-text-color);
  transition: all 0.2s ease;
}

/* 设置按钮样式 - 固定在底部 */
.settings-btn {
  margin-top: auto;
  margin-bottom: 20px;
}
</style>