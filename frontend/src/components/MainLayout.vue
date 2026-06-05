<template>
  <SidebarLayout :sidebarVisible="layoutStore.sidebarVisible" :sidebarWidth="260" :showToggleButton="false"
    sidebarPosition="left" :z-index="10">
    <template #sidebar>
      <GlobalSidebar />
    </template>
    <template #content>
      <div class="h-full flex-1 min-w-0 overflow-hidden rounded-tl-xl border-l border-t border-gray-100 dark:border-[#2a2a2a] dark:bg-[#181818]">
        <RouterView />
      </div>
    </template>
  </SidebarLayout>
</template>

<script setup lang="ts">
import { useLayoutStore } from '@/stores/layout'
import SidebarLayout from './ui/SidebarLayout.vue'
import GlobalSidebar from './GlobalSidebar.vue'

const layoutStore = useLayoutStore()
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
