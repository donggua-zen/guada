// stores/session.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
    const activeSessionId = ref(null)
    const sessionsList = ref([])
    const sessions = ref(new Map())

    // 获取或初始化会话状态
    const getSessionState = (sessionId) => {
        if (!sessions.value.has(sessionId)) {
            sessions.value.set(sessionId, {
                messages: [],
                isStreaming: false,
                inputMessage: {
                    content: '',
                    files: [],
                    // 是否待发送消息
                    isWaiting: false
                }, // 保存当前输入框内容
                scrollPosition: 0, // 滚动位置
                lastUpdated: Date.now(), // 最后更新时间
                settings: { // 会话特定设置
                    isDeepThinking: false,
                    // 其他设置...
                }
            })
        }
        return sessions.value.get(sessionId)
    }

    // 会话列表相关方法
    const setChatSidebar = (list) => {
        // 按 last_active_at 或 updated_at 降序排序
        sessionsList.value = list.sort((a, b) => {
            const timeA = new Date(a.last_active_at || a.updated_at || 0)
            const timeB = new Date(b.last_active_at || b.updated_at || 0)
            return timeB - timeA  // 降序排列，最新的在前
        })
    }

    // 消息相关方法
    const getMessages = (sessionId) => {
        return getSessionState(sessionId).messages
    }

    const addMessage = (sessionId, message) => {
        const session = getSessionState(sessionId)
        session.messages.push(message)
        session.lastUpdated = Date.now()
    }

    const setMessages = (sessionId, newMessages) => {
        const session = getSessionState(sessionId)
        session.messages.splice(0, session.messages.length, ...newMessages)
        session.lastUpdated = Date.now()
    }

    const deleteMessage = (sessionId, messageId) => {
        const session = getSessionState(sessionId)
        const index = session.messages.findIndex(m => m.id === messageId)
        if (index !== -1) {
            session.messages.splice(index, 1)
            session.lastUpdated = Date.now()
        }
    }

    const updateMessage = (sessionId, messageId, newMessage) => {
        const session = getSessionState(sessionId)
        const index = session.messages.findIndex(m => m.id === messageId)
        if (index !== -1) {
            const message = session.messages[index]
            session.messages[index] = { ...message, ...newMessage }
            session.lastUpdated = Date.now()
        }
    }

    // 流状态管理
    const sessionIsStreaming = (sessionId) => {
        return getSessionState(sessionId).isStreaming
    }

    const setSessionIsStreaming = (sessionId, isStreaming) => {
        getSessionState(sessionId).isStreaming = isStreaming
    }

    // 输入框内容管理
    const getInputMessage = (sessionId) => {
        return getSessionState(sessionId).inputMessage
    }

    const setInputMessage = (sessionId, content) => {
        getSessionState(sessionId).inputMessage = content
    }

    // 滚动位置管理
    const setScrollPosition = (sessionId, position) => {
        getSessionState(sessionId).scrollPosition = position
    }

    const getScrollPosition = (sessionId) => {
        return getSessionState(sessionId).scrollPosition
    }

    // 设置管理
    const getSessionSetting = (sessionId, key) => {
        return getSessionState(sessionId).settings[key]
    }

    const setSessionSetting = (sessionId, key, value) => {
        getSessionState(sessionId).settings[key] = value
    }

    // 更新会话标题
    const updateSessionTitle = (sessionId, title) => {
        const session = getSessionState(sessionId)
        session.title = title
        session.lastUpdated = Date.now()
    }

    // 更新会话最后活跃时间
    const updateSessionLastActiveTime = (sessionId, timestamp) => {
        const session = sessionsList.value.find(s => s.id === sessionId)
        if (session) {
            session.last_active_at = timestamp || new Date().toISOString()
            // 重新触发排序
            setChatSidebar(sessionsList.value)
        }
    }

    // 清理会话状态（删除会话时调用）
    const clearSessionState = (sessionId) => {
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