import { ref, watch, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { apiService } from '@/services/ApiService'

export interface TokenBreakdown {
  systemPrompt: number
  summary: number
  userPrompt: number
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
  breakdown: TokenBreakdown
}

const tokenStats = ref<TokenStatsData | null>(null)
const loading = ref(false)
let currentSessionId: string | null = null

/** 共享合并：填充环形指示器字段，保留已存在的 modelName/messageCount/breakdown */
function applyContextStats(stats: { usedTokens: number; effectiveContextWindow: number }) {
  const percentage = Math.min(
    (stats.usedTokens / stats.effectiveContextWindow) * 100,
    100,
  )
  tokenStats.value = {
    usedTokens: stats.usedTokens,
    totalTokens: stats.effectiveContextWindow,
    remainingTokens: Math.max(0, stats.effectiveContextWindow - stats.usedTokens),
    percentage,
    modelName: tokenStats.value?.modelName || '',
    messageCount: tokenStats.value?.messageCount || 0,
    breakdown: tokenStats.value?.breakdown || {
      systemPrompt: 0,
      summary: 0,
      userPrompt: 0,
      history: 0,
      tools: 0,
    },
  }
}

/**
 * 从 SSE 流事件注入上下文统计（turn_end / compression_end / compaction_summary 携带）
 *
 * 后端在事件中携带轻量上下文统计（usedTokens / effectiveContextWindow），
 * 前端直接更新环形指示器，不发 REST。详细 breakdown 仍由弹窗按需获取。
 */
export function updateTokenStatsFromSSE(stats: {
  usedTokens: number
  effectiveContextWindow: number
}) {
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
 * 落进持久化事件 → 打开/切换会话时无需 REST /token-stats，直接取最后一个锚点。
 * @returns 是否找到锚点（false → 调用方 fallback REST）
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
      applyContextStats(live)
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
      })
      return true
    }
  }
  return false
}

/**
 * 会话级 Token 统计共享状态
 *
 * 模块级 ref 确保所有调用方共享同一份数据，
 * 谁 fetch 了大家都更新，避免按钮和弹窗各管各的。
 */
export function useSessionTokenStats(sessionId: Ref<string | null>) {
  const sessionStore = useSessionStore()

  /**
   * 从 API 获取 Token 统计
   *
   * ⚠️ 唯一允许的 REST 拉取入口：仅记忆管理弹窗（MemoPanel）打开/手动刷新时调用。
   * 打开/切换会话一律不访问 token-stats——环形指示器由事件日志逆向扫描锚点填充，
   * 无锚点则显示 0；详细 breakdown 仅弹窗按需获取。
   */
  async function fetchTokenStats() {
    const sid = sessionId.value
    if (!sid) return
    loading.value = true
    try {
      tokenStats.value = await apiService.fetchSessionTokenStats(sid)
      currentSessionId = sid
    } catch (error: any) {
      console.error('[useSessionTokenStats] 加载 Token 统计失败:', error)
    } finally {
      loading.value = false
    }
  }

  // sessionId 变化时清空旧数据（不 REST：ChatPanel 在事件页加载后逆向扫描锚点填充）
  watch(sessionId, (newId) => {
    tokenStats.value = null
    if (newId) currentSessionId = newId
  })

  return {
    tokenStats,
    loading,
    fetchTokenStats,
  }
}
