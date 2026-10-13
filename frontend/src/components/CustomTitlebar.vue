<template>
  <!-- 标题栏高度 36px（h-9）：与 electron/main.ts 的 TITLEBAR_HEIGHT 对应，两侧需同步修改 -->
  <div v-if="isElectron"
    class="custom-titlebar flex items-center justify-between h-9 sidebar-transparent-bg select-none drag-region"
    :class="{ 'mac-traffic-light-padding': isMac && !isFullscreen }">
    <!-- 左侧：应用标题 + 菜单按钮 -->
    <TitlebarLeftPanel />

    <!-- 右侧窗口按钮：Windows 由原生 titleBarOverlay 绘制（见 electron/main.ts），
         macOS 用系统红绿灯；此处不再自绘 -->
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import TitlebarLeftPanel from './TitlebarLeftPanel.vue'
import { useFullscreen } from '@/composables/useFullscreen'

defineEmits(['openGuide'])

// 全屏（macOS 隐藏红绿灯）时取消为其预留的左侧留白
const { isFullscreen } = useFullscreen()

const isElectron = computed(() => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
})

const isMac = computed(() => {
  return isElectron.value && window.electronAPI?.platform === 'darwin'
})

// ============ Windows 原生窗口按钮（titleBarOverlay）配色同步 ============
// overlay 底色固定全透明（灰底不存在，符号直接画在主题标题栏上），
// 这里只需按标题栏背景亮度决定按钮符号的黑/白（Qoder 同款策略）

const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

/** 任意 CSS 颜色 → {r,g,b,a}（canvas 解析，支持 color-mix 计算值） */
function parseColor(value: string): { r: number; g: number; b: number; a: number } {
  ctx!.clearRect(0, 0, 1, 1)
  ctx!.fillStyle = value || 'transparent'
  ctx!.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx!.getImageData(0, 0, 1, 1).data
  return { r, g, b, a: a / 255 }
}

const varOf = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** 与半透明标题栏常见的浅/深底做合成后取相对亮度，判断亮暗 */
function titlebarIsLight(): boolean {
  const bg = parseColor(varOf('--gd-color-sidebar-bg') || '#ffffff')
  const tb = parseColor(varOf('--gd-color-titlebar-bg') || varOf('--gd-color-sidebar-bg') || '#ffffff')
  const a = tb.a
  const r = tb.r * a + bg.r * (1 - a)
  const g = tb.g * a + bg.g * (1 - a)
  const b = tb.b * a + bg.b * (1 - a)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
}

function syncOverlayColors() {
  if (window.electronAPI?.platform !== 'win32') return
  window.electronAPI?.setWindowControlsColor?.({
    symbolColor: titlebarIsLight() ? '#000000' : '#ffffff',
  })
}

let observer: MutationObserver | null = null

onMounted(() => {
  syncOverlayColors()
  // 主题以 html 上的 class/style 切换，变更即重同步
  observer = new MutationObserver(syncOverlayColors)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
})

onUnmounted(() => observer?.disconnect())

watch(isElectron, syncOverlayColors)
</script>

<style scoped>
.drag-region {
  -webkit-app-region: drag;
}

/* macOS 红绿灯按钮占用左上角约 70px，左侧留白避免遮挡 */
.mac-traffic-light-padding {
  padding-left: 78px;
}
</style>
