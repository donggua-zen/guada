/**
 * 链接打开方式工具
 *
 * 根据用户设置（内置浏览器 / 外部浏览器 / 每次询问）决定如何打开链接。
 * 设置缓存在 localStorage 中以支持同步读取，同时持久化到后端 settings API。
 */
import { ElMessageBox } from 'element-plus'
import { useBrowserWebviewStore } from '@/stores/browserWebview'
import { useSessionStore } from '@/stores/session'

export type LinkOpenMode = 'internal' | 'external' | 'ask'

const STORAGE_KEY = 'linkOpenMode'
const SETTINGS_GROUP = 'browser'

let cachedMode: LinkOpenMode | null = null

/** 从 localStorage 同步读取（首次调用时初始化） */
function getCachedMode(): LinkOpenMode {
  if (cachedMode === null) {
    const stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY)
      : null
    cachedMode = (stored as LinkOpenMode) || 'ask'
  }
  return cachedMode
}

/** 更新缓存（供设置页面调用） */
export function setLinkOpenMode(mode: LinkOpenMode): void {
  cachedMode = mode
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, mode)
  }
}

/** 获取当前链接打开方式 */
export function getLinkOpenMode(): LinkOpenMode {
  return getCachedMode()
}

/** 从后端加载设置（应用启动时调用一次即可） */
export async function loadLinkOpenMode(): Promise<void> {
  try {
    const { apiService } = await import('@/services/ApiService')
    const response = await apiService.fetchGroupSettings(SETTINGS_GROUP)
    const mode = response.linkOpenMode as LinkOpenMode | undefined
    if (mode && ['internal', 'external', 'ask'].includes(mode)) {
      setLinkOpenMode(mode)
    }
  } catch {
    // 后端不可用时降级使用 localStorage 缓存
  }
}

/** 判断是否为安全链接（仅允许 http/https） */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 在内置浏览器中打开 */
async function openInInternalBrowser(url: string): Promise<void> {
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI !== undefined
  if (!isElectron || !(window as any).electronAPI?.createBrowserWindow) {
    // 非桌面端降级为新标签页
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    // 获取当前会话 ID
    let sessionId: string | undefined
    try {
      const sessionStore = useSessionStore()
      sessionId = sessionStore.activeSessionId || undefined
    } catch {
      // store 未初始化时忽略
    }

    const result = await (window as any).electronAPI.createBrowserWindow(url, {
      sessionId,
      createdBy: sessionId,
    })

    if (result.success && result.window?.windowId) {
      // createWindow 的 Promise 在 webview attach 完成后才 resolve，
      // 此时 browser:create-webview 事件已先于 invoke 响应到达前端，
      // webview 确定已在 store 中，可直接激活
      const store = useBrowserWebviewStore()
      store.setActive(result.window.windowId)
    }
  } catch (error) {
    console.error('[linkOpener] Failed to open in internal browser:', error)
    // 降级到外部浏览器
    ;(window as any).electronAPI?.openExternal?.(url)
  }
}

/** 在外部浏览器中打开 */
function openInExternalBrowser(url: string): void {
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI !== undefined
  if (isElectron) {
    ;(window as any).electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** 弹窗询问用户选择打开方式 */
async function showLinkChoiceDialog(url: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      url,
      '选择链接打开方式',
      {
        confirmButtonText: '内置浏览器',
        cancelButtonText: '外部浏览器',
        distinguishCancelAndClose: true,
        type: 'info',
        customClass: 'link-choice-dialog',
      },
    )
    // 用户点击"内置浏览器"
    await openInInternalBrowser(url)
  } catch (action: any) {
    if (action === 'cancel') {
      // 用户点击"外部浏览器"
      openInExternalBrowser(url)
    }
    // action === 'close' → 用户关闭弹窗，不打开
  }
}

/**
 * 打开链接（核心入口）
 *
 * 根据用户设置自动选择打开方式：
 * - internal: 内置浏览器
 * - external: 外部浏览器
 * - ask: 每次询问
 *
 * 非 http/https 链接始终通过外部浏览器打开。
 */
export async function openLink(url: string): Promise<void> {
  if (!url) return

  // 非 http/https 协议直接交给外部处理（mailto:, tel: 等）
  if (!isSafeUrl(url)) {
    openInExternalBrowser(url)
    return
  }

  const mode = getCachedMode()
  switch (mode) {
    case 'internal':
      await openInInternalBrowser(url)
      break
    case 'external':
      openInExternalBrowser(url)
      break
    case 'ask':
    default:
      await showLinkChoiceDialog(url)
      break
  }
}
