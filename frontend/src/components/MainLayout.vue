<template>
  <div class="flex h-screen overflow-hidden">
    <!-- 左侧统一导航侧边栏 -->
    <MainSidebar 
      v-model:active-tab="activeTab"
      :sidebar-width="sidebarWidth"
    />
    
    <!-- 右侧内容区 -->
    <div class="flex-1 min-w-0 h-full overflow-hidden">
      <RouterView />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import MainSidebar from './MainSidebar.vue'

const router = useRouter()
const route = useRoute()
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')

// 当前激活的导航标签
const activeTab = ref('chat')

// 侧边栏宽度
const sidebarWidth = computed(() => {
  return isMobile.value ? '0px' : '64px'  // 优化为更紧凑的宽度
})

// 监听路由变化，同步更新 activeTab
watch(
  () => route.name,
  (newName) => {
    if (newName === 'Chat') {
      activeTab.value = 'chat'
    } else if (newName === 'Characters') {
      activeTab.value = 'characters'
    } else if (newName === 'Settings') {
      activeTab.value = 'settings'
    }
  },
  { immediate: true }
)
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
