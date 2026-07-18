<template>
  <div v-if="isElectron"
    class="custom-titlebar flex items-center justify-between h-8 sidebar-transparent-bg select-none drag-region">
    <!-- 左侧：应用标题 + 菜单按钮 -->
    <TitlebarLeftPanel />

    <!-- 右侧：窗口控制按钮 -->
    <WindowControls />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TitlebarLeftPanel from './TitlebarLeftPanel.vue'
import WindowControls from './WindowControls.vue'

defineEmits(['openGuide'])

const isElectron = computed(() => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
})
</script>

<style scoped>
.drag-region {
  -webkit-app-region: drag;
}
</style>
