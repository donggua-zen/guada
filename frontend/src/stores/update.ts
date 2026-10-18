import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  UpdateInfo,
  UpdateProgress,
  UpdateStatus,
  UpdateStatusPayload,
} from '@/types/electron'

const SKIP_VERSION_KEY = 'update-skip-version'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * 桌面端更新状态。
 *
 * 主进程会通过 update-status 推送检查/下载/安装进度；标题栏、更新弹窗和
 * 设置里的关于页共用这一份状态，避免每个组件各自注册监听。
 */
export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>('idle')
  const info = ref<UpdateInfo | null>(null)
  const progress = ref<UpdateProgress | null>(null)
  const error = ref<string | undefined>()
  const errorPhase = ref<'check' | 'download' | 'install' | undefined>()
  const downloadedVersion = ref<string | null>(null)
  const skipVersion = ref<string | null>(localStorage.getItem(SKIP_VERSION_KEY))
  const isChecking = ref(false)

  let initialized = false

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI
  const isWindows = computed(() => window.electronAPI?.platform === 'win32')

  /** Windows 且官网下发了 GitCode 直链时，才展示应用内下载。 */
  const canInPlaceUpdate = computed(
    () => isWindows.value && !!info.value?.downloads?.win?.url,
  )

  /** 标题栏徽标展示条件：有更新，或已经在下载/已下载。 */
  const hasUpdate = computed(() =>
    ['available', 'downloading', 'downloaded', 'installing'].includes(status.value),
  )

  const isSkipped = computed(
    () => !!info.value?.version && skipVersion.value === info.value.version,
  )

  const isDownloading = computed(() => status.value === 'downloading')
  const isDownloaded = computed(() => status.value === 'downloaded')

  function handleStatus(payload: UpdateStatusPayload): void {
    switch (payload.status) {
      case 'checking':
        status.value = 'checking'
        break
      case 'available':
        info.value = payload.info || info.value
        status.value = 'available'
        progress.value = null
        error.value = undefined
        errorPhase.value = undefined
        break
      case 'not-available':
        status.value = 'not-available'
        progress.value = null
        break
      case 'downloading':
        status.value = 'downloading'
        progress.value = payload.progress || null
        error.value = undefined
        errorPhase.value = undefined
        break
      case 'downloaded':
        status.value = 'downloaded'
        progress.value = null
        downloadedVersion.value = payload.version || null
        if (payload.info) info.value = payload.info
        break
      case 'installing':
        status.value = 'installing'
        progress.value = null
        break
      case 'error':
        status.value = 'error'
        error.value = payload.error || ''
        errorPhase.value = payload.phase
        progress.value = null
        break
      default:
        break
    }
  }

  /** 在根组件或标题栏挂载时调用一次。 */
  function init(): void {
    if (initialized || !window.electronAPI) return
    initialized = true
    window.electronAPI.onUpdateStatus(handleStatus)
    void window.electronAPI
      .getUpdateState()
      .then((state) => {
        if (state) handleStatus(state)
      })
      .catch(() => {
        // 忽略：后续检查更新会刷新状态
      })
  }

  async function checkForUpdates(): Promise<void> {
    if (!window.electronAPI || isChecking.value) return
    isChecking.value = true
    status.value = 'checking'
    error.value = undefined
    errorPhase.value = undefined
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (!result.success) {
        status.value = 'error'
        errorPhase.value = 'check'
        error.value = result.error || ''
      }
    } catch (e: unknown) {
      status.value = 'error'
      errorPhase.value = 'check'
      error.value = errorMessage(e)
    } finally {
      isChecking.value = false
    }
  }

  async function startDownload(): Promise<void> {
    if (!isElectron) return
    if (!canInPlaceUpdate.value) {
      openManualDownload()
      return
    }
    error.value = undefined
    errorPhase.value = undefined
    downloadedVersion.value = null
    progress.value = {
      percent: 0,
      transferred: 0,
      total: Number(info.value?.downloads?.win?.size || 0),
      bytesPerSecond: 0,
    }
    status.value = 'downloading'
    try {
      const result = await window.electronAPI!.downloadUpdate()
      if (!result.success) {
        status.value = 'error'
        errorPhase.value = 'download'
        error.value = result.error || ''
      }
    } catch (e: unknown) {
      status.value = 'error'
      errorPhase.value = 'download'
      error.value = errorMessage(e)
    }
  }

  function cancelDownload(): void {
    void window.electronAPI?.cancelUpdateDownload()
    // 主进程随后会推送 available；这里先恢复按钮状态。
    if (status.value === 'downloading') status.value = 'available'
  }

  function installAndRestart(): void {
    if (!isElectron || status.value !== 'downloaded') return
    void window.electronAPI?.installUpdate().then((result) => {
      if (result && !result.success) {
        status.value = 'error'
        errorPhase.value = 'install'
        error.value = result.error || ''
      }
    })
  }

  function openManualDownload(): void {
    const url = info.value?.downloadUrl
    if (typeof url === 'string' && url) {
      void window.electronAPI?.openExternal(url)
    }
  }

  function openChangelog(): void {
    const url = info.value?.releaseNotes
    if (typeof url === 'string' && url) {
      void window.electronAPI?.openExternal(url)
    }
  }

  function dontRemind(): void {
    if (!info.value?.version) return
    skipVersion.value = info.value.version
    localStorage.setItem(SKIP_VERSION_KEY, info.value.version)
  }

  function cancelSkip(): void {
    skipVersion.value = null
    localStorage.removeItem(SKIP_VERSION_KEY)
  }

  return {
    status,
    info,
    progress,
    error,
    errorPhase,
    downloadedVersion,
    skipVersion,
    isChecking,
    isElectron,
    isWindows,
    canInPlaceUpdate,
    hasUpdate,
    isSkipped,
    isDownloading,
    isDownloaded,
    init,
    checkForUpdates,
    startDownload,
    cancelDownload,
    installAndRestart,
    openManualDownload,
    openChangelog,
    dontRemind,
    cancelSkip,
  }
})
