import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBotStore } from '@/stores/bot'
import { usePopup } from '@/composables/usePopup'
import type { BotInstance } from '@/types/bot'

/** 启动是异步握手，后端 runtimeStatus 需要一段时间才收敛到 CONNECTED */
const START_SETTLE_MS = 2000

/**
 * 后端 status 字段是持久化值，自启不会回写，运行中要以 runtimeStatus 为准。
 * 放宽成字符串是为了同时吃 BotInstance 和 chat-groups 的 BotChatGroup，避免枚举漂移。
 */
export interface BotStatusLike {
  status?: string | null
  runtimeStatus?: string | null
}

export function isBotRunning(bot: BotStatusLike | undefined | null): boolean {
  if (!bot) return false
  return String(bot.runtimeStatus ?? '').toUpperCase() === 'CONNECTED' || bot.status === 'running'
}

export function botStatusKey(bot: BotStatusLike | undefined | null): 'running' | 'connecting' | 'error' | 'stopped' {
  if (!bot) return 'stopped'
  const runtime = String(bot.runtimeStatus ?? '').toUpperCase()
  if (runtime === 'CONNECTED') return 'running'
  if (runtime === 'ERROR' || bot.status === 'error') return 'error'
  // RECONNECTING 与 CONNECTING 一样属于「握手中」，UI 统一显示连接中
  if (runtime === 'CONNECTING' || runtime === 'RECONNECTING') return 'connecting'
  return 'stopped'
}

export function useBotActions(onChanged?: () => void) {
  const { t } = useI18n()
  const botStore = useBotStore()
  const { confirm } = usePopup()

  /** 同一时刻只允许一个机器人在启停，避免连点把状态刷乱 */
  const pendingId = ref<string | null>(null)

  async function settle(delay = 0) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    await Promise.all([botStore.loadBotInstances(), Promise.resolve(onChanged?.())])
  }

  async function toggleBot(bot: BotInstance) {
    if (pendingId.value) return
    pendingId.value = bot.id
    const wasRunning = isBotRunning(bot)
    try {
      if (wasRunning) await botStore.stopBot(bot.id)
      else await botStore.startBot(bot.id)
    } catch {
      return
    } finally {
      pendingId.value = null
    }
    await settle(wasRunning ? 0 : START_SETTLE_MS)
  }

  async function deleteBot(bot: BotInstance) {
    const ok = await confirm(
      t('bot.card.deleteTitle'),
      t('bot.card.deleteConfirm', { name: bot.name }),
      { confirmText: t('common.ok'), cancelText: t('common.cancel'), type: 'warning' },
    )
    if (!ok) return
    try {
      await botStore.deleteBot(bot.id)
    } catch {
      return
    }
    await settle()
  }

  return { pendingId, toggleBot, deleteBot }
}
