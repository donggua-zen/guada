<template>
  <div class="app-sidebar">
    <div v-for="item in sidebarItems" :key="item.id" class="sidebar-btn" :class="{ active: $route.name === item.id }"
      @click="$emit('change-page', item.id)" :title="item.title">
      <!-- <i :class="item.icon"></i> -->
      <img :src="$route.name === item.id ? item.svg_active : item.svg" alt=""></img>
      <span>{{ item.title }}</span>
    </div>
  </div>
</template>

<script setup>
import icon_chat from '@/assets/chat.svg';
import icon_chat_active from '@/assets/chat_active.svg';
import icon_template from '@/assets/template.svg';
import icon_template_active from '@/assets/template_active.svg';
import icon_models from '@/assets/models.svg';
import icon_models_active from '@/assets/models_active.svg';
const sidebarItems = [
  {
    id: 'Chat', icon: 'fas fa-comment', svg: icon_chat, svg_active: icon_chat_active, title: '对话'
  },
  { id: 'Characters', icon: 'fas fa-user', svg: icon_template, svg_active: icon_template_active, title: '角色' },
  { id: 'Models', icon: 'fas fa-cog', svg: icon_models, svg_active: icon_models_active, title: '模型' }
]
</script>

<style scoped>
/* 新增侧边栏样式 */
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
  /* height: 60px; */
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
}

.sidebar-btn img {
  width: 40px;
  height: 40px;
  margin: 0 auto;
  color: var(--sidebar-text-color);
}

.sidebar-btn span {
  display: block;
  text-align: center;
  font-size: 14px;
  padding: 0 0 5px 0;
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
</style>