<template>
  <div class="h-full flex flex-col">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <el-icon class="is-loading" :size="32">
        <Loading />
      </el-icon>
      <span class="ml-2 text-gray-500">加载中...</span>
    </div>

    <!-- 会话列表 -->
    <div v-else class="flex-1 overflow-y-auto">
      <el-table
        v-if="sessions.length > 0"
        :data="sessions"
        style="width: 100%"
        stripe
        @row-click="handleRowClick"
      >
        <el-table-column prop="title" label="会话标题" min-width="200">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <el-avatar :size="32" :src="row.character?.avatarUrl">
                <el-icon><User /></el-icon>
              </el-avatar>
              <span class="truncate">{{ row.title || '未命名会话' }}</span>
            </div>
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
            <span class="text-sm text-gray-600">
              {{ getBotName(row.botId) || '未知 Bot' }}
            </span>
          </template>
        </el-table-column>

        <el-table-column prop="lastActiveAt" label="最后活跃" width="180">
          <template #default="{ row }">
            <span class="text-sm text-gray-500">
              {{ formatTime(row.lastActiveAt) }}
            </span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              @click.stop="handleViewChat(row)"
            >
              查看对话
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div v-else class="text-center py-12 text-gray-500">
        <el-icon size="48" class="text-gray-300 mb-3">
          <ChatDotRound />
        </el-icon>
        <p class="text-lg">暂无 Bot 会话</p>
        <p class="text-sm mt-1">启动机器人后，与机器人的对话将显示在这里</p>
      </div>

      <!-- 分页 -->
      <div v-if="total > 0" class="flex justify-center py-4">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 80]"
          layout="total, sizes, prev, pager, next"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </div>

    <!-- 对话详情对话框 -->
    <BotSessionDialog
      v-model="dialogVisible"
      :session="selectedSession"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, User, ChatDotRound } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { useBotStore } from '@/stores/bot'
import BotSessionDialog from './BotSessionDialog.vue'
import type { Session } from '@/types/session'

const botStore = useBotStore()

const loading = ref(false)
const sessions = ref<Session[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)

// 对话框相关
const dialogVisible = ref(false)
const selectedSession = ref<Session | null>(null)

// 加载会话列表
const loadSessions = async () => {
  loading.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize.value
    const response = await apiService.fetchBotSessions(skip, pageSize.value)
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

// 分页变化
const handlePageChange = (page: number) => {
  currentPage.value = page
  loadSessions()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  loadSessions()
}

onMounted(() => {
  loadSessions()
})
</script>

<style scoped>
/* 样式由 Element Plus 和 Tailwind 处理 */
</style>
