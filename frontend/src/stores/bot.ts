import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import type { BotInstance, CreateBotRequest, PlatformMetadata, UpdateBotRequest } from '@/types/bot'
import { ElMessage } from 'element-plus'
import { t } from '@/locales'

export const useBotStore = defineStore('bot', () => {
  // State
  const botInstances = ref<BotInstance[]>([])
  const platforms = ref<PlatformMetadata[]>([])
  const loading = ref(false)
  const currentBot = ref<BotInstance | null>(null)

  // Getters
  const getBotById = computed(() => {
    return (id: string) => botInstances.value.find(bot => bot.id === id)
  })

  // Actions
  async function loadPlatforms() {
    try {
      platforms.value = await apiService.fetchBotPlatforms()
    } catch (error) {
      ElMessage.error(t('session.bot.loadPlatformsFailed'))
      throw error
    }
  }

  /**
   * @param options.silent 后台同步用：失败不弹 toast（由下一页事件/轮询重试）
   */
  async function loadBotInstances(options: { silent?: boolean } = {}) {
    loading.value = true
    try {
      botInstances.value = await apiService.fetchBotInstances()
    } catch (error) {
      if (!options.silent) ElMessage.error(t('session.bot.loadBotsFailed'))
      throw error
    } finally {
      loading.value = false
    }
  }

  /**
   * 事件推送的运行时状态就地更新（bot_status_changed）。
   * 只覆盖事件携带的字段：重连中不带 status，避免把落盘的 running 写成 connecting。
   */
  function applyRuntimeStatus(
    botId: string,
    patch: {
      runtimeStatus?: string | null
      status?: BotInstance['status']
      lastError?: string | null
    },
  ) {
    const bot = botInstances.value.find(item => item.id === botId)
    if (!bot) return
    if (patch.runtimeStatus !== undefined) bot.runtimeStatus = patch.runtimeStatus
    if (patch.status !== undefined) bot.status = patch.status
    if (patch.lastError !== undefined) bot.lastError = patch.lastError
  }

  async function createBot(data: CreateBotRequest) {
    try {
      const newBot = await apiService.createBotInstance(data)
      botInstances.value.unshift(newBot)
      ElMessage.success(t('session.bot.createSuccess'))
      return newBot
    } catch (error) {
      ElMessage.error(t('session.bot.createFailed'))
      throw error
    }
  }

  async function updateBot(id: string, data: UpdateBotRequest) {
    try {
      const updatedBot = await apiService.updateBotInstance(id, data)
      const index = botInstances.value.findIndex(bot => bot.id === id)
      if (index !== -1) {
        botInstances.value[index] = updatedBot
      }
      ElMessage.success(t('session.bot.updateSuccess'))
      return updatedBot
    } catch (error) {
      ElMessage.error(t('session.bot.updateFailed'))
      throw error
    }
  }

  async function deleteBot(id: string) {
    try {
      await apiService.deleteBotInstance(id)
      botInstances.value = botInstances.value.filter(bot => bot.id !== id)
      ElMessage.success(t('session.bot.deleteSuccess'))
    } catch (error) {
      ElMessage.error(t('session.bot.deleteFailed'))
      throw error
    }
  }

  async function startBot(id: string) {
    try {
      await apiService.startBotInstance(id)
      const bot = botInstances.value.find(b => b.id === id)
      if (bot) {
        bot.status = 'running'
        bot.runtimeStatus = 'CONNECTING'
      }
      ElMessage.success(t('session.bot.starting'))
    } catch (error) {
      ElMessage.error(t('session.bot.startFailed'))
      throw error
    }
  }

  async function stopBot(id: string) {
    try {
      await apiService.stopBotInstance(id)
      const bot = botInstances.value.find(b => b.id === id)
      if (bot) {
        bot.status = 'stopped'
        bot.runtimeStatus = 'DISCONNECTED'
      }
      ElMessage.success(t('session.bot.stopped'))
    } catch (error) {
      ElMessage.error(t('session.bot.stopFailed'))
      throw error
    }
  }

  async function restartBot(id: string) {
    try {
      await apiService.restartBotInstance(id)
      const bot = botInstances.value.find(b => b.id === id)
      if (bot) {
        bot.status = 'running'
        bot.runtimeStatus = 'CONNECTING'
      }
      ElMessage.success(t('session.bot.restarting'))
    } catch (error) {
      ElMessage.error(t('session.bot.restartFailed'))
      throw error
    }
  }

  return {
    botInstances,
    platforms,
    loading,
    currentBot,
    getBotById,
    loadPlatforms,
    loadBotInstances,
    applyRuntimeStatus,
    createBot,
    updateBot,
    deleteBot,
    startBot,
    stopBot,
    restartBot
  }
})
