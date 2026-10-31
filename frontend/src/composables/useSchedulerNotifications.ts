import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { apiService } from '@/services/ApiService'
import type { SessionEvent } from '@/services/modules/SessionEventsService'

/** 后端 scheduler.task_finished 的负载（见 stream.events.ts） */
interface SchedulerFinishedPayload {
  taskId: string
  taskName: string
  sessionId?: string | null
  status: 'completed' | 'failed'
  error?: string | null
  finishedAt?: string
}

/**
 * 定时任务完成/失败通知。
 *
 * - Electron：窗口未聚焦时由主进程弹系统通知（主进程自己判断焦点），点击回传 sessionId；
 * - Web：页面隐藏且已授权时使用浏览器通知；
 * - 未读红点由 useSessionEvents 的 stream_status_changed 链路负责，这里不重复处理。
 */
export function useSchedulerNotifications() {
  const router = useRouter()
  const { t } = useI18n()

  let offEvent: (() => void) | null = null
  let offClick: (() => void) | null = null

  function openTarget(sessionId?: string | null) {
    if (sessionId) {
      void router.push({ name: 'Chat', params: { sessionId } })
    } else {
      void router.push({ name: 'Scheduler' })
    }
  }

  function notify(payload: SchedulerFinishedPayload) {
    const title =
      payload.status === 'completed'
        ? t('scheduler.notify.completedTitle', { name: payload.taskName })
        : t('scheduler.notify.failedTitle', { name: payload.taskName })

    const body =
      payload.status === 'failed'
        ? payload.error?.trim().slice(0, 140) || t('scheduler.notify.failedBody')
        : t('scheduler.notify.completedBody')

    const api = window.electronAPI
    if (api?.showNotification) {
      void api.showNotification({
        title,
        body,
        sessionId: payload.sessionId ?? null,
      })
      return
    }

    if (
      typeof Notification !== 'undefined' &&
      document.hidden &&
      Notification.permission === 'granted'
    ) {
      const notification = new Notification(title, { body })
      notification.onclick = () => {
        window.focus()
        openTarget(payload.sessionId)
      }
    }
  }

  onMounted(() => {
    offEvent = apiService.onSessionEvent('scheduler_task_finished', (event: SessionEvent) => {
      const payload = event.payload as SchedulerFinishedPayload | undefined
      if (!payload?.taskId || !payload.taskName) return
      notify(payload)
    })

    offClick = window.electronAPI?.onNotificationClick?.((payload) => {
      openTarget(payload.sessionId ?? null)
    }) ?? null
  })

  onUnmounted(() => {
    offEvent?.()
    offClick?.()
    offEvent = null
    offClick = null
  })
}
