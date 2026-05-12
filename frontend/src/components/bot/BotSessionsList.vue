<template>
  <div class="h-full flex flex-col">
    <!-- 机器人筛选标签 -->
    <div v-if="!loading" class="pb-4">
      <div class="flex flex-wrap gap-2">
        <!-- 全部会话标签 -->
        <div 
          class="px-4 py-2 rounded-full cursor-pointer transition-all duration-200 select-none text-sm border"
          :class="selectedBotId === null 
            ? 'bg-(--color-primary) text-white border-(--color-primary) shadow-[0_2px_8px_rgba(251,114,153,0.3)] hover:bg-(--color-primary-hover) hover:border-(--color-primary-hover)'
            : 'bg-(--color-surface) text-(--color-text-gray) border-(--color-border) hover:bg-(--color-primary-100) hover:text-(--color-primary) hover:border-(--color-primary-200)'"
          @click="selectBot(null)">
          全部会话
        </div>

        <!-- 机器人标签 -->
        <div 
          v-for="bot in botStore.botInstances" 
          :key="bot.id"
          class="px-4 py-2 rounded-full cursor-pointer transition-all duration-200 select-none text-sm border"
          :class="selectedBotId === bot.id 
            ? 'bg-(--color-primary) text-white border-(--color-primary) shadow-[0_2px_8px_rgba(251,114,153,0.3)] hover:bg-(--color-primary-hover) hover:border-(--color-primary-hover)'
            : 'bg-(--color-surface) text-(--color-text-gray) border-(--color-border) hover:bg-(--color-primary-100) hover:text-(--color-primary) hover:border-(--color-primary-200)'"
          @click="selectBot(bot.id)">
          {{ bot.name }}
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <el-icon class="is-loading" :size="32">
        <Loading />
      </el-icon>
      <span class="ml-2 text-gray-500 dark:text-[#8b8d95]">加载中...</span>
    </div>

    <!-- 会话列表 -->
    <div v-else class="flex-1 overflow-y-auto">
      <el-table v-if="sessions.length > 0" :data="sessions" style="width: 100%" stripe @row-click="handleRowClick">
        <el-table-column prop="title" label="会话标题" min-width="200">
          <template #default="{ row }">
            <span class="truncate">{{ row.title || '未命名会话' }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="platform" label="平台" width="120">
          <template #default="{ row }">
            <el-tag size="small" type="info">
              {{ getPlatformName(row.platform) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="botId" label="关联 Bot" min-width="150">
          <template #default="{ row }">
            <span class="text-sm text-gray-600 dark:text-[#8b8d95]">
              {{ getBotName(row.botId) || '未知 Bot' }}
            </span>
          </template>
        </el-table-column>

        <el-table-column prop="lastActiveAt" label="最后活跃" width="180">
          <template #default="{ row }">
            <span class="text-sm text-gray-500 dark:text-[#8b8d95]">
              {{ formatTime(row.lastActiveAt) }}
            </span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <div class="flex gap-2">
              <el-button link type="primary" size="small" @click.stop="handleViewChat(row)">
                查看对话
              </el-button>
              <el-button link type="warning" size="small" @click.stop="handleClearMessages(row)">
                清空记录
              </el-button>
              <el-button link type="danger" size="small" @click.stop="handleDeleteSession(row)">
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div v-else class="text-center py-12">
        <el-icon size="48" class="text-gray-300 dark:text-[#3e4046] mb-3">
          <ChatDotRound />
        </el-icon>
        <p class="text-lg text-gray-500 dark:text-[#8b8d95]">暂无 Bot 会话</p>
        <p class="text-sm mt-1 text-gray-400 dark:text-[#6b6d75]">启动机器人后，与机器人的对话将显示在这里</p>
      </div>

      <!-- 分页 -->
      <div v-if="total > 0" class="flex justify-center py-4">
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :total="total"
          :page-sizes="[20, 50, 80]" layout="total, sizes, prev, pager, next" @current-change="handlePageChange"
          @size-change="handleSizeChange" />
      </div>
    </div>

    <!-- 对话详情对话框 -->
    <BotSessionDialog v-model="dialogVisible" :session="selectedSession" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, ChatDotRound } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { useBotStore } from '@/stores/bot'
import BotSessionDialog from './BotSessionDialog.vue'
import type { Session } from '@/types/session'
import { useRoute, useRouter } from 'vue-router'

const botStore = useBotStore()
const route = useRoute()
const router = useRouter()

const loading = ref(false)
const sessions = ref<Session[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const selectedBotId = ref<string | null>(null) // 当前选中的机器人ID，null表示全部

// 对话框相关
const dialogVisible = ref(false)
const selectedSession = ref<Session | null>(null)

// 从URL查询参数恢复筛选状态
const restoreFilterState = () => {
  const botId = route.query.botId as string | undefined
  const page = route.query.page as string | undefined
  const size = route.query.size as string | undefined
  
  if (botId) {
    selectedBotId.value = botId
  }
  
  if (page) {
    currentPage.value = parseInt(page, 10) || 1
  }
  
  if (size) {
    pageSize.value = parseInt(size, 10) || 20
  }
}

// 更新URL查询参数以维持状态
const updateUrlParams = () => {
  const query: any = { ...route.query }
  
  if (selectedBotId.value) {
    query.botId = selectedBotId.value
  } else {
    delete query.botId
  }
  
  if (currentPage.value > 1) {
    query.page = currentPage.value.toString()
  } else {
    delete query.page
  }
  
  if (pageSize.value !== 20) { // 20是默认值
    query.size = pageSize.value.toString()
  } else {
    delete query.size
  }
  
  router.replace({ query })
}

// 选择机器人筛选
const selectBot = (botId: string | null) => {
  selectedBotId.value = botId
  currentPage.value = 1 // 重置到第一页
  updateUrlParams() // 更新URL参数
  loadSessions()
}

// 监听机器人列表变化，重新加载会话
watch(() => botStore.botInstances.length, () => {
  if (selectedBotId.value && !botStore.botInstances.find(b => b.id === selectedBotId.value)) {
    // 如果当前选中的机器人被删除了，重置为全部
    selectedBotId.value = null
    currentPage.value = 1
    updateUrlParams() // 更新URL参数
    loadSessions()
  }
})

// 监听页码变化，更新URL
watch(currentPage, () => {
  updateUrlParams()
})

// 加载会话列表
const loadSessions = async () => {
  loading.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize.value
    const response = await apiService.fetchBotSessions(skip, pageSize.value, selectedBotId.value || undefined)
    sessions.value = response.items || []
    total.value = response.total || 0
  } catch (error) {
    console.error('加载 Bot 会话失败:', error)
    ElMessage.error('加载会话失败')
  } finally {
    loading.value = false
  }
}

// 获取平台名称
const getPlatformName = (platform?: string): string => {
  if (!platform) return '未知'
  const platformMap: Record<string, string> = {
    qq: 'QQ',
    wechat: '微信',
    lark: '飞书',
    wecom: '企业微信',
  }
  return platformMap[platform.toLowerCase()] || platform
}

// 获取 Bot 名称
const getBotName = (botId?: string): string => {
  if (!botId) return ''
  const bot = botStore.botInstances.find(b => b.id === botId)
  return bot?.name || ''
}

// 格式化时间
const formatTime = (time?: string): string => {
  if (!time) return '-'
  const date = new Date(time)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // 小于1分钟
  if (diff < 60 * 1000) {
    return '刚刚'
  }
  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))}分钟前`
  }
  // 小于24小时
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))}小时前`
  }
  // 大于24小时
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 行点击事件
const handleRowClick = (row: Session) => {
  handleViewChat(row)
}

// 查看对话
const handleViewChat = (session: Session) => {
  selectedSession.value = session
  dialogVisible.value = true
}

// 清空聊天记录
const handleClearMessages = async (session: Session) => {
  try {
    await ElMessageBox.confirm(
      `确定要清空会话 "${session.title || '未命名会话'}" 的所有聊天记录吗？会话本身将保留，但所有消息将被永久删除，且不可恢复。`,
      '清空确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await apiService.clearSessionMessages(session.id)
    ElMessage.success('聊天记录已清空')

    // 如果对话框打开，关闭它
    if (dialogVisible.value && selectedSession.value?.id === session.id) {
      dialogVisible.value = false
      selectedSession.value = null
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('清空聊天记录失败:', error)
      ElMessage.error('清空失败')
    }
  }
}

// 删除会话
const handleDeleteSession = async (session: Session) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除会话 "${session.title || '未命名会话'}" 吗？此操作将删除该会话的所有消息记录，且不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await apiService.deleteSession(session.id)
    ElMessage.success('会话已删除')

    // 重新加载列表
    await loadSessions()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除会话失败:', error)
      ElMessage.error('删除失败')
    }
  }
}

// 分页变化
const handlePageChange = (page: number) => {
  currentPage.value = page
  updateUrlParams() // 更新URL参数
  loadSessions()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  updateUrlParams() // 更新URL参数
  loadSessions()
}

onMounted(async () => {
  // 先加载机器人列表，以便显示筛选标签
  if (botStore.botInstances.length === 0) {
    await botStore.loadBotInstances()
  }

  // 从URL恢复筛选状态
  restoreFilterState()

  loadSessions()
})
</script>

<style scoped>
/* 样式由 Tailwind CSS 处理 */
</style>
