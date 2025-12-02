import { reactive } from 'vue'

export const store = reactive({
    activeSessionId: 0,
    sessionsList: [],
    sessions: new Map(), // 统一管理所有会话状态
    setActiveSessionId(sessionId) {
        this.activeSessionId = sessionId;
    },
    // 获取或初始化会话状态
    getSessionState(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                messages: [],
                isStreaming: false,
                inputMessage: {
                    content: '',
                    files: [],
                }, // 保存当前输入框内容
                scrollPosition: 0, // 滚动位置
                lastUpdated: Date.now(), // 最后更新时间
                settings: { // 会话特定设置
                    isDeepThinking: false,
                    // 其他设置...
                }
            });
        }
        return this.sessions.get(sessionId);
    },
    // 会话列表相关方法
    setSessionsList(sessionsList) {
        this.sessionsList = sessionsList;
    },
    getSessionsList() {
        return this.sessionsList;
    },
    // 消息相关方法
    getMessages(sessionId) {
        return this.getSessionState(sessionId).messages;
    },

    addMessage(sessionId, message) {
        const session = this.getSessionState(sessionId);
        session.messages.push(message);
        session.lastUpdated = Date.now();
    },

    setMessages(sessionId, newMessages) {
        const session = this.getSessionState(sessionId);
        session.messages.splice(0, session.messages.length, ...newMessages);
        session.lastUpdated = Date.now();
    },

    deleteMessage(sessionId, messageId) {
        const session = this.getSessionState(sessionId);
        const index = session.messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            session.messages.splice(index, 1);
            session.lastUpdated = Date.now();
        }
    },

    updateMessage(sessionId, messageId, newMessage) {
        const session = this.getSessionState(sessionId);
        const index = session.messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const message = session.messages[index];
            session.messages[index] = { ...message, ...newMessage };
            session.lastUpdated = Date.now();
        }
    },

    // 流状态管理
    sessionIsStreaming(sessionId) {
        return this.getSessionState(sessionId).isStreaming;
    },

    setSessionIsStreaming(sessionId, isStreaming) {
        this.getSessionState(sessionId).isStreaming = isStreaming;
    },

    // 输入框内容管理
    getInputMessage(sessionId) {
        return this.getSessionState(sessionId).inputMessage;
    },

    setInputMessage(sessionId, content) {
        this.getSessionState(sessionId).inputMessage = content;
    },

    // 滚动位置管理
    setScrollPosition(sessionId, position) {
        this.getSessionState(sessionId).scrollPosition = position;
    },

    getScrollPosition(sessionId) {
        return this.getSessionState(sessionId).scrollPosition;
    },

    // 设置管理
    getSessionSetting(sessionId, key) {
        return this.getSessionState(sessionId).settings[key];
    },

    setSessionSetting(sessionId, key, value) {
        this.getSessionState(sessionId).settings[key] = value;
    },

    // 清理会话状态（删除会话时调用）
    clearSessionState(sessionId) {
        this.sessions.delete(sessionId);
    },

    // 获取所有会话的最后更新时间（用于排序）
    getSessionLastUpdated(sessionId) {
        return this.getSessionState(sessionId).lastUpdated;
    }
});