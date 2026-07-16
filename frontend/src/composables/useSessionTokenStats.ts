import { ref, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
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

  /**
   * 流结束后自动刷新（防抖 1s）
   */
  const debouncedRefresh = useDebounceFn(() => {
    if (!sessionId.value) return
    fetchTokenStats()
  }, 1000)

  watch(
    () => (sessionId.value ? sessionStore.sessionIsStreaming(sessionId.value) : false),
    (isStreaming, wasStreaming) => {
      if (wasStreaming && !isStreaming) {
        debouncedRefresh()
      }
    },
  )

  // sessionId 变化时重新获取
  watch(sessionId, (newId) => {
    if (newId) {
      // 如果已有同 session 的数据不再重复获取（按钮需手动刷新时可用）
      if (currentSessionId !== newId) {
        // 立即清除旧数据，避免短暂显示上一个会话的进度
        tokenStats.value = null
        fetchTokenStats()
      }
    } else {
      tokenStats.value = null
    }
  })

  return {
    tokenStats,
    loading,
    fetchTokenStats,
  }
}
