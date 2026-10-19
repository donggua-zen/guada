import { ref, computed, type Ref } from 'vue'

export interface TokenBreakdown {
  systemPrompt: number
  history: number
  tools: number
}

export interface TokenStatsData {
  usedTokens: number
  totalTokens: number
  remainingTokens: number
  percentage: number
  modelName: string
  messageCount: number
  breakdown?: TokenBreakdown
}

/** 上下文统计事件负载（turn_end / compression_end / compaction_summary 与持久化锚点同构） */
export interface ContextStatsInput {
  usedTokens: number
  effectiveContextWindow: number
  messageCount?: number
  breakdown?: TokenBreakdown
}

/**
 * 每会话一份的 Token 统计（按 sessionId 键控）
 *
 * 事件流投影为所有会话（含后台子代理）喂入锚点：若用共享单例，后台会话的
 * turn_end 会覆盖前台会话的环形指示器（主会话与子代理同屏并存时必然互染），
 * 因此按会话隔离；读取方经 useSessionTokenStats(sessionId) 取本会话切片。
 */
const tokenStatsBySession = ref(new Map<string, TokenStatsData>())

/** 缓存上限：超限按插入序淘汰最旧（单条数据极小，上限仅防长期运行膨胀） */
const MAX_CACHED_SESSIONS = 32

/** breakdown 形状防御校验（旧锚点事件无此字段） */
function pickBreakdown(b: unknown): TokenBreakdown | undefined {
  const d = b as TokenBreakdown | undefined
  if (!d || typeof d !== 'object') return undefined
  if (
    typeof d.systemPrompt !== 'number' ||
    typeof d.history !== 'number' ||
    typeof d.tools !== 'number'
  ) {
    return undefined
  }
  return d
}

/** 会话内共享合并：填充环形指示器字段；messageCount/breakdown 事件携带时才覆盖（旧锚点缺省保留旧值） */
function applyContextStats(sessionId: string, stats: ContextStatsInput) {
  const prev = tokenStatsBySession.value.get(sessionId)
  // 百分比约束两位小数（浮点直除会产生 0.24789999999999998 之类的脏值）
  const percentage = parseFloat(
    Math.min((stats.usedTokens / stats.effectiveContextWindow) * 100, 100).toFixed(2),
  )
  tokenStatsBySession.value.set(sessionId, {
    usedTokens: stats.usedTokens,
    totalTokens: stats.effectiveContextWindow,
    remainingTokens: Math.max(0, stats.effectiveContextWindow - stats.usedTokens),
    percentage,
    modelName: prev?.modelName || '',
    messageCount: stats.messageCount ?? prev?.messageCount ?? 0,
    breakdown: stats.breakdown ?? prev?.breakdown,
  })
  if (tokenStatsBySession.value.size > MAX_CACHED_SESSIONS) {
    const oldest = tokenStatsBySession.value.keys().next().value
    if (oldest !== undefined && oldest !== sessionId) {
      tokenStatsBySession.value.delete(oldest)
    }
  }
}

/**
 * 从 SSE 流事件注入上下文统计（turn_end / compression_end / compaction_summary 携带）
 *
 * 后端在事件中携带上下文统计（usedTokens / effectiveContextWindow / messageCount /
 * breakdown），前端按事件所属会话写入切片，不发 REST。
 */
export function updateTokenStatsFromSSE(sessionId: string, stats: ContextStatsInput) {
  applyContextStats(sessionId, stats)
}

/**
 * 从会话事件日志逆向扫描最后一个「上下文占用锚点」并填充该会话的环形指示器切片。
 *
 * 兼容两种形状（eventLog 是领域事件与 live chunk 的混合数组）：
 * - live chunk（turn_end / context_stats / compaction_summary / compression_end）：`e.contextStats`
 * - 领域事件（context/stats / turn/finish / compaction/end）：`e.data.usedTokens + e.data.effectiveContextWindow`
 *
 * 后端在「占用稳定点」（每次小轮次请求、每轮结束、每次压缩后）把权威 usedTokens/
 * effectiveContextWindow（含 messageCount/breakdown）落进事件 → 打开/切换会话时直接取最后一个锚点。
 *
 * 被 turn/delete 删除的回合（重答/删除）不参与恢复：否则会显示旧回合的占用。
 * @returns 是否找到锚点（false → 显示空状态）
 */
export function applyContextStatsFromEvents(
  sessionId: string | null | undefined,
  events: unknown[],
): boolean {
  if (!sessionId || !Array.isArray(events)) return false

  // 先收集被删除的回合（事件页/内存事件数组里都有 turn/delete）
  const deletedTurnIds = new Set<string>()
  for (const event of events) {
    const e = event as
      | { type?: unknown; data?: { turnId?: unknown } }
      | null
      | undefined
    if (e?.type === 'turn/delete' && typeof e.data?.turnId === 'string') {
      deletedTurnIds.add(e.data.turnId)
    }
  }

  for (let i = events.length - 1; i >= 0; i--) {
    // eventLog 混合两类载体：live chunk（contextStats）与领域事件（data.usedTokens），
    // 其余字段全部走运行时 typeof 收窄
    const e = events[i] as
      | {
          turnId?: unknown
          contextStats?: Record<string, unknown>
          data?: Record<string, unknown>
        }
      | null
      | undefined
    if (!e) continue
    const live = e.contextStats
    if (
      live &&
      typeof live.usedTokens === 'number' &&
      typeof live.effectiveContextWindow === 'number' &&
      live.effectiveContextWindow > 0
    ) {
      // live chunk 的回合归属在顶层
      if (typeof e.turnId === 'string' && deletedTurnIds.has(e.turnId)) continue
      applyContextStats(sessionId, {
        usedTokens: live.usedTokens,
        effectiveContextWindow: live.effectiveContextWindow,
        messageCount: typeof live.messageCount === 'number' ? live.messageCount : undefined,
        breakdown: pickBreakdown(live.breakdown),
      })
      return true
    }
    const domain = e.data
    if (
      domain &&
      typeof domain.usedTokens === 'number' &&
      typeof domain.effectiveContextWindow === 'number' &&
      domain.effectiveContextWindow > 0
    ) {
      // 领域事件的回合归属在 data.turnId
      if (typeof domain.turnId === 'string' && deletedTurnIds.has(domain.turnId)) continue
      applyContextStats(sessionId, {
        usedTokens: domain.usedTokens,
        effectiveContextWindow: domain.effectiveContextWindow,
        messageCount: typeof domain.messageCount === 'number' ? domain.messageCount : undefined,
        breakdown: pickBreakdown(domain.breakdown),
      })
      return true
    }
  }
  return false
}

/** 清空统计切片（测试/会话数据清理用；不传则清全部） */
export function clearTokenStats(sessionId?: string) {
  if (sessionId) tokenStatsBySession.value.delete(sessionId)
  else tokenStatsBySession.value.clear()
}

/**
 * 会话级 Token 统计切片（环形指示器与记忆弹窗同源）
 *
 * 数据完全来自事件流投影：实时由 streamProjector 按会话喂入，打开/切换会话由
 * 调用方逆向扫描事件日志锚点填充（见 applyContextStatsFromEvents）。
 */
export function useSessionTokenStats(sessionId: Ref<string | null | undefined>) {
  const tokenStats = computed<TokenStatsData | null>(() => {
    const id = sessionId.value
    return id ? tokenStatsBySession.value.get(id) ?? null : null
  })

  return {
    tokenStats,
  }
}
