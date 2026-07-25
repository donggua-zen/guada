import { useStorage } from '@vueuse/core'

/**
 * 单个会话的预览标签缓存
 */
export interface SessionPreviewCache {
    /** 是否处于预览模式 */
    isPreviewMode: boolean
    /** 当前激活的文件标签路径 */
    activeFileTabPath: string | null
    /** 文件标签路径列表（按打开顺序） */
    fileTabs: string[]
}

const MAX_SESSIONS = 10

/**
 * 预览标签缓存 composable
 *
 * 使用 localStorage 持久化每个会话的预览状态（文件路径列表 + 预览模式开关）。
 * 采用 LRU 策略，最多保留最近 MAX_SESSIONS 个会话。
 * 浏览器标签不持久化（由 browserStore 管理）。
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

        return state
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
