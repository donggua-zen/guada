import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBrowserWebviewStore } from './browserWebview'
import type { UnifiedTab } from '@/composables/usePreviewTabCache'
import type { FileChangeEntry } from '@/composables/useFileChanges'

/**
 * 标签 Store — 统一管理文件标签和浏览器标签的状态
 *
 * tabs / activeTabKey 是唯一数据源，所有组件通过此 store 读写。
 * 工作区显示完全由激活标签驱动，无独立的面板模式。
 */
const MAX_FILE_TABS = 10

/** 打开文件标签的输入（key 由 store 统一生成为 file:<path>） */
interface FileTabInput {
    path: string
    name: string
    extension?: string
    size?: number
}

export const useTabStore = defineStore('tab', () => {
    const browserStore = useBrowserWebviewStore()

    /** 统一标签列表（文件 + 浏览器，按顺序排列） */
    const tabs = ref<UnifiedTab[]>([])

    /** 当前激活的标签 key（'file:<path>' 或 'browser:<windowId>'） */
    const activeTabKey = ref<string | null>(null)

    /**
     * diff 标签的运行时数据源：tab.key → FileChangeEntry。
     * 刻意不进 UnifiedTab（标签会被 previewTabCache 序列化到 localStorage，
     * 而 entry 携带 oldText/newText 可能很大）；标签只存骨架，内容留在这里。
     */
    const diffEntries = new Map<string, FileChangeEntry>()

    /**
     * 打开"编辑记录"标签（同一回合同一文件复用同一标签，已存在则直接激活）。
     * entry 是本回合从工具调用派生的编辑历史，多次编辑 = entry.operations 多条。
     */
    function openDiffTab(entry: FileChangeEntry, turnId: string): void {
        const key = `diff:${turnId}:${entry.filePath}`
        diffEntries.set(key, entry)
        if (!tabs.value.some(t => t.key === key)) {
            tabs.value.push({
                type: 'diff', key, name: entry.fileName,
                path: entry.filePath, turnId,
            })
        }
        selectTab(key)
    }

    /** 取某 diff 标签的编辑记录数据（无则 null，如刷新后标签骨架已过滤不恢复） */
    function getDiffEntry(key: string): FileChangeEntry | null {
        return diffEntries.get(key) ?? null
    }

    /** 打开 Git 审阅标签（标签唯一，已存在则直接激活） */
    function openGitTab(): void {
        if (!tabs.value.some(t => t.type === 'git')) {
            tabs.value.push({ type: 'git', key: 'git' })
        }
        selectTab('git')
    }

    /**
     * 打开"起始页"（无任何标签 或 点击 + 号时显示）。
     * 起始页不占用标签栏：清空激活标签即可（activeTabKey = null），
     * 不向 tabs 数组 push，因此标签栏不会出现对应标签。
     */
    function openNewTab(): void {
        selectTab(null)
    }

    /**
     * 打开工作目录浏览（概览面板"工作目录"入口）：
     * 激活的已是文件标签 → 保持不动（目录树已可见）；
     * 否则存在文件标签 → 选中标签栏最末一个；
     * 一个都没有 → 新建空文件标签（path 为空，右侧目录树可选文件）。
     */
    function openWorkspaceBrowseTab(name: string): void {
        const active = tabs.value.find(t => t.key === activeTabKey.value)
        if (active?.type === 'file') return
        const lastFile = tabs.value.filter(t => t.type === 'file').pop()
        if (lastFile) {
            selectTab(lastFile.key)
            return
        }
        const key = `file:new-${Date.now()}`
        addTab({ type: 'file', key, name, path: '', isPreview: true })
        selectTab(key)
    }

    /**
     * 设置激活文件标签的目录树显隐（每标签字段，随标签缓存持久化）。
     * 用于 WorkingDirBar 点目录名这类"显式浏览意图"：强制展开，覆盖该标签此前的收起状态。
     */
    function setActiveFileTabTreeVisible(visible: boolean): void {
        const active = tabs.value.find(t => t.key === activeTabKey.value)
        if (active?.type === 'file') active.treeVisible = visible
    }

    /**
     * 将指定标签固定为持久（双击标签栏的文件标签，与目录树双击打开文件同语义）。
     * 仅文件标签有预览态（isPreview），其他类型 no-op；已是持久则幂等。
     */
    function pinTab(key: string): void {
        const tab = tabs.value.find(t => t.key === key)
        if (tab?.type === 'file') tab.isPreview = false
    }

    /**
     * 在激活的文件标签中打开文件（目录树单击/双击：树仅在文件标签激活时可见，
     * 所以永远只作用于当前激活的文件标签，不会新开标签）。
     * 目标已打开 → 直接激活；否则把激活标签原位改键为 file:<path>，
     * 确保非空文件标签的 key 恒等于 file:<path>（删除/重命名/去重均按此 key 查找）。
     * options.persistent 为 true 时（双击）把目标标签固定为持久（isPreview = false）。
     * 返回 true 表示已消费该操作；false 表示当前没有文件标签（调用方可回退到预览标签）。
     */
    function openFileInActiveTab(file: FileTabInput, options: { persistent?: boolean } = {}): boolean {
        const active = tabs.value.find(t => t.key === activeTabKey.value)
        if (active?.type !== 'file') return false

        const nextKey = `file:${file.path}`
        if (nextKey === active.key) {
            if (options.persistent) active.isPreview = false
            return true
        }

        const existing = tabs.value.find(t => t.key === nextKey)
        if (existing) {
            // 目标文件已开在别的标签：丢弃当前空/旧标签，聚焦已有标签
            if (options.persistent) existing.isPreview = false
            removeTab(active.key)
            selectTab(nextKey)
            return true
        }

        const idx = tabs.value.indexOf(active)
        tabs.value.splice(idx, 1, {
            ...active,
            key: nextKey,
            path: file.path,
            name: file.name,
            extension: file.extension ?? active.extension,
            size: file.size ?? 0,
            isPreview: options.persistent ? false : active.isPreview,
        })
        selectTab(nextKey)
        return true
    }

    /**
     * 打开文件到唯一的预览标签（聊天文件变更条 / 文件引用；不依赖当前激活标签）。
     * 目标已打开 → 直接激活；已有预览文件标签（含空占位）→ 原位改键复用；
     * 否则新建预览标签。不会改动当前激活的持久标签。
     */
    function openFilePreview(file: FileTabInput): void {
        const nextKey = `file:${file.path}`
        const existing = tabs.value.find(t => t.key === nextKey)
        if (existing) {
            selectTab(nextKey)
            return
        }

        const previewTab = tabs.value.find(t => t.type === 'file' && t.isPreview)
        if (previewTab) {
            const idx = tabs.value.indexOf(previewTab)
            tabs.value.splice(idx, 1, {
                ...previewTab,
                key: nextKey,
                path: file.path,
                name: file.name,
                extension: file.extension ?? previewTab.extension,
                size: file.size ?? 0,
                isPreview: true,
            })
            selectTab(nextKey)
            return
        }

        addTab({
            type: 'file', key: nextKey, path: file.path, name: file.name,
            extension: file.extension, size: file.size ?? 0, isPreview: true,
        })
        selectTab(nextKey)
    }

    /** 打开终端标签（UI 终端，每会话限 3，由后端校验配额） */
    function openTerminalTab(sessionId: string): void {
        const id = `terminal:${sessionId}:${Date.now().toString(36)}`
        tabs.value.push({ type: 'terminal', key: id })
        selectTab(id)
    }

    /**
     * 打开后台进程日志标签（同一进程复用同一标签，已存在则直接激活）
     */
    function openProcessLogTab(sessionId: string, processId: string, command: string): void {
        const id = `processlog:${sessionId}:${processId}`
        const existing = tabs.value.find(t => t.key === id)
        if (existing) {
            // 同一进程命令可能已变化（如重启同 PID），同步元数据
            existing.command = command
        } else {
            tabs.value.push({ type: 'processlog', key: id, processId, command })
        }
        selectTab(id)
    }

    /**
     * 打开子代理会话标签（同一子代理复用同一标签，已存在则直接激活）。
     * 子代理与主会话同屏并存：中央面板恒显主会话，子代理在侧边栏标签内查看。
     */
    function openSubAgentTab(subSessionId: string, name: string): void {
        const id = `subagent:${subSessionId}`
        const existing = tabs.value.find(t => t.key === id)
        if (existing) {
            // 同一子代理名称可能变化（重命名），同步元数据
            existing.name = name
        } else {
            tabs.value.push({ type: 'subagent', key: id, name })
        }
        selectTab(id)
    }

    /**
     * 打开工作流审阅标签（每会话唯一）：审阅该会话全部 workflow run
     * （终态快照归档于 sessions/<sid>/workflows/，运行中 run 由引擎内存快照合并）。
     */
    function openWorkflowTab(sessionId: string): void {
        const id = `workflow:${sessionId}`
        if (!tabs.value.some(t => t.key === id)) {
            tabs.value.push({ type: 'workflow', key: id })
        }
        selectTab(id)
    }

    /**
     * 打开计划面板标签（每会话唯一）：列出该会话的全部计划（转录构建，含待审/已批/被拒），
     * 点击条目查看正文。入口常驻——有无计划都可进入（空态提示）。
     */
    function openPlanTab(sessionId: string): void {
        const id = `plan:${sessionId}`
        if (!tabs.value.some(t => t.key === id)) {
            tabs.value.push({ type: 'plan', key: id })
        }
        selectTab(id)
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

    function removeTab(key: string): void {
        const idx = tabs.value.findIndex(t => t.key === key)
        if (idx === -1) return
        tabs.value.splice(idx, 1)
        if (key.startsWith('diff:')) diffEntries.delete(key)
        if (activeTabKey.value === key) {
            const next = tabs.value[idx] || tabs.value[idx - 1] || null
            if (next) {
                selectTab(next.key)
            } else {
                selectTab(null)
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

    /** 外部激活浏览器窗口时，同步 activeTabKey */
    function syncActiveWindowId(): void {
        const active = browserStore.activeWindowId
        if (active && activeTabKey.value !== `browser:${active}`) {
            activeTabKey.value = `browser:${active}`
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
    }

    // ── 会话切换清理 ──

    function clearAll(): void {
        tabs.value = []
        activeTabKey.value = null
        diffEntries.clear()
    }

    return {
        tabs,
        activeTabKey,
        openGitTab,
        openNewTab,
        openWorkspaceBrowseTab,
        openFileInActiveTab,
        openFilePreview,
        setActiveFileTabTreeVisible,
        pinTab,
        openTerminalTab,
        openProcessLogTab,
        openSubAgentTab,
        openWorkflowTab,
        openPlanTab,
        openDiffTab,
        getDiffEntry,
        selectTab,
        addTab,
        removeTab,
        reorderTab,
        syncActiveWindowId,
        syncBrowserTabs,
        clearAll,
    }
})
