<template>
  <div v-if="isElectron" class="window-controls flex items-center h-full no-drag">
    <button
      class="flex items-center justify-center w-11 h-full border-none bg-transparent cursor-pointer transition-all duration-150 ease-in-out opacity-70 outline-none hover:opacity-100 focus:outline-none focus-visible:outline-none"
      @click="minimizeWindow">
      <WindowMinimize class="w-3 h-3" />
    </button>

    <button
      class="flex items-center justify-center w-11 h-full border-none bg-transparent cursor-pointer transition-all duration-150 ease-in-out opacity-70 outline-none hover:opacity-100 focus:outline-none focus-visible:outline-none"
      @click="maximizeWindow">
      <WindowMaximize v-if="!isMaximized" class="w-3 h-3" />
      <WindowRestore v-else class="w-3 h-3" />
    </button>

    <button
      class="flex items-center justify-center w-11 h-full border-none bg-transparent cursor-pointer transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-[#e81123] hover:text-white hover:opacity-100 focus:outline-none focus-visible:outline-none close-button"
      @click="closeWindow">
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

/* 窗口控制按钮配色：全部走全局 CSS 变量（style.css 定义默认值，
   主题 CSS 可覆盖）。变量靠继承传递，不受 scoped 特异性影响。
   关闭按钮保留自身的红底白字逻辑，故排除在外 */
.window-controls {
  color: var(--window-controls-color);
}

.window-controls button {
  color: currentColor;
}

.window-controls button:not(.close-button):hover {
  background-color: var(--window-controls-hover-bg);
  color: var(--window-controls-hover-color);
}
</style>
