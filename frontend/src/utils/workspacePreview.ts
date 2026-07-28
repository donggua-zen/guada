/**
 * 工作区预览统一入口
 *
 * 职责：
 * 1. 链接打开方式管理（用户偏好：内置浏览器 / 外部浏览器 / 每次询问）
 * 2. 文件预览（通过 tabStore 直接操作）
 * 3. URL 预览（在内置浏览器中打开）
 *
 * 所有预览操作都会自动确保工作区侧边栏可见 + 进入预览模式。
 */

import { ElMessageBox } from 'element-plus'
import { nextTick } from 'vue'
import { useBrowserWebviewStore } from '@/stores/browserWebview'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useTabStore } from '@/stores/tab'
import { openInExternalBrowser } from '@/utils/browserUtils'

// ── 链接打开方式偏好管理 ──

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

// ── 内部工具 ──

/** 判断是否为安全链接（仅允许 http/https） */
function isSafeUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
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
        await previewUrl(url)
    } catch (action: any) {
        if (action === 'cancel') {
            openInExternalBrowser(url)
        }
    }
}

// ── 预览 API（统一入口） ──

/**
 * 预览工作区文件（打开文件预览标签）
 *
 * 直接通过 tabStore 操作：添加标签 + 选中 + 进入预览模式。
 * WorkspaceSidebar 的 watch 会自动加载文件内容。
 */
export async function previewFile(filePath: string): Promise<void> {
    const sessionStore = useSessionStore()
    if (!sessionStore.activeSessionId) return

    const layoutStore = useLayoutStore()
    const wasVisible = layoutStore.workspaceVisible
    layoutStore.workspaceVisible = true

    // 侧边栏从隐藏→可见时，WorkspaceSidebar 需要一个 tick 完成挂载并注册 watch
    if (!wasVisible) {
        await nextTick()
    }

    const tabStore = useTabStore()
    const name = filePath.replace(/\\/g, '/').split('/').pop() || filePath
    const ext = name.includes('.') ? name.substring(name.lastIndexOf('.')).toLowerCase() : ''
    const tabKey = `file:${filePath}`

    tabStore.addTab({
        type: 'file',
        key: tabKey,
        name,
        path: filePath,
        extension: ext,
        size: 0,
    })
    tabStore.enterPreviewMode()
    tabStore.selectTab(tabKey)
}

/**
 * 预览 URL（在内置浏览器中打开）
 *
 * 创建浏览器窗口，setActive 后 tabStore 的 watch 自动同步标签。
 */
export async function previewUrl(url: string): Promise<void> {
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
    if (!isElectron || !window.electronAPI?.createBrowserWindow) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
    }

    try {
        let sessionId: string | undefined
        try {
            const sessionStore = useSessionStore()
            sessionId = sessionStore.activeSessionId || undefined
        } catch {
            // store 未初始化时忽略
        }

        const result = await window.electronAPI!.createBrowserWindow(url, {
            sessionId,
            createdBy: sessionId,
        })

        if (result.success && result.window?.windowId) {
            const layoutStore = useLayoutStore()
            const wasVisible = layoutStore.workspaceVisible
            layoutStore.workspaceVisible = true

            // 侧边栏从隐藏→可见时，WorkspaceSidebar 需要一个 tick 完成挂载
            if (!wasVisible) {
                await nextTick()
            }

            const tabStore = useTabStore()
            tabStore.enterPreviewMode()
            tabStore.selectTab(`browser:${result.window.windowId}`)
        }
    } catch (error) {
        console.error('[workspacePreview] Failed to open URL:', error)
        window.electronAPI?.openExternal?.(url)
    }
}

/**
 * 打开链接（根据用户偏好自动选择方式）
 *
 * - internal: 内置浏览器预览
 * - external: 外部浏览器
 * - ask: 每次询问
 *
 * 非 http/https 链接始终通过外部浏览器打开。
 */
export async function openLink(url: string): Promise<void> {
    if (!url) return

    if (!isSafeUrl(url)) {
        openInExternalBrowser(url)
        return
    }

    const mode = getCachedMode()
    switch (mode) {
        case 'internal':
            await previewUrl(url)
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

/**
 * 智能预览：自动判断是文件路径还是 URL
 * - http(s):// → 内置浏览器
 * - 其他 → 工作区文件预览
 */
export function preview(target: string): void {
    if (/^https?:\/\//i.test(target)) {
        void previewUrl(target)
    } else {
        void previewFile(target)
    }
}
