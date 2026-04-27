import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import type { BotInstance, PlatformMetadata } from '@/types/bot'
import { ElMessage } from 'element-plus'

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
      ElMessage.error('加载平台列表失败')
      throw error
    }
  }

  async function loadBotInstances() {
    loading.value = true
    try {
      botInstances.value = await apiService.fetchBotInstances()
    } catch (error) {
      ElMessage.error('加载机器人列表失败')
      throw error
    } finally {
      loading.value = false
    }
  }

  async function createBot(data: any) {
    try {
      const newBot = await apiService.createBotInstance(data)
      botInstances.value.unshift(newBot)
      ElMessage.success('机器人创建成功')
      return newBot
    } catch (error) {
      ElMessage.error('创建机器人失败')
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
      ElMessage.success('机器人更新成功')
      return updatedBot
    } catch (error) {
      ElMessage.error('更新机器人失败')
      throw error
    }
  }

  async function deleteBot(id: string) {
    try {
      await apiService.deleteBotInstance(id)
      botInstances.value = botInstances.value.filter(bot => bot.id !== id)
      ElMessage.success('机器人删除成功')
    } catch (error) {
      ElMessage.error('删除机器人失败')
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
      ElMessage.success('机器人启动中...')
    } catch (error) {
      ElMessage.error('启动机器人失败')
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
      ElMessage.success('机器人已停止')
    } catch (error) {
      ElMessage.error('停止机器人失败')
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
      ElMessage.success('机器人重启中...')
    } catch (error) {
      ElMessage.error('重启机器人失败')
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
