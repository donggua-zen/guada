<template>
  <div class="app-sidebar">
    <div v-for="item in sidebarItems" :key="item.id" class="sidebar-btn" :class="{ active: $route.name === item.id }"
      @click="$emit('change-page', item.id)" :title="item.title">
      <i :class="item.icon"></i>
      <span>{{ item.title }}</span>
    </div>
  </div>
</template>

<script setup>

const sidebarItems = [
  { id: 'Chat', icon: 'fas fa-comment', title: '对话' },
  { id: 'Characters', icon: 'fas fa-user', title: '角色' },
  { id: 'Settings', icon: 'fas fa-cog', title: '设置' }
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
  height: 60px;
  border-radius: 10px;
  margin-bottom: 15px;
  cursor: pointer;
  flex-direction: column;
  text-align: center;
  color: var(--sidebar-text-color);
  font-size: 25px;
  transition: all 0.2s ease;
}

.sidebar-btn span {
  display: block;
  text-align: center;
  font-size: 14px;
  padding: 5px 0;
}

.sidebar-btn:hover {
  background: var(--sidebar-hover-bg);
  color: var(--sidebar-hover-text-color);
  transition: all 0.2s ease;
}

.sidebar-btn.active {
  background: var(--sidebar-active-bg);
  color: var(--sidebar-active-text-color);
}
</style>