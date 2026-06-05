<template>
  <SidebarLayout :sidebarVisible="layoutStore.sidebarVisible" :sidebarWidth="280" :showToggleButton="false"
    sidebarPosition="left" :z-index="10">
    <template #sidebar>
      <GlobalSidebar />
    </template>
    <template #content>
      <div class="h-full flex-1 min-w-0 overflow-hidden bg-(--color-sidebar-bg)">
        <div class="h-full overflow-hidden rounded-tl-xl border-l border-t border-gray-100 dark:border-[#1f1f1f] bg-(--color-bg)">
          <RouterView />
        </div>
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
