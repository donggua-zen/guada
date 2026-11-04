import { onMounted, onUnmounted } from 'vue'
import { useSessionStore } from '@/stores/session'
import { buildPetBubble, derivePetMode, type PetMode } from '@/utils/petState'
import type { ToolCallEntry } from '@/types/message'

/**
 * 桌宠 + 托盘状态推送 composable
 *
 * 聚合前端已有状态（sessionSidebarStates + 回合缓存），每 2s 推送一次到 Electron 主进程：
 * 主进程据此更新托盘提示/菜单、任务栏未读角标，并把状态转给桌宠窗口渲染。
 *
 * 单条轮询同时产出「托盘 stats」与「桌宠 state」，不另开第二条定时器
 * ——两路数据同源（同一批 sessionSidebarStates），分开轮询只会让数字互相错位。
 *
 * 仅在 Electron 环境下生效，浏览器环境下自动跳过。
 */
export function useTrayStats() {
  // 仅在 Electron 环境下运行
  if (!window.electronAPI) return

  let intervalId: ReturnType<typeof setInterval> | null = null
  const sessionStore = useSessionStore()

  /** 上次「有活动」（有任务运行或有未读）的时间戳，用于长空闲打哈欠判定 */
  let lastActiveAt = Date.now()

  /**
   * 从会话末回合里取「仍在执行」的工具名。
   *
   * 只做浅层取（末回合 → 末消息 → 末工具调用），不遍历全量执行态：
   * 桌宠气泡只需要「在干什么」的粗粒度提示，精确执行态属于聊天面板。
   * 优先返回无终态 outcome 的调用；都已完成则返回空串（气泡回退成「工具调用」），
   * 免得模型已经在写正文了、气泡还挂着上一个 edit。
   */
  function lastToolLabel(sessionId: string): string {
    const turns = sessionStore.getTurns(sessionId)
    for (let t = turns.length - 1; t >= 0; t -= 1) {
      const messages = turns[t]?.messages
      if (!messages) continue
      for (let m = messages.length - 1; m >= 0; m -= 1) {
        const blocks = messages[m]?.blocks
        if (!blocks) continue
        for (let b = blocks.length - 1; b >= 0; b -= 1) {
          const calls = blocks[b]?.metadata?.toolCalls as
            | ToolCallEntry[]
            | undefined
          if (!Array.isArray(calls) || calls.length === 0) continue
          const pending = calls.filter((call) => !call.outcome)
          const name = pending[pending.length - 1]?.name
          if (name) return name
          return ''
        }
      }
    }
    return ''
  }

  /**
   * 聚合当前所有会话的统计信息 + 桌宠状态
   */
  function computeStats() {
    let running = 0
    let unread = 0
    /** 最近活跃的运行中会话（标题/工具名/跳转锚点都取它） */
    let activeSessionId: string | null = null
    let activeAt = 0

    const map = sessionStore.sessionsMap
    if (map) {
      for (const [sid, session] of map) {
        if (!sid) continue
        const state = sessionStore.getSidebarState(sid)
        if (state.working) {
          running++
          const at = new Date(
            session?.lastActiveAt || session?.updatedAt || 0,
          ).getTime()
          if (at > activeAt) {
            activeAt = at
            activeSessionId = sid
          }
        }
        if (state.unread) unread++
      }
    }

    // 活动时间戳：有任务或有未读都算「用户有事可做」，重置长空闲计时
    if (running > 0 || unread > 0) {
      lastActiveAt = Date.now()
    }
    const idleMs = Date.now() - lastActiveAt

    const mode: PetMode = derivePetMode({ running, unread, idleMs })
    const title = activeSessionId
      ? sessionStore.getSession(activeSessionId)?.title ?? ''
      : ''
    const toolLabel = activeSessionId ? lastToolLabel(activeSessionId) : ''
    // 有未读无任务时，点击气泡应跳到最近有未读的会话
    const bubbleSessionId = activeSessionId ?? findLatestUnreadSessionId()
    const bubble = buildPetBubble({ running, unread, title, toolLabel })

    return {
      running,
      unread,
      mode,
      title: bubble?.text ?? '',
      toolLabel: bubble?.tone === 'busy' ? toolLabel : '',
      sessionId: bubble ? bubbleSessionId : null,
    }
  }

  /** 最近活跃的有未读会话（点击气泡跳转用） */
  function findLatestUnreadSessionId(): string | null {
    const map = sessionStore.sessionsMap
    if (!map) return null
    let latestId: string | null = null
    let latestAt = 0
    for (const [sid, session] of map) {
      if (!sid) continue
      if (!sessionStore.getSidebarState(sid).unread) continue
      const at = new Date(session?.lastActiveAt || session?.updatedAt || 0).getTime()
      if (at > latestAt) {
        latestAt = at
        latestId = sid
      }
    }
    return latestId
  }

  /**
   * 推送统计数据到主进程
   */
  function pushStats() {
    window.electronAPI!.updateTrayStats(computeStats())
  }

  onMounted(() => {
    // 初始推送一次
    pushStats()

    // 每 2 秒轮询推送（SSE 事件会同步到 store，轮询开销极小）
    intervalId = setInterval(pushStats, 2000)
  })

  onUnmounted(() => {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  })
}
