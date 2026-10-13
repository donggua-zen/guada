import { ref, type Ref } from 'vue'

/**
 * Electron 主窗口全屏状态。
 *
 * macOS 原生全屏会隐藏红绿灯按钮，而标题栏 / 侧边栏为红绿灯预留了 78px 左侧留白
 * （见 CustomTitlebar、PageHeader、GlobalSidebar），全屏时若不取消这段留白，左上角
 * 会留下一块空白。主进程在 enter-full-screen / leave-full-screen 时经 IPC 推送状态，
 * 这里做模块级单例：多个组件共享同一份状态与订阅，避免重复注册监听。
 *
 * 非 Electron 环境（浏览器调试）恒为 false。
 */
const isFullscreen = ref(false)
let initialized = false

function init() {
  if (initialized) return
  initialized = true

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api) return

  // 初始值：组件挂载时窗口可能已处于全屏（如从上次会话恢复）
  api.isFullScreen?.().then((v) => {
    isFullscreen.value = !!v
  }).catch(() => {})

  api.onFullscreenChange?.((v) => {
    isFullscreen.value = !!v
  })
}

export function useFullscreen(): { isFullscreen: Ref<boolean> } {
  init()
  return { isFullscreen }
}
