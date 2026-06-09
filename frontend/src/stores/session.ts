// stores/session.ts
import { defineStore } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import type { Session, SessionState, SessionSettings } from '@/types/session'

/**
 * 未分组的默认分组ID（虚拟ID，不对应后端实体）
 */
export const UNGROUPED_ID = '__ungrouped__'

/**
 * 会话状态 Store
 * 采用 "单一 Map + 分组视图" 架构，sessionsMap 是所有会话的唯一数据源
 */
export const useSessionStore = defineStore('session', () => {
    // 状态
    const activeSessionId: Ref<string | null> = ref(null)

    /**
     * 所有会话的唯一数据源 Map<sessionId, Session>
     * 取代旧的 sessionsList，按 ID 索引便于快速查找和更新
     */
    const sessionsMap: Ref<Map<string, Session>> = ref(new Map())

    /**
     * 兼容旧代码：基于 sessionsMap 的计算属性，按 lastActiveAt 降序排列
     */
    const sessionsList = computed((): Session[] => {
        return Array.from(sessionsMap.value.values()).sort((a, b) => {
            const timeA = new Date(a.lastActiveAt || a.updatedAt || 0).getTime()
            const timeB = new Date(b.lastActiveAt || b.updatedAt || 0).getTime()
            return timeB - timeA
        })
    })

    /**
     * 每个分组已加载的会话数量 Map<groupId, count>
     */
    const loadedCounts: Ref<Map<string, number>> = ref(new Map())

    /**
     * 每个分组是否还有更多会话 Map<groupId, boolean>
     */
    const hasMoreMap: Ref<Map<string, boolean>> = ref(new Map())

    const sessions: Ref<Map<string, SessionState>> = ref(new Map())

    // 会话侧边栏状态（未读 / 工作中）
    const sessionSidebarStates: Ref<Map<string, { unread: boolean; working: boolean }>> = ref(new Map())

    /**
     * 获取或初始化会话状态
     * @param sessionId - 会话 ID
     */
    const getSessionState = (sessionId: string): SessionState => {
        if (!sessions.value.has(sessionId)) {
            sessions.value.set(sessionId, {
                messages: [],
                isStreaming: false,
                isCompressing: false,
                inputMessage: {
                    content: '',
                    files: [],
                    isWaiting: false,
                },
                scrollPosition: 0,
                lastUpdated: Date.now(),
                settings: {
                }
            })
        }
        return sessions.value.get(sessionId)!
    }

    /**
     * 批量设置会话列表（用于初始化加载）
     * @param list - 会话列表
     */
    const setChatSidebar = (list: Session[]): void => {
        for (const session of list) {
            sessionsMap.value.set(session.id, session)
        }
    }

    /**
     * 添加或更新单个会话
     * @param session - 会话对象
     */
    const setSession = (session: Session): void => {
        sessionsMap.value.set(session.id, session)
    }

    /**
     * 根据 ID 获取会话
     * @param sessionId - 会话 ID
     */
    const getSession = (sessionId: string): Session | undefined => {
        return sessionsMap.value.get(sessionId)
    }

    /**
     * 移除会话
     * @param sessionId - 会话 ID
     */
    const removeSession = (sessionId: string): void => {
        sessionsMap.value.delete(sessionId)
    }

    /**
     * 按分组获取会话列表（已按 lastActiveAt 降序排序）
     * @param groupId - 分组ID，null 表示未分组
     */
    const getSessionsByGroup = (groupId: string | null): Session[] => {
        const targetGroupId = groupId === UNGROUPED_ID ? null : groupId
        return Array.from(sessionsMap.value.values())
            .filter(s => (s.groupId || null) === targetGroupId)
            .sort((a, b) => {
                const timeA = new Date(a.lastActiveAt || a.updatedAt || 0).getTime()
                const timeB = new Date(b.lastActiveAt || b.updatedAt || 0).getTime()
                return timeB - timeA
            })
    }

    /**
     * 获取指定分组的会话总数
     * @param groupId - 分组ID
     */
    const getGroupTotal = (groupId: string | null): number => {
        const targetGroupId = groupId === UNGROUPED_ID ? null : groupId
        return Array.from(sessionsMap.value.values())
            .filter(s => (s.groupId || null) === targetGroupId).length
    }

    /**
     * 移动会话到指定分组
     * @param sessionId - 会话 ID
     * @param targetGroupId - 目标分组ID（null 或 UNGROUPED_ID 表示未分组）
     */
    const moveSession = (sessionId: string, targetGroupId: string | null): void => {
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            session.groupId = targetGroupId === UNGROUPED_ID ? null : targetGroupId
        }
    }

    /**
     * 更新会话分组ID
     * @param sessionId - 会话 ID
     * @param groupId - 新分组ID
     */
    const setSessionGroupId = (sessionId: string, groupId: string | null): void => {
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            session.groupId = groupId
        }
    }

    /**
     * 更新分组已加载数量
     * @param groupId - 分组ID
     * @param count - 已加载数量
     */
    const setLoadedCount = (groupId: string, count: number): void => {
        loadedCounts.value.set(groupId, count)
    }

    /**
     * 获取分组已加载数量
     * @param groupId - 分组ID
     */
    const getLoadedCount = (groupId: string): number => {
        return loadedCounts.value.get(groupId) ?? 0
    }

    /**
     * 更新分组是否还有更多会话
     * @param groupId - 分组ID
     * @param hasMore - 是否还有更多
     */
    const setHasMore = (groupId: string, hasMore: boolean): void => {
        hasMoreMap.value.set(groupId, hasMore)
    }

    /**
     * 获取分组是否还有更多会话
     * @param groupId - 分组ID
     */
    const groupHasMore = (groupId: string): boolean => {
        return hasMoreMap.value.get(groupId) ?? true
    }

    /**
     * 获取消息列表
     * @param sessionId - 会话 ID
     */
    const getMessages = (sessionId: string): any[] => {
        return getSessionState(sessionId).messages
    }

    /**
     * 添加消息
     * @param sessionId - 会话 ID
     * @param message - 消息对象
     */
    const addMessage = (sessionId: string, message: any): void => {
        const session = getSessionState(sessionId)
        session.messages.push(message)
        session.lastUpdated = Date.now()
    }

    /**
     * 设置消息列表
     * @param sessionId - 会话 ID
     * @param newMessages - 新消息列表
     */
    const setMessages = (sessionId: string, newMessages: any[]): void => {
        const session = getSessionState(sessionId)
        session.messages.splice(0, session.messages.length, ...newMessages)
        session.lastUpdated = Date.now()
    }

    /**
     * 在消息列表前部插入消息（用于加载历史消息）
     * @param sessionId - 会话 ID
     * @param newMessages - 要插入的消息列表
     */
    const prependMessages = (sessionId: string, newMessages: any[]): void => {
        const session = getSessionState(sessionId)
        session.messages.unshift(...newMessages)
        session.lastUpdated = Date.now()
    }

    /**
     * 获取最早的消息 ID（用于分页加载更早消息）
     * @param sessionId - 会话 ID
     * @returns 最早消息的 ID，如果没有则返回 null
     */
    const getEarliestMessageId = (sessionId: string): string | null => {
        const messages = getSessionState(sessionId).messages
        return messages.length > 0 ? messages[0].id : null
    }

    /**
     * 获取最新消息 ID
     * @param sessionId - 会话 ID
     * @returns 最新消息的 ID，如果没有则返回 null
     */
    const getLatestMessageId = (sessionId: string): string | null => {
        const messages = getSessionState(sessionId).messages
        return messages.length > 0 ? messages[messages.length - 1].id : null
    }

    /**
     * 删除消息
     * @param sessionId - 会话 ID
     * @param messageId - 消息 ID
     */
    const deleteMessage = (sessionId: string, messageId: string): void => {
        const session = getSessionState(sessionId)
        const index = session.messages.findIndex((m: any) => m.id === messageId)
        if (index !== -1) {
            session.messages.splice(index, 1)
            session.lastUpdated = Date.now()
        }
    }

    /**
     * 更新消息
     * @param sessionId - 会话 ID
     * @param messageId - 消息 ID
     * @param newMessage - 新消息数据
     */
    const updateMessage = (sessionId: string, messageId: string, newMessage: any): void => {
        const session = getSessionState(sessionId)
        const index = session.messages.findIndex((m: any) => m.id === messageId)
        if (index !== -1) {
            const message = session.messages[index]
            session.messages[index] = { ...message, ...newMessage }
            session.lastUpdated = Date.now()
        }
    }

    /**
     * 检查会话是否正在流式响应
     * @param sessionId - 会话 ID
     */
    const sessionIsStreaming = (sessionId: string): boolean => {
        return getSessionState(sessionId).isStreaming
    }

    /**
     * 设置会话流式状态
     * @param sessionId - 会话 ID
     * @param isStreaming - 是否正在流式响应
     */
    const setSessionIsStreaming = (sessionId: string, isStreaming: boolean): void => {
        getSessionState(sessionId).isStreaming = isStreaming
    }

    /**
     * 检查会话是否正在压缩历史
     * @param sessionId - 会话 ID
     */
    const sessionIsCompressing = (sessionId: string): boolean => {
        return getSessionState(sessionId).isCompressing
    }

    /**
     * 设置会话压缩状态
     * @param sessionId - 会话 ID
     * @param isCompressing - 是否正在压缩
     */
    const setSessionIsCompressing = (sessionId: string, isCompressing: boolean): void => {
        getSessionState(sessionId).isCompressing = isCompressing
    }

    /**
     * 获取输入消息
     * @param sessionId - 会话 ID
     */
    const getInputMessage = (sessionId: string) => {
        return getSessionState(sessionId).inputMessage
    }

    /**
     * 设置输入消息
     * @param sessionId - 会话 ID
     * @param content - 输入内容
     */
    const setInputMessage = (sessionId: string, content: any): void => {
        getSessionState(sessionId).inputMessage = content
    }

    /**
     * 获取会话设置
     * @param sessionId - 会话 ID
     * @param key - 设置键
     */
    const getSessionSetting = (sessionId: string, key: string): any => {
        return getSessionState(sessionId).settings[key]
    }

    /**
     * 设置会话设置
     * @param sessionId - 会话 ID
     * @param key - 设置键
     * @param value - 设置值
     */
    const setSessionSetting = (sessionId: string, key: string, value: any): void => {
        getSessionState(sessionId).settings[key] = value
    }

    /**
     * 更新会话标题
     * @param sessionId - 会话 ID
     * @param title - 新标题
     */
    const updateSessionTitle = (sessionId: string, title: string): void => {
        // 更新运行时状态
        const state = getSessionState(sessionId)
        state.title = title
        state.lastUpdated = Date.now()
        // 同步更新 sessionsMap
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            session.title = title
        }
    }

    /**
     * 更新会话最后活跃时间
     * @param sessionId - 会话 ID
     * @param timestamp - 时间戳
     */
    const updateSessionLastActiveTime = (sessionId: string, timestamp?: string): void => {
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            session.lastActiveAt = timestamp || new Date().toISOString()
        }
    }

    // === 侧边栏状态管理 ===

    /**
     * 获取或初始化侧边栏状态
     * @param sessionId - 会话 ID
     */
    const getSidebarState = (sessionId: string): { unread: boolean; working: boolean } => {
        if (!sessionSidebarStates.value.has(sessionId)) {
            sessionSidebarStates.value.set(sessionId, { unread: false, working: false })
        }
        return sessionSidebarStates.value.get(sessionId)!
    }

    /**
     * 标记会话为未读
     * @param sessionId - 会话 ID
     */
    const markSessionUnread = (sessionId: string): void => {
        getSidebarState(sessionId).unread = true
    }

    /**
     * 标记会话为已读
     * @param sessionId - 会话 ID
     */
    const markSessionRead = (sessionId: string): void => {
        getSidebarState(sessionId).unread = false
    }

    /**
     * 标记会话为工作中（流式响应中）
     * @param sessionId - 会话 ID
     */
    const markSessionWorking = (sessionId: string): void => {
        getSidebarState(sessionId).working = true
    }

    /**
     * 标记会话为空闲（流式响应结束）
     * @param sessionId - 会话 ID
     */
    const markSessionIdle = (sessionId: string): void => {
        getSidebarState(sessionId).working = false
    }

    /**
     * 检查会话是否未读
     * @param sessionId - 会话 ID
     */
    const isSessionUnread = (sessionId: string): boolean => {
        return getSidebarState(sessionId).unread
    }

    /**
     * 检查会话是否工作中
     * @param sessionId - 会话 ID
     */
    const isSessionWorking = (sessionId: string): boolean => {
        return getSidebarState(sessionId).working
    }

    /**
     * 同步后端流式状态到侧边栏状态
     * 用于页面加载时初始化 working 状态
     * @param sessionId - 会话 ID
     * @param isStreaming - 后端返回的流式状态
     */
    const syncStreamingState = (sessionId: string, isStreaming: boolean): void => {
        getSidebarState(sessionId).working = isStreaming
    }

    /**
     * 清理侧边栏状态（删除会话时调用）
     * @param sessionId - 会话 ID
     */
    const clearSidebarState = (sessionId: string): void => {
        sessionSidebarStates.value.delete(sessionId)
    }

    // =====================

    /**
     * 清理会话状态（删除会话时调用）
     * @param sessionId - 会话 ID
     */
    const clearSessionState = (sessionId: string): void => {
        sessions.value.delete(sessionId)
        sessionsMap.value.delete(sessionId)
        clearSidebarState(sessionId)
    }

    return {
        // 状态
        activeSessionId,
        sessionsMap,
        sessionsList,
        sessions,
        sessionSidebarStates,
        loadedCounts,
        hasMoreMap,

        // actions
        getSessionState,
        setChatSidebar,
        setSession,
        getSession,
        removeSession,
        getSessionsByGroup,
        getGroupTotal,
        moveSession,
        setSessionGroupId,
        setLoadedCount,
        getLoadedCount,
        setHasMore,
        groupHasMore,
        getMessages,
        addMessage,
        setMessages,
        prependMessages,
        getEarliestMessageId,
        getLatestMessageId,
        deleteMessage,
        updateMessage,
        sessionIsStreaming,
        setSessionIsStreaming,
        sessionIsCompressing,
        setSessionIsCompressing,
        getInputMessage,
        setInputMessage,
        getSessionSetting,
        setSessionSetting,
        updateSessionTitle,
        updateSessionLastActiveTime,
        clearSessionState,
        getSidebarState,
        markSessionUnread,
        markSessionRead,
        markSessionWorking,
        markSessionIdle,
        isSessionUnread,
        isSessionWorking,
        syncStreamingState,
        clearSidebarState
    }
})
