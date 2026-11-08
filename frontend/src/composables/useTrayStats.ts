import { onMounted, onUnmounted } from 'vue'
import { useSessionStore } from '@/stores/session'
import {
  buildPetBubble,
  derivePetMode,
  pickPetSessions,
  type PetMode,
  type PetSessionBrief,
} from '@/utils/petState'
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
    let awaiting = 0
    /** 最近活跃的运行中会话（标题/工具名/跳转锚点都取它） */
    let activeSessionId: string | null = null
    let activeAt = 0
    /** 候选会话列表（最近活跃降序收集，气泡列表再按状态优先级择优） */
    const briefs: Array<PetSessionBrief & { at: number }> = []

    const map = sessionStore.sessionsMap
    if (map) {
      for (const [sid, session] of map) {
        if (!sid) continue
        // 与侧边栏可见性对齐：归档会话和 bot/sub_agent 不进桌宠
        if (session?.archived) continue
        if (session?.sessionType === 'bot' || session?.sessionType === 'sub_agent')
          continue
        const state = sessionStore.getSidebarState(sid)
        const at = new Date(
          session?.lastActiveAt || session?.updatedAt || 0,
        ).getTime()
        // 待答（agent 提问/请求批准）：最高优先级，跨会话可感知（含未打开会话）
        const isAwaiting = sessionStore.peekSessionPendingAskQueue(sid).length > 0
        const isRunning = state.working

        if (isAwaiting) {
          awaiting++
          briefs.push({
            sessionId: sid,
            title: session?.title ?? '',
            status: 'awaiting',
            at,
          })
        } else if (isRunning) {
          running++
          briefs.push({
            sessionId: sid,
            title: session?.title ?? '',
            status: 'running',
            at,
          })
        }
        if (state.unread) {
          unread++
          // awaiting/running 已隐含「需要关注」，列表里不再重复占一行
          if (!isAwaiting && !isRunning) {
            briefs.push({
              sessionId: sid,
              title: session?.title ?? '',
              status: 'unread',
              at,
            })
          }
        }

        if (isRunning && at > activeAt) {
          activeAt = at
          activeSessionId = sid
        }
      }
    }

    // 活动时间戳：有待答、有任务或有未读都算「用户有事可做」，重置长空闲计时
    if (running > 0 || unread > 0 || awaiting > 0) {
      lastActiveAt = Date.now()
    }
    const idleMs = Date.now() - lastActiveAt

    const mode: PetMode = derivePetMode({ running, unread, awaiting, idleMs })
    const title = activeSessionId
      ? sessionStore.getSession(activeSessionId)?.title ?? ''
      : ''
    const toolLabel = activeSessionId ? lastToolLabel(activeSessionId) : ''
    // 摘要列表：按状态优先级排序截取（awaiting > running > unread），
    // 先剥掉排序用的 at 字段再择优，避免内部时间戳漏进 IPC 载荷
    const sessions: PetSessionBrief[] = pickPetSessions(
      briefs.sort((a, b) => b.at - a.at).map(({ at: _at, ...brief }) => brief),
    ).map((brief) => {
      if (brief.status === 'running') {
        brief.toolLabel = lastToolLabel(brief.sessionId)
      }
      return brief
    })

    // 有未读无任务时，点击气泡应跳到最近有未读的会话；
    // 有列表时以最高优先级会话为准（列表首项）
    const bubbleSessionId =
      sessions[0]?.sessionId ?? activeSessionId ?? findLatestUnreadSessionId()
    const bubble = buildPetBubble({
      running,
      unread,
      awaiting,
      title,
      toolLabel,
      sessions,
    })

    return {
      running,
      unread,
      awaiting,
      mode,
      title: bubble?.text ?? '',
      toolLabel: bubble?.tone === 'busy' ? toolLabel : '',
      sessionId: bubble ? bubbleSessionId : null,
      sessions,
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
