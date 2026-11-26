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

import { nextTick } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useTabStore } from '@/stores/tab'
import { useWorkspaceTreeStore } from '@/stores/workspaceTree'
import { openInExternalBrowser } from '@/utils/browserUtils'
import { baseNameOf, extensionOf, fileUrlToPath, isAbsoluteLocalPath, localPathFromHref, toWorkspaceRelative } from '@/utils/localPath'
import { openModal } from '@/components/ui/modalService'
import { t } from '@/locales'

// ── 链接打开方式偏好管理 ──

export type LinkOpenMode = 'internal' | 'external' | 'ask'

const STORAGE_KEY = 'linkOpenMode'
const AUTO_SHOW_SIDEBAR_KEY = 'autoShowSidebar'

let cachedMode: LinkOpenMode | null = null

/** autoShowSidebar 缓存（默认 false：不自动展开侧边栏） */
let cachedAutoShowSidebar: boolean | null = null

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

// ── AI 浏览器侧边栏自动展开管理 ──
// （后端读取已并入 browserViewport 的 loadBrowserSettings：browser 分组启动期只拉一次）

/** 同步读取 autoShowSidebar 缓存（首次调用时从 localStorage 初始化） */
export function getAutoShowSidebar(): boolean {
    if (cachedAutoShowSidebar === null) {
        const stored = typeof localStorage !== 'undefined'
            ? localStorage.getItem(AUTO_SHOW_SIDEBAR_KEY)
            : null
        cachedAutoShowSidebar = stored === 'true'
    }
    return cachedAutoShowSidebar
}

/** 更新 autoShowSidebar 缓存（供设置页面调用） */
export function setAutoShowSidebar(val: boolean): void {
    cachedAutoShowSidebar = val
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AUTO_SHOW_SIDEBAR_KEY, String(val))
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
    const result = await openModal({
        title: t('session.workspace.selectLinkMode'),
        content: url,
        icon: 'info',
        size: 'xs',
        showCancel: true,
        confirmText: t('session.workspace.internalBrowser'),
        cancelText: t('session.workspace.externalBrowser'),
        closeOnClickModal: false,
    })

    if (result.action === 'confirm') {
        await previewUrl(url)
    } else if (result.action === 'cancel') {
        openInExternalBrowser(url)
    }
}

// ── 预览 API（统一入口） ──

/**
 * 展开工作区侧边栏并把文件开进预览标签。
 *
 * 侧边栏从隐藏→可见时 WorkspaceSidebar 需要一个 tick 完成挂载并注册 watch，
 * 这一步放在这里，让「工作区内」「工作区外」两个入口走同一套时序。
 */
async function revealWorkspaceAndOpen(tabInput: {
    path: string
    name: string
    extension: string
    size: number
    outsideWorkspace?: boolean
}): Promise<void> {
    const layoutStore = useLayoutStore()
    const wasVisible = layoutStore.workspaceVisible
    layoutStore.workspaceVisible = true

    if (!wasVisible) {
        await nextTick()
    }

    // 打开到唯一的预览标签（复用已有预览标签，不新建/改动持久标签）
    useTabStore().openFilePreview(tabInput)
}

/**
 * 预览工作区文件（打开文件预览标签）
 *
 * 直接通过 tabStore 操作：添加标签 + 选中 + 进入预览模式。
 * WorkspaceSidebar 的 watch 会自动加载文件内容。
 *
 * 入参既可能是工作区相对路径（目录树/文件变更条），也可能是本机绝对路径
 * （工具行 file_path 允许模型写绝对路径）。绝对路径必须先做归属判定：
 * 工作区内 → 转相对路径；工作区外 → outsideWorkspace 分支，绝不能拿它当
 * 相对路径拼到工作目录下（会拼出 `D:/ws/C:/Users/...` 并让后端 403）。
 */
export async function previewFile(filePath: string): Promise<void> {
    const sessionStore = useSessionStore()
    if (!sessionStore.activeSessionId) return

    let targetPath = filePath
    if (isAbsoluteLocalPath(filePath)) {
        const workspaceDir = await useWorkspaceTreeStore().ensureWorkspacePath(sessionStore.activeSessionId)
        const relativePath = workspaceDir ? toWorkspaceRelative(filePath, workspaceDir) : null
        // "" / null：指向工作区根目录本身、工作区外，或工作目录不可知，都无法作为文件标签预览
        if (!relativePath) {
            await previewExternalFile(filePath)
            return
        }
        targetPath = relativePath
    }

    const name = baseNameOf(targetPath) || targetPath
    await revealWorkspaceAndOpen({
        path: targetPath,
        name,
        extension: extensionOf(name),
        size: 0,
    })
}

/**
 * 预览工作区外的本地文件：不请求后端（路径牢笼必然 403），
 * 标签打上 outsideWorkspace，由面板给出提示 + 「用系统程序打开」。
 */
export async function previewExternalFile(absolutePath: string): Promise<void> {
    const sessionStore = useSessionStore()
    if (!sessionStore.activeSessionId) return

    const name = baseNameOf(absolutePath) || absolutePath
    await revealWorkspaceAndOpen({
        path: absolutePath,
        name,
        extension: extensionOf(name),
        size: 0,
        outsideWorkspace: true,
    })
}

/**
 * 打开 file:// 链接（markdown 里指向本地文件的链接）。
 *
 * 决策链：URL 解析失败 → 交回外部打开；解析成功且在工作区内 → 相对路径预览；
 * 工作区外 → 外部文件预览（附带系统程序打开入口）。不弹窗，点击即开。
 */
export async function openLocalFileLink(url: string): Promise<void> {
    const absolutePath = fileUrlToPath(url)
    if (!absolutePath) {
        openInExternalBrowser(url)
        return
    }
    await openLocalAbsolutePath(absolutePath)
}

/**
 * 打开本机绝对路径（file:// 链接 / markdown 里的裸绝对路径共用）。
 *
 * 工作区内 → 转相对路径走工作区预览；工作区外 → 外部文件预览
 * （图片等可直出类型仍可展示，其余给「用系统程序打开」入口）。
 * 归属判定统一收敛在 previewFile（它本身就接受绝对路径）。
 */
export async function openLocalAbsolutePath(absolutePath: string): Promise<void> {
    await previewFile(absolutePath)
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
 * - file:// → 直接在侧边栏预览本地文件（不弹窗：本地文件没有「内置/外部浏览器」之分）
 * - internal: 内置浏览器预览
 * - external: 外部浏览器
 * - ask: 每次询问
 *
 * 其余非 http/https 链接（mailto:、vscode: 等）仍交外部处理。
 */
export async function openLink(url: string): Promise<void> {
    if (!url) return
    // 页内锚点：没有可打开的目标（此前会被当成非法外链，白白报一次协议错误）
    if (url.startsWith('#')) return

    if (/^file:/i.test(url)) {
        await openLocalFileLink(url)
        return
    }

    // markdown 里的本机绝对路径（`/D:/a.png`、`D:\a.png`、UNC）：
    // 浏览器会当成非法 scheme，交给外部浏览器只会被协议白名单拒绝，
    // 因此必须在协议判定前拦下，走本地文件预览链路。
    const localPath = localPathFromHref(url)
    if (localPath) {
        await openLocalAbsolutePath(localPath)
        return
    }

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
 * - file:// → 本地文件（工作区内走预览标签，工作区外走系统程序提示）
 * - 其他 → 工作区文件预览
 */
export function preview(target: string): void {
    if (/^https?:\/\//i.test(target)) {
        void previewUrl(target)
    } else if (/^file:/i.test(target)) {
        void openLocalFileLink(target)
    } else {
        void previewFile(target)
    }
}
