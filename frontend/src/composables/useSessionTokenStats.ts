import { ref, watch, type Ref } from 'vue'

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

const tokenStats = ref<TokenStatsData | null>(null)

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

/** 共享合并：填充环形指示器字段；messageCount/breakdown 事件携带时才覆盖（旧锚点缺省保留旧值） */
function applyContextStats(stats: ContextStatsInput) {
  // 百分比约束两位小数（浮点直除会产生 0.24789999999999998 之类的脏值）
  const percentage = parseFloat(
    Math.min((stats.usedTokens / stats.effectiveContextWindow) * 100, 100).toFixed(2),
  )
  tokenStats.value = {
    usedTokens: stats.usedTokens,
    totalTokens: stats.effectiveContextWindow,
    remainingTokens: Math.max(0, stats.effectiveContextWindow - stats.usedTokens),
    percentage,
    modelName: tokenStats.value?.modelName || '',
    messageCount: stats.messageCount ?? tokenStats.value?.messageCount ?? 0,
    breakdown: stats.breakdown ?? tokenStats.value?.breakdown,
  }
}

/**
 * 从 SSE 流事件注入上下文统计（turn_end / compression_end / compaction_summary 携带）
 *
 * 后端在事件中携带上下文统计（usedTokens / effectiveContextWindow / messageCount /
 * breakdown），前端直接更新环形指示器与细分面板，不发 REST。
 */
export function updateTokenStatsFromSSE(stats: ContextStatsInput) {
  applyContextStats(stats)
}

/**
 * 从会话事件日志逆向扫描最后一个「上下文占用锚点」并填充环形指示器。
 *
 * 兼容两种形状（eventLog 是领域事件与 live chunk 的混合数组）：
 * - live chunk（turn_end / compaction_summary / compression_end）：`e.contextStats`
 * - 领域事件（turn/finish / compaction/end）：`e.data.usedTokens + e.data.effectiveContextWindow`
 *
 * 后端在「占用稳定点」（每轮结束、每次压缩后）把权威 usedTokens/effectiveContextWindow
 * （含 messageCount/breakdown）落进持久化事件 → 打开/切换会话时直接取最后一个锚点。
 * @returns 是否找到锚点（false → 显示空状态）
 */
export function applyContextStatsFromEvents(events: unknown[]): boolean {
  if (!Array.isArray(events)) return false
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as Record<string, any> | null | undefined
    if (!e) continue
    const live = e.contextStats
    if (
      live &&
      typeof live.usedTokens === 'number' &&
      typeof live.effectiveContextWindow === 'number' &&
      live.effectiveContextWindow > 0
    ) {
      applyContextStats({
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
      applyContextStats({
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

/**
 * 会话级 Token 统计共享状态
 *
 * 模块级 ref 确保所有调用方共享同一份数据（环形指示器与记忆弹窗同源）。
 * 数据完全来自事件流投影：实时由 streamProjector 喂入，打开/切换会话由
 * 调用方逆向扫描事件日志锚点填充（见 applyContextStatsFromEvents）。
 */
export function useSessionTokenStats(sessionId: Ref<string | null>) {
  // sessionId 变化时清空旧数据（新会话由 ChatPanel 事件页加载后逆向扫描锚点填充）
  watch(sessionId, () => {
    tokenStats.value = null
  })

  return {
    tokenStats,
  }
}
