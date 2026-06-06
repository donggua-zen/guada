<template>
  <SidebarLayout :sidebarVisible="layoutStore.sidebarVisible" :sidebarWidth="280" :showToggleButton="false"
    sidebarPosition="left" :z-index="20">
    <template #sidebar>
      <GlobalSidebar />
    </template>
    <template #content>
      <div class="h-full flex-1 min-w-0 overflow-hidden bg-(--color-sidebar-bg)">
        <div class="h-full overflow-hidden rounded-tl-xl border-l border-t border-gray-100 dark:border-[#2f2f2f] bg-(--color-bg)">
          <RouterView />
        </div>
      </div>
    </template>
  </SidebarLayout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useLayoutStore } from '@/stores/layout'
import { apiService } from '@/services/ApiService'
import SidebarLayout from './ui/SidebarLayout.vue'
import GlobalSidebar from './GlobalSidebar.vue'

const layoutStore = useLayoutStore()

// 启动 SSE 连接
onMounted(() => {
  console.log('[MainLayout] 启动 SSE 连接')
  apiService.connectSessionEvents()
})

// 组件卸载时断开 SSE 连接，避免内存泄漏
onUnmounted(() => {
  console.log('[MainLayout] 断开 SSE 连接')
  apiService.disconnectSessionEvents()
})
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
