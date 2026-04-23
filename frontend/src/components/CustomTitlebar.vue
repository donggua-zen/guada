<template>
  <div v-if="isElectron" class="custom-titlebar" :class="{ 'drag-region': true }">
    <!-- 左侧：应用标题或 Logo -->
    <div class="titlebar-left">
      <span class="app-title">AI Chat</span>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="titlebar-right no-drag">
      <button class="titlebar-button" @click="minimizeWindow" title="最小化">
        <svg t="1776852968295" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5695" width="48" height="48">
          <path
            d="M45.60213333 478.13973333h932.79573334c22.9376 0 33.86026667 11.4688 34.4064 34.4064 0 22.9376-11.4688 34.4064-34.4064 34.4064H45.60213333c-22.9376 0-34.4064-11.4688-34.4064-34.4064 0-23.48373333 11.4688-34.4064 34.4064-34.4064z"
            p-id="5696"></path>
        </svg>
      </button>

      <button class="titlebar-button" @click="maximizeWindow" :title="isMaximized ? '还原' : '最大化'">
        <!-- 最大化图标 -->
        <svg v-if="!isMaximized" t="1776852947844" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5524" width="48" height="48">
          <path
            d="M926.45937303 97.54062697v828.2973677H97.54062697V97.54062697h828.91874606m4.97102697-77.6722963h-838.8608c-39.7682157 0-72.07989097 32.31167525-72.07989097 72.07989096v839.48217837c0 39.7682157 32.31167525 72.07989097 72.07989097 72.07989097h839.48217837c39.7682157 0 72.07989097-32.31167525 72.07989096-72.07989097v-838.8608c0-40.38959408-32.31167525-72.70126933-72.70126933-72.70126933 0.62137837 0 0 0 0 0z"
            p-id="5525"></path>
        </svg>
        <!-- 还原图标 -->
        <svg v-else t="1776852886552" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5352" width="48" height="48">
          <path
            d="M739.95130434 284.04869566v658.32336695H81.62793739V284.04869566h658.32336695m0.60787015-75.98376812H80.4121971c-41.33516985 0-75.37589797 33.43285797-75.37589797 75.37589797V943.5878029c0 41.33516985 33.43285797 75.37589797 75.37589797 75.37589797h660.14697739c41.33516985 0 75.37589797-33.43285797 75.37589797-75.37589797V283.44082551c0-41.94304-33.43285797-75.37589797-75.37589797-75.37589797z"
            p-id="5353"></path>
          <path
            d="M944.19567304 5.64416928H282.83295536c-41.33516985 0-74.16015768 33.43285797-74.76802782 74.16015768v77.1995084h75.98376812V81.62793739h658.32336695v658.32336695h-75.98376812V815.93507246H943.5878029c41.33516985 0 74.16015768-33.43285797 74.76802782-74.76802782V79.80432696c0-40.72729971-33.43285797-74.16015768-74.16015768-74.16015768z"
            p-id="5354"></path>
        </svg>
      </button>

      <button class="titlebar-button close-button" @click="closeWindow" title="关闭">
        <svg t="1776852982148" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5866" width="48" height="48">
          <path
            d="M578.36284173 512l422.30899284-422.30899284c18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0l-422.30899284 422.30899284-422.30899284-422.30899284c-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173l422.30899284 422.30899284-422.30899284 422.30899284c-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173 18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0l422.30899284-422.30899284 422.30899284 422.30899284c18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0 18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173l-422.30899284-422.30899284z"
            p-id="5867"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'

const isElectron = computed(() => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
})

const isMaximized = ref(false)

// 更新窗口最大化状态
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
  // 切换后更新状态
  await updateMaximizedState()
}

const closeWindow = () => {
  window.electronAPI?.closeWindow()
}

// 监听窗口大小变化，自动更新最大化状态
const handleResize = () => {
  updateMaximizedState()
}

// 组件挂载时获取初始状态并添加监听器
onMounted(() => {
  updateMaximizedState()
  window.addEventListener('resize', handleResize)
})

// 组件卸载时移除监听器
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.custom-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  /* background-color: transparent; */
  background-color: var(--color-titlebar-bg);
  border-bottom: 1px solid var(--color-titlebar-border);
  /* 透明背景，融入整体 */
  user-select: none;
  -webkit-app-region: drag;
  /* 允许拖拽 */
}

.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
  /* 按钮区域不可拖拽 */
}

.titlebar-left {
  display: flex;
  align-items: center;
  padding-left: 12px;
  flex: 1;
}

.app-title {
  font-size: 12px;
  font-weight: 400;
  color: var(--titlebar-text-color);
  opacity: 0.8;
}

.titlebar-right {
  display: flex;
  align-items: center;
  height: 100%;
}

.titlebar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--titlebar-text-color);
  transition: all 0.15s ease;
  opacity: 0.7;
  outline: none;
  /* 移除默认焦点边框 */
}

.titlebar-button:focus {
  outline: none;
  /* 确保聚焦时也没有边框 */
}

.titlebar-button:focus-visible {
  outline: none;
  /* 移除键盘导航时的焦点边框 */
}

.titlebar-button:hover {
  background-color: var(--titlebar-hover-bg);
  opacity: 1;
}

.titlebar-button.close-button:hover {
  background-color: #e81123;
  color: white;
  opacity: 1;
}

.titlebar-button svg {
  width: 10px;
  height: 10px;
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .app-title {
    color: var(--titlebar-text-color);
  }

  .titlebar-button {
    color: var(--titlebar-text-color);
  }

  .titlebar-button:hover {
    background-color: var(--titlebar-hover-bg);
  }
}

/* 支持通过 data-theme 属性手动切换主题 */
[data-theme="dark"] .app-title,
.dark .app-title {
  color: var(--titlebar-text-color);
}

[data-theme="dark"] .titlebar-button,
.dark .titlebar-button {
  color: var(--titlebar-text-color);
}

[data-theme="dark"] .titlebar-button:hover,
.dark .titlebar-button:hover {
  background-color: var(--titlebar-hover-bg);
}
</style>
