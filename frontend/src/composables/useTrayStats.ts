import { onMounted, onUnmounted } from 'vue'
import { useSessionStore } from '@/stores/session'

/**
 * 托盘悬浮窗统计 composable
 *
 * 聚合前端已有状态（sessionSidebarStates + streaming 状态），
 * 定时推送聚合数据到 Electron 主进程，更新悬浮窗和托盘菜单。
 *
 * 仅在 Electron 环境下生效，浏览器环境下自动跳过。
 */
export function useTrayStats() {
  // 仅在 Electron 环境下运行
  if (!window.electronAPI) return

  let intervalId: ReturnType<typeof setInterval> | null = null
  const sessionStore = useSessionStore()

  /**
   * 聚合当前所有会话的统计信息
   */
  function computeStats(): { running: number; unread: number } {
    let running = 0
    let unread = 0

    // 遍历 sessionsMap（store 暴露的 Map<string, Session>）
    const map = sessionStore.sessionsMap as Map<string, any> | undefined
    if (map) {
      for (const [sid] of map) {
        if (!sid) continue
        const state = sessionStore.getSidebarState(sid)
        if (state.working) running++
        if (state.unread) unread++
      }
    }

    return { running, unread }
  }

  /**
   * 推送统计数据到主进程
   */
  function pushStats() {
    const stats = computeStats()
    window.electronAPI!.updateTrayStats(stats)
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
