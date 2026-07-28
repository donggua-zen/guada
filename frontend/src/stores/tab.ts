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
    }

    // ── 标签增删 ──

    function addTab(tab: UnifiedTab): void {
        if (!tabs.value.some(t => t.key === tab.key)) {
            tabs.value.push(tab)
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
        syncActiveWindowId,
        syncBrowserTabs,
        clearAll,
    }
})
