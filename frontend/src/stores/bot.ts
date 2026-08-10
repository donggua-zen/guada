import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import type { BotInstance, PlatformMetadata } from '@/types/bot'
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

  async function loadBotInstances() {
    loading.value = true
    try {
      botInstances.value = await apiService.fetchBotInstances()
    } catch (error) {
      ElMessage.error(t('session.bot.loadBotsFailed'))
      throw error
    } finally {
      loading.value = false
    }
  }

  async function createBot(data: any) {
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

  async function updateBot(id: string, data: any) {
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
    createBot,
    updateBot,
    deleteBot,
    startBot,
    stopBot,
    restartBot
  }
})
