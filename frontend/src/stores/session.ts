// stores/session.ts
import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'
import type { Session, SessionState, QueuedMessage, StreamStatus, InputMessageState, SessionSettings, SessionPlanItem, PendingAsk, ProjectGroup, QueuePauseReason, UserQueueSnapshot, UserQueueSnapshotItem } from '@/types/session'
import type { Turn } from '@/types/message'
import { resolveProjectBucketId } from '@/utils/projectGroupBucket'

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
     * 每个分组已加载的会话数量 Map<groupId, count>
     */
    const loadedCounts: Ref<Map<string, number>> = ref(new Map())

    /**
     * 每个分组是否还有更多会话 Map<groupId, boolean>
     */
    const hasMoreMap: Ref<Map<string, boolean>> = ref(new Map())

    const sessions: Ref<Map<string, SessionState>> = ref(new Map())

    /**
     * 各会话排队消息数（服务端权威计数投影）。
     * 侧边栏需要为未打开的会话显示角标，不能依赖 SessionState 是否已缓存。
     */
    const sessionQueueCounts: Ref<Map<string, number>> = ref(new Map())

    /** 非响应式 LRU 访问时间戳(按会话记录最近访问,淘汰时用;不触发 Vue 响应式) */
    const sessionLastAccess = new Map<string, number>()

    // 会话侧边栏状态（未读 / 工作中）
    const sessionSidebarStates: Ref<Map<string, { unread: boolean; working: boolean }>> = ref(new Map())

    /** 会话状态过期时长:超过该时长无访问/事件续期的缓存可被淘汰(活跃会话永不淘汰) */
    const SESSION_STATE_TTL_MS = 2 * 60 * 60 * 1000
    /** 硬上限兜底:过期清扫后仍超限时按最近访问淘汰非活跃会话(仅防内存膨胀,正常使用不可达) */
    const MAX_CACHED_SESSIONS = 32

    /** 每会话消息轮次上限:单会话 turns 超过自动移除最旧 */
    const MAX_TURNS_PER_SESSION = 200

    /**
     * 淘汰过期/超限的会话内容缓存（写路径调用：新建缓存后；导出供测试）。
     *
     * 淘汰策略（活跃优先）：
     * ① TTL：超过 SESSION_STATE_TTL_MS 无任何访问/事件续期 → 淘汰
     *    （projector 每个流事件都经 getSessionState 续期，即"有新事件 → 重置最后活跃时间"，
     *    活跃会话永不过期）；
     * ② running 保护：streamStatus === 'running' 的会话一律不淘汰（双保险）；
     * ③ 硬上限兜底：清扫后仍超过 MAX_CACHED_SESSIONS → 按最近访问淘汰非 running 最旧者。
     */
    /** 队列视图：Record（按 requestId，插入顺序=到达顺序）→ 数组 */
    const pendingAskQueueOf = (state: SessionState | undefined): PendingAsk[] => {
        if (!state?.pendingAsks) return []
        return Object.values(state.pendingAsks)
    }
    const hasPendingAsks = (state: SessionState): boolean =>
        !!state.pendingAsks && Object.keys(state.pendingAsks).length > 0
    /** 持有排队消息的会话不淘汰：队列只在内存里，淘汰即用户输入永久丢失 */
    const hasQueuedMessages = (state: SessionState): boolean =>
        state.messageQueue.length > 0

    const evictSessionStates = (exceptId?: string, now: number = Date.now()): void => {
        for (const [sid, state] of sessions.value) {
            if (sid === exceptId) continue
            if (state.streamStatus === 'running') continue
            // 待批（审批/询问等待中）的会话同样不淘汰：卡片状态丢了无法从补发重建
            if (hasPendingAsks(state)) continue
            // 排队消息尚未补发完：淘汰会静默丢掉用户输入（且无任何持久化可恢复）
            if (hasQueuedMessages(state)) continue
            if (now - (sessionLastAccess.get(sid) ?? 0) > SESSION_STATE_TTL_MS) {
                sessions.value.delete(sid)
                sessionLastAccess.delete(sid)
            }
        }
        while (sessions.value.size > MAX_CACHED_SESSIONS) {
            let oldest: string | null = null
            let oldestTime = Infinity
            for (const [sid] of sessions.value) {
                if (sid === exceptId) continue
                if (sessions.value.get(sid)!.streamStatus === 'running') continue
                if (hasPendingAsks(sessions.value.get(sid)!)) continue
                if (hasQueuedMessages(sessions.value.get(sid)!)) continue
                const t = sessionLastAccess.get(sid) ?? 0
                if (t < oldestTime) {
                    oldestTime = t
                    oldest = sid
                }
            }
            if (oldest === null) break
            sessions.value.delete(oldest)
            sessionLastAccess.delete(oldest)
        }
    }

    /**
     * 获取或初始化会话状态（活跃 TTL 缓存）
     *
     * 续期：每次调用（命中或新建）刷新非响应式访问时间戳——projector 每个流事件都经此
     * 读状态，即"有新事件 → 重置最后活跃时间"；超过 SESSION_STATE_TTL_MS 无续期的缓存
     * 在下次新建缓存时被清扫（running 中的流绝不淘汰）。
     * 续期只更新非响应式访问时间戳，读路径绝不 delete/set sessions.value（响应式 Map）——
     * 否则渲染路径每次 getSessionState 都会改响应式状态 → 无限递归(Maximum recursive updates)。
     * @param sessionId - 会话 ID
     */
    const getSessionState = (sessionId: string): SessionState => {
        if (!sessions.value.has(sessionId)) {
            sessions.value.set(sessionId, {
                turns: [],
                isStreaming: false,
                isCompressing: false,
                streamStatus: 'idle',
                inputMessage: {
                    content: '',
                    files: [],
                    isWaiting: false,
                },
                lastUpdated: Date.now(),
                settings: {
                },
                messageQueue: [],
                queuePaused: null,
                queuePromotionId: null,
                queueRevision: 0,
            })
            sessionLastAccess.set(sessionId, Date.now())
            // 新建缓存后清扫过期/超限（写路径；读路径 peekStreamStatus 零写入）
            evictSessionStates(sessionId)
        } else {
            // LRU 续期:只更新非响应式访问时间戳,不修改响应式 Map(避免渲染递归)
            sessionLastAccess.set(sessionId, Date.now())
        }
        return sessions.value.get(sessionId)!
    }

    /**
     * 纯读流状态（不创建缓存、不续期、绝不写响应式 Map）——渲染路径 / watcher source 专用。
     *
     * getSessionState 的 miss 分支会创建缓存并触发清扫（写响应式 Map）：在 watcher
     * source / 渲染里调用会造成"读路径自我触发"→ Maximum recursive updates 白屏。
     * 状态只读场景一律用本方法（未缓存返回 undefined，语义等同 idle）。
     */
    const peekStreamStatus = (sessionId: string): StreamStatus | undefined => {
        return sessions.value.get(sessionId)?.streamStatus
    }

    /** 会话是否出现在侧边栏分组区（置顶项由「已置顶」分区单独聚合） */
    const isVisibleInGroup = (s: Session): boolean =>
        !s.archived && !s.pinned && s.sessionType !== 'bot' && s.sessionType !== 'sub_agent'

    /**
     * 会话新进入某分组的可见列表时，同步扩大该组的分页窗口。
     *
     * 窗口数量（loadedCounts）默认等于服务端分页返回的条数，只有「加载更多」和折叠重置
     * 会改它。新建/移入/取消归档/取消置顶的会话若刚好落在窗口之外，会被分页截断误藏，
     * 因此这些入口需要 +1。分组尚未建立窗口（count 为 0/undefined）时不处理——
     * 此时 getVisibleSessionsByGroup 不做截断。
     */
    const growVisibleCount = (session: Session): void => {
        if (!isVisibleInGroup(session)) return
        const key = session.groupId ?? UNGROUPED_ID
        const count = loadedCounts.value.get(key)
        if (count !== undefined && count > 0) {
            loadedCounts.value.set(key, count + 1)
        }
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
        const existing = sessionsMap.value.get(session.id)
        // 新进入可见状态（新插入 / 恢复归档 / 取消置顶）或跨分组移动时扩大目标组窗口
        const becameVisible = (!existing || !isVisibleInGroup(existing)) && isVisibleInGroup(session)
        const movedGroup = !!existing && (existing.groupId || null) !== (session.groupId || null)
        if (becameVisible || (movedGroup && isVisibleInGroup(session))) {
            growVisibleCount(session)
        }
        sessionsMap.value.set(session.id, session)
    }

    /**
     * 合并完整会话快照（GET/PUT /sessions/:id 响应回写）。
     *
     * 用 Object.assign 而非整对象替换：保留 store 上已有的前端注入字段
     * （典型如侧栏 working 用的 session.isStreaming），与 session_updated 的处理一致。
     */
    const mergeSession = (session: Session): void => {
        const existing = sessionsMap.value.get(session.id)
        if (existing) {
            Object.assign(existing, session)
        } else {
            setSession(session)
        }
    }

    /**
     * 按字段增量更新会话（输入区配置的本地发布入口）。
     *
     * 只写入显式出现的键：`null` 是合法值（如清空 modelId），不能被 `!== undefined`
     * 之外的默认值逻辑吞掉。settings 走 patchSessionSettings（浅合并）。
     */
    const patchSession = (
        sessionId: string,
        patch: Partial<Pick<Session, 'modelId' | 'agentId' | 'title' | 'groupId' | 'pinned' | 'workspacePath'>>,
    ): void => {
        const session = sessionsMap.value.get(sessionId)
        if (!session) return
        for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
            if (patch[key] !== undefined) {
                (session as unknown as Record<string, unknown>)[key] = patch[key]
            }
        }
    }

    /**
     * 浅合并会话 settings（输入区配置的本地发布入口）。
     *
     * 嵌套对象（attachments 等）整体替换：调用方传完整新对象，才能表达“删除某项”。
     */
    const patchSessionSettings = (
        sessionId: string,
        patch: Partial<SessionSettings>,
    ): void => {
        const session = sessionsMap.value.get(sessionId)
        if (!session) return
        session.settings = { ...(session.settings || {}), ...patch }
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
        // 会话已删除：内容缓存（含排队消息）一并清理，否则残留到 LRU/TTL 才消失
        sessions.value.delete(sessionId)
        sessionLastAccess.delete(sessionId)
        clearQueueCount(sessionId)
    }

    /**
     * 按分组获取会话列表（已按 lastActiveAt 降序排序）
     * 自动排除已归档会话（archived === true）与置顶会话（pinned === true）——
     * 置顶项由 getPinnedSessions 单独聚合到侧边栏顶部「已置顶」分区，两者互斥不重复。
     * @param groupId - 分组ID，null 表示未分组
     */
    const getSessionsByGroup = (groupId: string | null): Session[] => {
        const targetGroupId = groupId === UNGROUPED_ID ? null : groupId
        return Array.from(sessionsMap.value.values())
            .filter(s => (s.groupId || null) === targetGroupId && isVisibleInGroup(s))
            .sort((a, b) => {
                const timeA = new Date(a.lastActiveAt || a.updatedAt || 0).getTime()
                const timeB = new Date(b.lastActiveAt || b.updatedAt || 0).getTime()
                return timeB - timeA
            })
    }

    /**
     * 按分组获取可见会话（受每组已加载数量截断）。
     *
     * 侧边栏渲染使用本方法；getSessionsByGroup 仍返回完整列表，供需要全部会话的逻辑使用。
     * loadedCounts 由首屏加载写入、加载更多递增、分组折叠时重置回首屏数量——因此折叠再
     * 展开后，之前「加载更多」出来的会话不再显示，可再次点击加载更多重新拉取。
     * @param groupId - 分组ID，null 表示未分组
     */
    const getVisibleSessionsByGroup = (groupId: string | null): Session[] => {
        const list = getSessionsByGroup(groupId)
        const key = groupId ?? UNGROUPED_ID
        const limit = loadedCounts.value.get(key)
        // 无窗口（未分页 / 初始为空的分组）时不做截断
        return limit && limit > 0 ? list.slice(0, limit) : list
    }

    /**
     * 按目录桶获取会话（侧栏「目录」模式；已按 lastActiveAt 降序）。
     *
     * 桶 id = 目录分组 id 或 `__general__`。归属键由后端下发
     * （`session.workspaceKey` / `group.pathKey`），前端不做路径归一化。
     * 分组清单由调用方传入，避免本 store 依赖分组 store（保持可单测）。
     */
    const getSessionsByProjectGroup = (
        bucketId: string,
        groups: readonly ProjectGroup[],
    ): Session[] => {
        return Array.from(sessionsMap.value.values())
            .filter(s => isVisibleInGroup(s)
                && resolveProjectBucketId(s, groups) === bucketId)
            .sort((a, b) => {
                const timeA = new Date(a.lastActiveAt || a.updatedAt || 0).getTime()
                const timeB = new Date(b.lastActiveAt || b.updatedAt || 0).getTime()
                return timeB - timeA
            })
    }

    /** 按目录桶获取可见会话（受该桶已加载数量截断） */
    const getVisibleSessionsByProjectGroup = (
        bucketId: string,
        groups: readonly ProjectGroup[],
    ): Session[] => {
        const list = getSessionsByProjectGroup(bucketId, groups)
        const limit = loadedCounts.value.get(bucketId)
        return limit && limit > 0 ? list.slice(0, limit) : list
    }

    /**
     * 置顶会话列表（侧边栏顶部「已置顶」分区，跨分组聚合，按 lastActiveAt 降序）。
     *
     * 直接从 sessionsMap 派生（而非另设一份数据源）：远程清单拉取失败时，
     * 本地已置顶（乐观写入 pinned=true）的会话仍在，不会凭空"消失"。
     */
    const getPinnedSessions = (): Session[] => {
        return Array.from(sessionsMap.value.values())
            .filter(s => s.pinned && !s.archived && s.sessionType !== 'bot' && s.sessionType !== 'sub_agent')
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
            .filter(s => (s.groupId || null) === targetGroupId && !s.pinned && s.sessionType !== 'bot' && s.sessionType !== 'sub_agent').length
    }

    /**
     * 移动会话到指定分组
     * @param sessionId - 会话 ID
     * @param targetGroupId - 目标分组ID（null 或 UNGROUPED_ID 表示未分组）
     */
    const moveSession = (sessionId: string, targetGroupId: string | null): void => {
        const session = sessionsMap.value.get(sessionId)
        if (!session) return
        const target = targetGroupId === UNGROUPED_ID ? null : targetGroupId
        if ((session.groupId || null) === target) return
        session.groupId = target
        // 目标组可能已建立分页窗口：移入的会话不应被窗口截断误藏
        growVisibleCount(session)
    }

    /**
     * 更新会话分组ID
     * @param sessionId - 会话 ID
     * @param groupId - 新分组ID
     */
    const setSessionGroupId = (sessionId: string, groupId: string | null): void => {
        const session = sessionsMap.value.get(sessionId)
        if (!session) return
        const target = groupId === UNGROUPED_ID ? null : groupId
        if ((session.groupId || null) === target) return
        session.groupId = target
        growVisibleCount(session)
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
     * 重置分组分页窗口（折叠分组时调用）。
     *
     * 仅当已经「加载更多」过（count > initialCount）才收缩窗口，避免无谓改动；
     * 收缩后若本地仍有被截掉的会话，保持 hasMore 以便展开后能重新加载。
     * @param groupId - 分组ID（未分组传 UNGROUPED_ID）
     * @param initialCount - 首屏每组加载数量
     */
    const resetGroupPagination = (groupId: string, initialCount: number): void => {
        const current = loadedCounts.value.get(groupId)
        if (current === undefined || current <= initialCount) return
        loadedCounts.value.set(groupId, initialCount)

        const targetGroupId = groupId === UNGROUPED_ID ? null : groupId
        if (getSessionsByGroup(targetGroupId).length > initialCount) {
            hasMoreMap.value.set(groupId, true)
        }
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
     * 此处不写——子 Agent 也通过此方法写状态(供概览/侧边栏标签派生),但不出现在侧边栏。
     * 注意:不同步 isStreaming——那是另一维度的"本窗口流式"标记,由 useSessionEvents
     * 按 stream_status_changed 的实际流状态经 setSessionIsStreaming 维护,两者各管各的。
     */
    const setStreamStatus = (sessionId: string, status: StreamStatus): void => {
        const state = getSessionState(sessionId)
        state.streamStatus = status
    }

    // === 消息队列（M3：服务端快照投影） ===
    //
    // 队列所有权在后端：本文件只保存快照，所有增删改/排序/暂停都走 REST，
    // 并通过 applyQueueSnapshot 整块替换。revision + epoch 用于丢弃乱序/跨进程旧快照。

    /** 把服务端快照项映射为 UI 视图 */
    function toQueuedMessage(item: UserQueueSnapshotItem): QueuedMessage {
        return {
            id: item.id,
            content: item.content,
            files: item.files ?? [],
            ...(item.knowledgeBaseIds?.length
                ? { knowledgeBaseIds: item.knowledgeBaseIds }
                : {}),
            createdAt: Date.parse(item.createdAt) || Date.now(),
            status: item.status,
            ...(item.error ? { error: item.error } : {}),
            ...(item.replaceTurnId ? { replaceTurnId: item.replaceTurnId } : {}),
            ...(item.settingsOverride
                ? {
                      settingsSnapshot: {
                          modelId: item.settingsOverride.modelId,
                          thinkingEffort: item.settingsOverride.thinkingEffort,
                          maxTokensLimit: item.settingsOverride.maxTokensLimit,
                          mode: item.settingsOverride.sandboxMode,
                          planEnabled: item.settingsOverride.planEnabled,
                      },
                  }
                : {}),
        }
    }

    /** 应用服务端全量快照；旧 revision 直接丢弃（返回 false） */
    const applyQueueSnapshot = (sessionId: string, snapshot: UserQueueSnapshot): boolean => {
        const state = getSessionState(sessionId)
        const sameEpoch = state.queueEpoch === snapshot.epoch
        if (sameEpoch && snapshot.revision < (state.queueRevision ?? 0)) {
            return false
        }
        state.queueEpoch = snapshot.epoch
        state.queueRevision = snapshot.revision
        state.messageQueue = snapshot.items.map(toQueuedMessage)
        state.queuePaused = snapshot.paused?.reason ?? null
        state.queuePromotionId = snapshot.promotionId
        setQueueCount(sessionId, state.messageQueue.length)
        return true
    }

    /** 当前会话队列（渲染路径纯读：不创建缓存） */
    const getMessageQueue = (sessionId: string): QueuedMessage[] => {
        return sessions.value.get(sessionId)?.messageQueue ?? []
    }

    /** 纯读队列长度（渲染路径专用：不创建缓存、不续期） */
    const peekQueueLength = (sessionId: string): number => {
        return sessions.value.get(sessionId)?.messageQueue.length ?? 0
    }

    /** 纯读暂停原因（不创建缓存、不续期） */
    const queuePauseReason = (sessionId: string): QueuePauseReason | null => {
        return sessions.value.get(sessionId)?.queuePaused ?? null
    }

    /** 纯读"即将发送"项 id（UI 标记用） */
    const queuePromotionId = (sessionId: string): string | null => {
        return sessions.value.get(sessionId)?.queuePromotionId ?? null
    }

    /** 单会话计数（侧边栏角标；服务端 queues_snapshot / queue_updated 维护） */
    const setQueueCount = (sessionId: string, count: number): void => {
        const next = new Map(sessionQueueCounts.value)
        if (count > 0) next.set(sessionId, count)
        else next.delete(sessionId)
        sessionQueueCounts.value = next
    }

    /** 连接补发的全量计数快照：整体替换（未列出的会话即无排队） */
    const setQueueCounts = (counts: Record<string, number>): void => {
        const next = new Map<string, number>()
        for (const [sid, count] of Object.entries(counts ?? {})) {
            if (count > 0) next.set(sid, count)
        }
        sessionQueueCounts.value = next
    }

    const peekQueueCount = (sessionId: string): number => {
        return sessionQueueCounts.value.get(sessionId) ?? 0
    }

    const clearQueueCount = (sessionId: string): void => {
        if (!sessionQueueCounts.value.has(sessionId)) return
        const next = new Map(sessionQueueCounts.value)
        next.delete(sessionId)
        sessionQueueCounts.value = next
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

    // ─── 会话级统一交互卡队列（审批/询问共用，对齐 DSH：sessionId 唯一锚点，不挂回合）───
    //
    // 一个助手消息里的多个工具调用是并发执行的，每个都可能触发审批 → 队列（按 requestId 入队）。
    // 单槽会让后一个覆盖前一个，被覆盖的等待者永远没人应答（后端无超时）→ 回合永久挂起。

    /** 队首（最早到达）——卡片一次只显示一张 */
    const sessionPendingAsk = (sessionId: string): PendingAsk | undefined => {
        return pendingAskQueueOf(getSessionState(sessionId))[0]
    }

    /** 完整队列（到达顺序；当前会话组件用，创建型访问器） */
    const sessionPendingAskQueue = (sessionId: string): PendingAsk[] => {
        return pendingAskQueueOf(getSessionState(sessionId))
    }

    /** 入队 / 覆盖同 requestId 的既有项（幂等：流帧可能重放/双写） */
    const upsertSessionPendingAsk = (sessionId: string, ask: PendingAsk): void => {
        const state = getSessionState(sessionId)
        if (!state.pendingAsks) state.pendingAsks = {}
        state.pendingAsks[ask.requestId] = ask
    }

    /** 出队（ask_resolved 只摘对应那一个，不影响其它待答） */
    const removeSessionPendingAsk = (sessionId: string, requestId: string): void => {
        const state = sessions.value.get(sessionId)
        if (!state?.pendingAsks) return
        delete state.pendingAsks[requestId]
        if (Object.keys(state.pendingAsks).length === 0) state.pendingAsks = undefined
    }

    /**
     * 纯读队列（不创建缓存、绝不写响应式 Map）——渲染路径专用。
     *
     * getSessionState 的 miss 分支会创建缓存并触发清扫（写响应式 Map）：侧边栏等渲染路径
     * 按会话逐项调用会造成"读路径自我触发"→ Maximum recursive updates 白屏
     * （与 peekStreamStatus 同一约束，见其注释）。未缓存返回空数组（语义等同无待批）。
     */
    const peekSessionPendingAskQueue = (sessionId: string): PendingAsk[] => {
        return pendingAskQueueOf(sessions.value.get(sessionId))
    }

    /** 纯读队首（侧边栏胶囊用：只关心"有没有 / 是哪一类"） */
    const peekSessionPendingAsk = (sessionId: string): PendingAsk | undefined => {
        return peekSessionPendingAskQueue(sessionId)[0]
    }

    /** 清空某个会话的待批队列（流终止 / 回合结束） */
    const clearSessionPendingAsks = (sessionId: string): void => {
        const state = sessions.value.get(sessionId)
        if (state?.pendingAsks) state.pendingAsks = undefined
    }

    /**
     * 清空所有会话的待批状态（SSE 重连兜底：断线期间可能在别处应答、或后端重启导致
     * 内存等待表清空。仍待批的 ask 会由 /chat/pending-asks 补拉或活跃流补发重建）。
     */
    const clearAllPendingAsks = (): void => {
        for (const state of sessions.value.values()) {
            if (state.pendingAsks) state.pendingAsks = undefined
        }
    }

    // ─── 计划模式（协作状态；UI 投影，事实源是会话设置）───

    /** 读取会话的计划模式开关 */
    const sessionPlanEnabled = (sessionId: string): boolean => {
        return getSessionState(sessionId).planEnabled === true
    }

    /** 写入会话的计划模式开关（用户开关乐观写入） */
    const setSessionPlanEnabled = (sessionId: string, enabled: boolean): void => {
        getSessionState(sessionId).planEnabled = enabled
    }

    /**
     * 模型发起的计划模式变更（plan_mode_changed 流帧）：同时更新 UI 投影与会话设置。
     *
     * 设置是事实源且后端已落库——这里必须一并更新，否则刷新后指示器会按旧设置回退。
     */
    const applyRemotePlanEnabled = (sessionId: string, enabled: boolean): void => {
        getSessionState(sessionId).planEnabled = enabled
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            if (!session.settings) session.settings = {} as SessionSettings
            session.settings.planEnabled = enabled
        }
    }

    // ─── 计划历史缓存（计划模式产物：转录构建的列表，含状态）───

    /** 读取缓存的计划列表（未刷新过为 undefined） */
    const sessionPlans = (sessionId: string): SessionPlanItem[] | undefined => {
        return getSessionState(sessionId).plans
    }

    /** 写入计划列表缓存（拉取统一走 utils/sessionPlan.refreshSessionPlans，store 保持纯状态） */
    const setSessionPlans = (sessionId: string, plans: SessionPlanItem[] | undefined): void => {
        getSessionState(sessionId).plans = plans
    }

    /**
     * 计划列表缓存刷新（fire-and-forget，供 streamProjector 的 turn_end / plan_mode_changed 钩子调用）。
     * 动态 import 拉取实现：store 不静态依赖服务层（后者反向依赖本 store）。
     */
    const refreshPlans = (sessionId: string): void => {
        void import('@/utils/sessionPlan')
            .then((m) => m.refreshSessionPlans(sessionId))
            .catch(() => { /* 缓存刷新失败静默：面板/入口按未刷新处理 */ })
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
    const setInputMessage = (sessionId: string, content: InputMessageState): void => {
        getSessionState(sessionId).inputMessage = content
    }

    /**
     * 更新会话标题
     * @param sessionId - 会话 ID
     * @param title - 新标题
     */
    const updateSessionTitle = (sessionId: string, title: string): void => {
        // 同步更新 sessionsMap（会话列表/侧边栏标题的唯一数据源；
        // SessionState 不再存 title 副本——旧 state.title 从无读取方）
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            session.title = title
        }
    }

    /**
     * 设置会话置顶状态（本地乐观更新；最终一致性由后端 SSE 广播保证）
     * @param sessionId - 会话 ID
     * @param pinned - 是否置顶
     */
    const setSessionPinned = (sessionId: string, pinned: boolean): void => {
        const session = sessionsMap.value.get(sessionId)
        if (session) {
            session.pinned = pinned
            // 取消置顶后会话重新进入分组视图，可能落在窗口之外
            if (!pinned) growVisibleCount(session)
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
     * 同步后端流式状态到侧边栏状态 + 会话级 isStreaming
     * 用于页面加载时初始化：侧边栏"工作中"圆点与发送按钮统一走这条不受 SSE 时序影响的快照恢复线
     * （后端 session.isStreaming 由 hasActiveStream 逐会话现算，刷新时经 fetchSessions 注入）。
     * @param sessionId - 会话 ID
     * @param isStreaming - 后端返回的流式状态
     */
    const syncStreamingState = (sessionId: string, isStreaming: boolean): void => {
        getSidebarState(sessionId).working = isStreaming
        getSessionState(sessionId).isStreaming = isStreaming
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
     * 清空会话消息（清空聊天记录时调用）
     * 只清理消息和输入状态，保留会话本身
     * @param sessionId - 会话 ID
     */
    const clearSessionMessages = (sessionId: string): void => {
        const state = sessions.value.get(sessionId)
        if (state) {
            // 渲染源是回合树，且 loadMessages 靠 loaded 门禁跳过重拉——
            // 旧模型清扁平 messages 的写法在回合制后既无效又漏清树，导致清空后旧回合滞留
            state.turns.splice(0, state.turns.length)
            state.eventLog = []
            state.loaded = false
            state.isStreaming = false
            state.isCompressing = false
            state.streamKind = 'chat'
            state.pendingAsks = undefined
            state.inputMessage = {
                content: '',
                files: [],
                isWaiting: false,
            }
            state.lastUpdated = Date.now()
            // 队列由后端持有：清空聊天记录不删除排队消息，
            // 保留本地投影，等下一次 queue_updated / refreshQueue 对齐。
        }
        clearSidebarState(sessionId)
    }

    return {
        // 状态
        activeSessionId,
        sessionsMap,

        // actions
        getSessionState,
        evictSessionStates,
        getTurns,
        setTurns,
        prependTurns,
        pushTurn,
        deleteTurnById,
        getEarliestTurnId,
        sessionIsStreaming,
        setSessionIsStreaming,
        setSessionStreamKind,
        sessionStreamKind,
        setStreamStatus,
        peekStreamStatus,
        sessionIsCompressing,
        setSessionIsCompressing,
        sessionPendingAsk,
        sessionPendingAskQueue,
        upsertSessionPendingAsk,
        removeSessionPendingAsk,
        peekSessionPendingAsk,
        peekSessionPendingAskQueue,
        clearSessionPendingAsks,
        clearAllPendingAsks,
        sessionPlanEnabled,
        setSessionPlanEnabled,
        applyRemotePlanEnabled,
        sessionPlans,
        setSessionPlans,
        refreshPlans,
        applyQueueSnapshot,
        getMessageQueue,
        peekQueueLength,
        queuePauseReason,
        queuePromotionId,
        setQueueCount,
        setQueueCounts,
        peekQueueCount,
        clearQueueCount,
        getInputMessage,
        setInputMessage,
        updateSessionTitle,
        updateSessionLastActiveTime,
        clearSessionMessages,
        setChatSidebar,
        setSession,
        mergeSession,
        getSession,
        patchSession,
        patchSessionSettings,
        removeSession,
        getSessionsByGroup,
        getVisibleSessionsByGroup,
        getSessionsByProjectGroup,
        getVisibleSessionsByProjectGroup,
        getGroupTotal,
        getPinnedSessions,
        moveSession,
        setSessionGroupId,
        setSessionPinned,
        setLoadedCount,
        getLoadedCount,
        resetGroupPagination,
        setHasMore,
        groupHasMore,
        getSidebarState,
        setSidebarFlag,
        getSidebarFlag,
        syncStreamingState,
        clearSidebarState
    }
})
