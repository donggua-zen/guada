import { ref } from 'vue'

export const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

/** 后端是否已就绪（非 Electron 环境直接为 true） */
export const backendReady = ref(!isElectron)

/** 后端启动错误信息 */
export const backendError = ref<string | null>(null)
