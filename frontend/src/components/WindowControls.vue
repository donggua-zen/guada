<template>
  <div v-if="isElectron" class="flex items-center h-full no-drag">
    <button
      class="flex items-center justify-center w-11 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) dark:text-[#8b8d95] transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none"
      @click="minimizeWindow" title="最小化">
      <WindowMinimize class="w-3 h-3" />
    </button>

    <button
      class="flex items-center justify-center w-11 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) dark:text-[#8b8d95] transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none"
      @click="maximizeWindow" :title="isMaximized ? '还原' : '最大化'">
      <WindowMaximize v-if="!isMaximized" class="w-3 h-3" />
      <WindowRestore v-else class="w-3 h-3" />
    </button>

    <button
      class="flex items-center justify-center w-11 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) dark:text-[#8b8d95] transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-[#e81123] hover:text-white hover:opacity-100 focus:outline-none focus-visible:outline-none close-button"
      @click="closeWindow" title="关闭">
      <WindowClose class="w-3 h-3" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { WindowMinimize, WindowMaximize, WindowRestore, WindowClose } from '@/components/icons'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

const isMaximized = ref(false)

const updateMaximizedState = async () => {
  if (window.electronAPI) {
    isMaximized.value = await window.electronAPI.isMaximized()
  }
}

const minimizeWindow = () => {
  window.electronAPI?.minimizeWindow()
}

const maximizeWindow = async () => {
  window.electronAPI?.maximizeWindow()
  await updateMaximizedState()
}

const closeWindow = () => {
  window.electronAPI?.closeWindow()
}

const handleResize = () => {
  updateMaximizedState()
}

onMounted(() => {
  updateMaximizedState()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.no-drag {
  -webkit-app-region: no-drag;
}
</style>
