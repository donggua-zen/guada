// stores/session.ts
import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'
import type { Session, SessionState, SessionSettings } from '@/types/session'

/**
 * 会话状态 Store
 */
export const useSessionStore = defineStore('session', () => {
    // 状态
    const activeSessionId: Ref<string | null> = ref(null)
    const sessionsList: Ref<Session[]> = ref([])
    const sessions: Ref<Map<string, SessionState>> = ref(new Map())

    /**
     * 获取或初始化会话状态
     * @param sessionId - 会话 ID
     */
    const getSessionState = (sessionId: string): SessionState => {
        if (!sessions.value.has(sessionId)) {
            sessions.value.set(sessionId, {
                messages: [],
                isStreaming: false,
                inputMessage: {
                    content: '',
                    files: [],
                    isWaiting: false,
                },
                scrollPosition: 0,
                lastUpdated: Date.now(),
                settings: {
                    isDeepThinking: false
                }
            })
        }
        return sessions.value.get(sessionId)!
    }

    /**
     * 设置会话列表（带排序）
     * @param list - 会话列表
     */
    const setChatSidebar = (list: Session[]): void => {
        // 按 lastActiveAt 或 updatedAt 降序排序
        sessionsList.value = list.sort((a, b) => {
            const timeA = new Date(a.lastActiveAt || a.updatedAt || 0).getTime()
            const timeB = new Date(b.lastActiveAt || b.updatedAt || 0).getTime()
            return timeB - timeA  // 降序排列，最新的在前
        })
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
     * 设置滚动位置
     * @param sessionId - 会话 ID
     * @param position - 滚动位置
     */
    const setScrollPosition = (sessionId: string, position: number): void => {
        getSessionState(sessionId).scrollPosition = position
    }

    /**
     * 获取滚动位置
     * @param sessionId - 会话 ID
     */
    const getScrollPosition = (sessionId: string): number => {
        return getSessionState(sessionId).scrollPosition
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
        const session = getSessionState(sessionId)
        session.title = title
        session.lastUpdated = Date.now()
    }

    /**
     * 更新会话最后活跃时间
     * @param sessionId - 会话 ID
     * @param timestamp - 时间戳
     */
    const updateSessionLastActiveTime = (sessionId: string, timestamp?: string): void => {
        const session = sessionsList.value.find(s => s.id === sessionId)
        if (session) {
            session.lastActiveAt = timestamp || new Date().toISOString()
            // 重新触发排序
            setChatSidebar(sessionsList.value)
        }
    }

    /**
     * 清理会话状态（删除会话时调用）
     * @param sessionId - 会话 ID
     */
    const clearSessionState = (sessionId: string): void => {
        sessions.value.delete(sessionId)
    }

    return {
        // 状态
        activeSessionId,
        sessionsList,
        sessions,

        // actions
        getSessionState,
        setChatSidebar,
        getMessages,
        addMessage,
        setMessages,
        deleteMessage,
        updateMessage,
        sessionIsStreaming,
        setSessionIsStreaming,
        getInputMessage,
        setInputMessage,
        setScrollPosition,
        getScrollPosition,
        getSessionSetting,
        setSessionSetting,
        updateSessionTitle,
        updateSessionLastActiveTime,
        clearSessionState
    }
})
