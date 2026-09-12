import { useStorage } from '@vueuse/core'

/**
 * 统一标签（文件 / 浏览器 / Git 审阅 / 终端 / 进程日志）
 */
export interface UnifiedTab {
    /**
     * 'newtab' 仅作遗留兼容：起始页不占用标签栏（openNewTab 只清空 activeTabKey），
     * 此处保留类型以便缓存恢复时过滤旧数据。
     */
    type: 'file' | 'browser' | 'git' | 'terminal' | 'processlog' | 'subagent' | 'workflow' | 'newtab';
    key: string;       // 'file:<path>' / 'browser:<windowId>' / 'git' / 'terminal:<sessionId>:<id>' / 'processlog:<sessionId>:<pid>' / 'subagent:<subSessionId>' / 'workflow:<sessionId>' / 'newtab:<id>'
    // file
    path?: string;
    name?: string;
    extension?: string;
    size?: number;
    lastAccessedAt?: number;  // 最后访问时间戳（LRU 淘汰依据）
    isPreview?: boolean;       // 临时标签标记（单击打开为临时，双击打开为持久）
    // browser
    windowId?: string;
    title?: string;
    favicon?: string;
    url?: string;
    // terminal
    cwd?: string;
    terminalId?: string;
    // processlog（后台进程日志）
    processId?: string;   // 后台进程 ID（ProcessManagerService entry.id）
    command?: string;     // 进程命令（标签标题与日志面板头部展示）
}

/**
 * 单个会话的预览标签缓存（显示完全由激活标签驱动，无面板模式字段）
 */
export interface SessionPreviewCache {
    /** 当前激活的标签统一标识（如 'file:src/index.ts' 或 'browser:win_123'），无则为 null */
    activeTabKey: string | null
    /** 完整标签列表（含浏览器元数据，保留顺序） */
    tabs: UnifiedTab[]
    /**
     * @deprecated 旧版缓存字段（isPreviewMode/gitMode 双布尔），仅用于一次性迁移读取
     */
    isPreviewMode?: boolean
    gitMode?: boolean
}

const MAX_SESSIONS = 10

/**
 * 预览标签缓存 composable
 *
 * 使用 localStorage 持久化每个会话的完整预览状态（标签列表 + 预览模式开关 + 激活标签）。
 * 采用 LRU 策略，最多保留最近 MAX_SESSIONS 个会话。
 * 浏览器标签的元数据（title/favicon/url）也一并持久化，webview 生命周期由 browserStore 管理。
 */
export function usePreviewTabCache() {
    /** 所有会话的缓存，按最近使用排序（index 0 = 最近） */
    const cache = useStorage<Record<string, SessionPreviewCache>>('previewTabsCache', {})
    /** 会话使用顺序（LRU），index 0 = 最近使用 */
    const lruOrder = useStorage<string[]>('previewTabsLRU', [])

    /** 保存会话的预览状态 */
    function saveSession(sessionId: string, state: SessionPreviewCache): void {
        cache.value[sessionId] = state

        // LRU: 移到最前
        const idx = lruOrder.value.indexOf(sessionId)
        if (idx !== -1) {
            lruOrder.value.splice(idx, 1)
        }
        lruOrder.value.unshift(sessionId)

        // 超出上限，淘汰最旧的
        if (lruOrder.value.length > MAX_SESSIONS) {
            const evicted = lruOrder.value.splice(MAX_SESSIONS)
            for (const sid of evicted) {
                delete cache.value[sid]
            }
        }
    }

    /** 读取会话的预览状态，不存在返回 null */
    function getSession(sessionId: string): SessionPreviewCache | null {
        const state = cache.value[sessionId]
        if (!state) return null

        // LRU: 移到最前
        const idx = lruOrder.value.indexOf(sessionId)
        if (idx > 0) {
            lruOrder.value.splice(idx, 1)
            lruOrder.value.unshift(sessionId)
        }

        return cache.value[sessionId]
    }

    /** 删除会话的缓存 */
    function removeSession(sessionId: string): void {
        delete cache.value[sessionId]
        const idx = lruOrder.value.indexOf(sessionId)
        if (idx !== -1) {
            lruOrder.value.splice(idx, 1)
        }
    }

    return {
        saveSession,
        getSession,
        removeSession,
    }
}
