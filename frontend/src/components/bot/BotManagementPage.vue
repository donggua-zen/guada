<template>
  <div class="h-full flex flex-col md:max-w-260 md:mx-auto">
    <div class="flex flex-col h-full">
      <!-- 头部 -->
      <div class="flex justify-between items-center pb-4">
        <el-button type="primary" @click="showCreateDialog" class="flex items-center">
          <template #icon>
            <Plus />
          </template>
          新建机器人
        </el-button>
      </div>

      <!-- 机器人列表 -->
      <div class="flex-1 overflow-y-auto pt-4">
        <!-- 加载状态 -->
        <div v-if="botStore.loading" class="flex justify-center items-center py-12">
          <el-icon class="is-loading" :size="32">
            <Loading />
          </el-icon>
          <span class="ml-2 text-gray-500">加载中...</span>
        </div>

        <!-- 机器人卡片网格 -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          <BotCard v-for="bot in botStore.botInstances" :key="bot.id" :bot="bot" @edit="handleEdit"
            @delete="handleDelete" @start="handleStart" @stop="handleStop" />

          <!-- 空状态 -->
          <div v-if="!botStore.loading && botStore.botInstances.length === 0"
            class="col-span-full text-center py-12 text-gray-500">
            <el-icon size="48" class="text-gray-300 mb-3">
              <Cpu />
            </el-icon>
            <p class="text-lg">暂无机器人</p>
            <p class="text-sm mt-1">点击上方按钮创建第一个机器人</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建/编辑对话框 -->
    <BotModal v-model="dialogVisible" :bot="currentBot" @saved="handleSaved" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Plus, Loading, Cpu } from '@element-plus/icons-vue'
import { useBotStore } from '@/stores/bot'
import BotCard from './BotCard.vue'
import BotModal from './BotModal.vue'
import type { BotInstance } from '@/types/bot'

const botStore = useBotStore()
const dialogVisible = ref(false)
const currentBot = ref<BotInstance | null>(null)

// 页面加载时获取数据
onMounted(async () => {
  await loadBots()
})

// 加载机器人列表
const loadBots = async () => {
  // 先加载平台元数据
  if (botStore.platforms.length === 0) {
    await botStore.loadPlatforms()
  }
  // 再加载机器人实例
  await botStore.loadBotInstances()
}

// 显示创建对话框
const showCreateDialog = () => {
  currentBot.value = null
  dialogVisible.value = true
}

// 编辑机器人
const handleEdit = (bot: BotInstance) => {
  currentBot.value = bot
  dialogVisible.value = true
}

// 删除机器人
const handleDelete = async (bot: BotInstance) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除机器人 "${bot.name}" 吗？此操作不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await botStore.deleteBot(bot.id)
  } catch (error) {
    // 用户取消或删除失败
    if (error !== 'cancel') {
      console.error('删除失败:', error)
    }
  }
}

// 启动机器人
const handleStart = async (id: string) => {
  try {
    await botStore.startBot(id)
    // 延迟刷新状态
    setTimeout(() => {
      botStore.loadBotInstances()
    }, 2000)
  } catch (error) {
    console.error('启动失败:', error)
  }
}

// 停止机器人
const handleStop = async (id: string) => {
  try {
    await botStore.stopBot(id)
  } catch (error) {
    console.error('停止失败:', error)
  }
}

// 保存成功后的回调
const handleSaved = () => {
  dialogVisible.value = false
  currentBot.value = null
  // 刷新列表
  botStore.loadBotInstances()
}
</script>

<style scoped>
/* 样式由 Tailwind 处理 */
</style>
