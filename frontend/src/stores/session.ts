// stores/session.ts
import { defineStore } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import type { Session, SessionState, SessionSettings, QueuedMessage, StreamStatus } from '@/types/session'
import type { Turn } from '@/types/message'

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

    /** 非响应式 LRU 访问时间戳(按会话记录最近访问,淘汰时用;不触发 Vue 响应式) */
    const sessionLastAccess = new Map<string, number>()

    // 会话侧边栏状态（未读 / 工作中）
    const sessionSidebarStates: Ref<Map<string, { unread: boolean; working: boolean }>> = ref(new Map())

    /** 会话内容缓存上限(LRU):超过则淘汰最久未用的会话缓存 */
    const MAX_CACHED_SESSIONS = 8

    /** 每会话消息轮次上限:单会话 turns 超过自动移除最旧 */
    const MAX_TURNS_PER_SESSION = 200

    /**
     * 获取或初始化会话状态(LRU 缓存:命中续期,超限淘汰最久未用)
     * 续期只更新非响应式访问时间戳,绝不 delete/set sessions.value(响应式 Map)——
     * 否则渲染路径每次 getSessionState 都会改响应式状态 → 无限递归(Maximum recursive updates)。
     * @param sessionId - 会话 ID
     */
    const getSessionState = (sessionId: string): SessionState => {
        if (!sessions.value.has(sessionId)) {
            sessions.value.set(sessionId, {
                messages: [],
                turns: [],
                isStreaming: false,
                isCompressing: false,
                streamStatus: 'idle',
                inputMessage: {
                    content: '',
                    files: [],
                    isWaiting: false,
                },
                scrollPosition: 0,
                lastUpdated: Date.now(),
                settings: {
                },
                messageQueue: [],
            })
            sessionLastAccess.set(sessionId, Date.now())
            // LRU:超限淘汰最久未用(按非响应式访问时间,不淘汰刚插入的当前会话)
            while (sessions.value.size > MAX_CACHED_SESSIONS) {
                let oldest: string | null = null
                let oldestTime = Infinity
                for (const [sid, t] of sessionLastAccess) {
                    if (sessions.value.has(sid) && t < oldestTime) {
                        oldestTime = t
                        oldest = sid
                    }
                }
                if (oldest === null || oldest === sessionId) break
                sessions.value.delete(oldest)
                sessionLastAccess.delete(oldest)
            }
        } else {
            // LRU 续期:只更新非响应式访问时间戳,不修改响应式 Map(避免渲染递归)
            sessionLastAccess.set(sessionId, Date.now())
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
     * 自动排除已归档会话（archived === true）
     * @param groupId - 分组ID，null 表示未分组
     */
    const getSessionsByGroup = (groupId: string | null): Session[] => {
        const targetGroupId = groupId === UNGROUPED_ID ? null : groupId
        return Array.from(sessionsMap.value.values())
            .filter(s => (s.groupId || null) === targetGroupId && !s.archived && s.sessionType !== 'bot' && s.sessionType !== 'sub_agent')
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
            .filter(s => (s.groupId || null) === targetGroupId && s.sessionType !== 'bot' && s.sessionType !== 'sub_agent').length
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

    // ── Turn 直连（后端 getTurns → 前端渲染，不再打平为扁平消息） ──

    /**
     * 获取回合列表
     * @param sessionId - 会话 ID
     */
    const getTurns = (sessionId: string): Turn[] => {
        return getSessionState(sessionId).turns
    }

    /**
     * 设置回合列表（初始/整页加载）
     * @param sessionId - 会话 ID
     * @param newTurns - 回合列表
     */
    const setTurns = (sessionId: string, newTurns: Turn[]): void => {
        const session = getSessionState(sessionId)
        session.turns.splice(0, session.turns.length, ...newTurns)
        session.lastUpdated = Date.now()
    }

    /**
     * 在回合列表前部插入（用于加载历史更早回合）
     * @param sessionId - 会话 ID
     * @param newTurns - 要插入的回合列表
     */
    const prependTurns = (sessionId: string, newTurns: Turn[]): void => {
        const session = getSessionState(sessionId)
        session.turns.unshift(...newTurns)
        session.lastUpdated = Date.now()
    }

    /**
     * 追加回合(投影写:事件到达即改缓存时调用),超过轮次上限自动移除最旧。
     * @param sessionId - 会话 ID
     * @param turn - 要追加的回合外壳
     */
    const pushTurn = (sessionId: string, turn: Turn): void => {
        const session = getSessionState(sessionId)
        session.turns.push(turn)
        // 每会话消息轮次上限:超出移除最旧
        while (session.turns.length > MAX_TURNS_PER_SESSION) {
            session.turns.shift()
        }
        session.lastUpdated = Date.now()
    }

    /**
     * 按回合 id 删除回合（整轮遮蔽）
     * @param sessionId - 会话 ID
     * @param turnId - 回合 id
     */
    const deleteTurnById = (sessionId: string, turnId: string): void => {
        const session = getSessionState(sessionId)
        const index = session.turns.findIndex((t: Turn) => t.id === turnId)
        if (index !== -1) {
            session.turns.splice(index, 1)
            session.lastUpdated = Date.now()
        }
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
     * 获取最早的回合 ID（用于向上滚动分页的游标）。
     * ⚠️ 必须是回合 id：后端 getTurns 按 beforeTurnId 匹配回合外壳 id，
     * 传消息 id 会 findIndex 落空返回空页并静默终止分页。
     * @param sessionId - 会话 ID
     * @returns 最早回合的 ID，如果没有则返回 null
     */
    const getEarliestTurnId = (sessionId: string): string | null => {
        const turns = getSessionState(sessionId).turns
        return turns.length > 0 ? turns[0].id : null
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
     * 会话流类型（chat=对话回合；maintenance=维护任务如手动压缩伪流）
     * 由 stream_status_changed 事件写入；loadSession 据此决定是否跳过事件页拉取
     * （maintenance 流 buffer 无回合历史，跳过会导致消息列表空白）。
     */
    const setSessionStreamKind = (sessionId: string, kind: 'chat' | 'maintenance'): void => {
        getSessionState(sessionId).streamKind = kind
    }

    const sessionStreamKind = (sessionId: string): 'chat' | 'maintenance' => {
        return getSessionState(sessionId).streamKind ?? 'chat'
    }

    /**
     * 设置统一流状态(统一订阅器写入)
     *
     * 仅更新 streamStatus 字段。侧边栏 working 由 useSessionEvents 显式设置(仅主会话),
     * 此处不写——子 Agent 也通过此方法写状态(供 ChatPage watch 派生 tab),但不出现在侧边栏。
     * 注意:不同步 isStreaming——那是前端"本窗口已订阅/发起"标记,
     * 由 processStreamLoop / subscribeToActiveStream 维护;若在此置 true,
     * 会误挡 subscribeToActiveStream 的 isStreaming 守卫(其他窗口发起时本窗口无法订阅)。
     */
    const setStreamStatus = (sessionId: string, status: StreamStatus): void => {
        const state = getSessionState(sessionId)
        state.streamStatus = status
    }

    // === 消息队列操作 ===

    const enqueueMessage = (sessionId: string, msg: Omit<QueuedMessage, 'id' | 'createdAt' | 'status'>): string => {
        const state = getSessionState(sessionId)
        const item: QueuedMessage = {
            ...msg,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            status: 'queued',
        }
        state.messageQueue.push(item)
        return item.id
    }

    const dequeueMessage = (sessionId: string): QueuedMessage | null => {
        const state = getSessionState(sessionId)
        if (state.messageQueue.length === 0) return null
        const item = state.messageQueue.shift()!
        return item
    }

    const peekQueue = (sessionId: string): QueuedMessage | null => {
        const queue = getSessionState(sessionId).messageQueue
        return queue.length > 0 ? queue[0] : null
    }

    const getMessageQueue = (sessionId: string): QueuedMessage[] => {
        return getSessionState(sessionId).messageQueue
    }

    const removeQueuedMessage = (sessionId: string, msgId: string): void => {
        const state = getSessionState(sessionId)
        const idx = state.messageQueue.findIndex(m => m.id === msgId)
        if (idx !== -1) {
            state.messageQueue.splice(idx, 1)
        }
    }

    const updateQueuedMessage = (sessionId: string, msgId: string, updates: Partial<QueuedMessage>): void => {
        const state = getSessionState(sessionId)
        const idx = state.messageQueue.findIndex(m => m.id === msgId)
        if (idx !== -1) {
            state.messageQueue[idx] = { ...state.messageQueue[idx], ...updates }
        }
    }

    const getQueueLength = (sessionId: string): number => {
        return getSessionState(sessionId).messageQueue.length
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

    // ─── 会话级统一交互卡（审批/询问/迭代暂停共用，对齐 DSH：sessionId 唯一锚点，不挂回合）───

    /** 读取会话级统一交互卡状态 */
    const sessionPendingAsk = (sessionId: string) => {
        return getSessionState(sessionId).pendingAsk
    }

    /** 写入/清除会话级统一交互卡状态 */
    const setSessionPendingAsk = (sessionId: string, pendingAsk: SessionState['pendingAsk']): void => {
        getSessionState(sessionId).pendingAsk = pendingAsk
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

    type SidebarFlag = 'unread' | 'working'

    /**
     * 设置会话侧边栏标记
     * @param sessionId - 会话 ID
     * @param flag - 标记类型
     * @param value - 标记值
     */
    const setSidebarFlag = (sessionId: string, flag: SidebarFlag, value: boolean): void => {
        getSidebarState(sessionId)[flag] = value
    }

    /**
     * 获取会话侧边栏标记
     * @param sessionId - 会话 ID
     * @param flag - 标记类型
     * @returns 标记值
     */
    const getSidebarFlag = (sessionId: string, flag: SidebarFlag): boolean => {
        return getSidebarState(sessionId)[flag]
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

    /**
     * 清空会话消息（清空聊天记录时调用）
     * 只清理消息和输入状态，保留会话本身
     * @param sessionId - 会话 ID
     */
    const clearSessionMessages = (sessionId: string): void => {
        const state = sessions.value.get(sessionId)
        if (state) {
            state.messages = []
            state.isStreaming = false
            state.isCompressing = false
            state.streamKind = 'chat'
            state.pendingAsk = undefined
            state.inputMessage = {
                content: '',
                files: [],
                isWaiting: false,
            }
            state.scrollPosition = 0
            state.lastUpdated = Date.now()
            state.messageQueue = []
        }
        clearSidebarState(sessionId)
    }

    return {
        // 状态
        activeSessionId,
        sessionsMap,

        // actions
        getSessionState,
        getMessages,
        addMessage,
        setMessages,
        prependMessages,
        getTurns,
        setTurns,
        prependTurns,
        pushTurn,
        deleteTurnById,
        getEarliestTurnId,
        deleteMessage,
        updateMessage,
        sessionIsStreaming,
        setSessionIsStreaming,
        setSessionStreamKind,
        sessionStreamKind,
        setStreamStatus,
        sessionIsCompressing,
        setSessionIsCompressing,
        sessionPendingAsk,
        setSessionPendingAsk,
        enqueueMessage,
        dequeueMessage,
        peekQueue,
        getMessageQueue,
        removeQueuedMessage,
        updateQueuedMessage,
        getQueueLength,
        getInputMessage,
        setInputMessage,
        getSessionSetting,
        setSessionSetting,
        updateSessionTitle,
        updateSessionLastActiveTime,
        clearSessionMessages,
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
        getSidebarState,
        setSidebarFlag,
        getSidebarFlag,
        syncStreamingState,
        clearSidebarState
    }
})
