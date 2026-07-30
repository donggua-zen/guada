import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useBrowserWebviewStore } from './browserWebview'
import { useLayoutStore } from './layout'
import type { UnifiedTab } from '@/composables/usePreviewTabCache'

/**
 * 标签 Store — 统一管理文件标签和浏览器标签的状态
 *
 * tabs / activeTabKey 是唯一数据源，所有组件通过此 store 读写。
 * workspacePreviewMode 由 layoutStore 管理，tabStore 通过 computed 暴露。
 */
const MAX_FILE_TABS = 10

export const useTabStore = defineStore('tab', () => {
    const browserStore = useBrowserWebviewStore()
    const layoutStore = useLayoutStore()

    /** 统一标签列表（文件 + 浏览器，按顺序排列） */
    const tabs = ref<UnifiedTab[]>([])

    /** 当前激活的标签 key（'file:<path>' 或 'browser:<windowId>'） */
    const activeTabKey = ref<string | null>(null)

    /** 是否处于预览模式 */
    const isPreviewMode = computed(() => layoutStore.workspacePreviewMode)

    // ── 模式切换 ──

    function enterPreviewMode(): void {
        layoutStore.workspacePreviewMode = true
    }

    function exitPreviewMode(): void {
        layoutStore.workspacePreviewMode = false
    }

    // ── 标签选中（幂等，不加载内容） ──

    function selectTab(key: string | null): void {
        activeTabKey.value = key
        if (key?.startsWith('browser:')) {
            const windowId = key.slice(8)
            browserStore.setActive(windowId)
        } else {
            // file 标签或 null：取消浏览器激活
            browserStore.setActive(null)
        }
        // 更新最后访问时间（LRU 依据）
        if (key) {
            const tab = tabs.value.find(t => t.key === key)
            if (tab) tab.lastAccessedAt = Date.now()
        }
    }

    // ── 标签增删 ──

    function addTab(tab: UnifiedTab): void {
        // 初始化访问时间
        if (tab.type === 'file' && !tab.lastAccessedAt) {
            tab.lastAccessedAt = Date.now()
        }

        // 已存在的标签直接返回（不触发临时标签替换）
        if (tabs.value.some(t => t.key === tab.key)) return

        // 新标签且为临时：先移除已有的其他临时标签（替换语义）
        if (tab.type === 'file' && tab.isPreview) {
            const existingPreview = tabs.value.find(
                t => t.type === 'file' && t.isPreview && t.key !== tab.key
            )
            if (existingPreview) {
                removeTab(existingPreview.key)
            }
        }

        tabs.value.push(tab)
        // 文件标签超出上限时，淘汰策略：
        // 1. 优先淘汰临时标签（非激活的）
        // 2. 其次淘汰 lastAccessedAt 最小（最久未访问）的非激活持久标签
        if (tab.type === 'file') {
            const fileTabs = tabs.value.filter(t => t.type === 'file')
            if (fileTabs.length > MAX_FILE_TABS) {
                evictFileTab()
            }
        }
    }

    /** 淘汰一个文件标签：优先临时，其次 LRU */
    function evictFileTab(): void {
        // 优先淘汰非激活的临时标签
        const previewTab = tabs.value.find(
            t => t.type === 'file' && t.isPreview && t.key !== activeTabKey.value
        )
        if (previewTab) {
            removeTab(previewTab.key)
            return
        }
        // 其次淘汰 lastAccessedAt 最小（最久未访问）的非激活持久标签
        let oldest: UnifiedTab | null = null
        for (const t of tabs.value) {
            if (t.type !== 'file' || t.key === activeTabKey.value) continue
            if (!oldest || (t.lastAccessedAt || 0) < (oldest.lastAccessedAt || 0)) {
                oldest = t
            }
        }
        if (oldest) removeTab(oldest.key)
    }

    /** 临时标签提升为持久 */
    function promoteTab(key: string): void {
        const tab = tabs.value.find(t => t.key === key)
        if (tab && tab.isPreview) {
            tab.isPreview = false
        }
    }

    function removeTab(key: string): void {
        const idx = tabs.value.findIndex(t => t.key === key)
        if (idx === -1) return
        tabs.value.splice(idx, 1)
        if (activeTabKey.value === key) {
            const next = tabs.value[idx] || tabs.value[idx - 1] || null
            if (next) {
                selectTab(next.key)
            } else {
                selectTab(null)
                exitPreviewMode()
            }
        }
    }

    /** 拖拽重排 */
    function reorderTab(from: number, to: number): void {
        if (from < 0 || from === to || from >= tabs.value.length) return
        const item = tabs.value.splice(from, 1)[0]
        tabs.value.splice(to, 0, item)
    }

    // ── 浏览器 store 同步 ──

    /** 外部激活浏览器窗口时，同步 activeTabKey 并自动进入预览模式 */
    function syncActiveWindowId(): void {
        const active = browserStore.activeWindowId
        if (active && activeTabKey.value !== `browser:${active}`) {
            activeTabKey.value = `browser:${active}`
            enterPreviewMode()
        }
    }

    /** 浏览器标签增删 + 元数据同步（由 WorkspaceSidebar 的 watch 调用） */
    function syncBrowserTabs(webviews: { windowId: string; title: string; favicon?: string; url: string }[]): void {
        const ids = new Set(webviews.map(w => w.windowId))

        // 移除已关闭的浏览器标签
        const toRemove = tabs.value
            .filter(t => t.type === 'browser' && !ids.has(t.windowId!))
            .map(t => t.key)
        for (const key of toRemove) removeTab(key)

        // 新增 + 更新元数据
        for (const wv of webviews) {
            const key = `browser:${wv.windowId}`
            const existing = tabs.value.find(t => t.key === key)
            if (!existing) {
                tabs.value.push({
                    type: 'browser', key, windowId: wv.windowId,
                    title: wv.title, favicon: wv.favicon, url: wv.url,
                })
            } else {
                existing.title = wv.title
                existing.favicon = wv.favicon
                existing.url = wv.url
            }
        }

        // 全部标签关闭时退出预览模式
        if (tabs.value.length === 0 && isPreviewMode.value) {
            exitPreviewMode()
        }
    }

    // ── 会话切换清理 ──

    function clearAll(): void {
        tabs.value = []
        activeTabKey.value = null
    }

    return {
        tabs,
        activeTabKey,
        isPreviewMode,
        enterPreviewMode,
        exitPreviewMode,
        selectTab,
        addTab,
        removeTab,
        reorderTab,
        promoteTab,
        syncActiveWindowId,
        syncBrowserTabs,
        clearAll,
    }
})
