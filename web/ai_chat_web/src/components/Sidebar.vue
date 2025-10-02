<template>
  <div class="app-sidebar">
    <div 
      v-for="item in sidebarItems" 
      :key="item.id"
      class="sidebar-btn"
      :class="{ active: item.id === activePage }"
      @click="$emit('change-page', item.id)"
      :title="item.title"
    >
      <i :class="item.icon"></i>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activePage: String
})

defineEmits(['change-page'])

const sidebarItems = [
  { id: 'chat', icon: 'fas fa-comment', title: '对话' },
  { id: 'characters', icon: 'fas fa-user', title: '角色' },
  { id: 'settings', icon: 'fas fa-cog', title: '设置' }
]
</script>