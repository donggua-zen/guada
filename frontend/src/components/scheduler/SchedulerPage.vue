<template>
  <div class="h-full flex flex-col">
    <PageHeader />
    <div class="flex-1 overflow-hidden">
      <ScrollContainer class="h-full max-h-full">
        <div class="md:mx-auto md:max-w-260 px-6 pt-4 pb-8">
          <!-- 页头：标题 + 操作按钮 -->
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">自动化</h1>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">配置和管理定时执行任务，让 AI 按计划自动运行。</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <el-button @click="handleAddTask">
                <template #icon><AddOutlined /></template>
                手动新建
              </el-button>
              <el-button type="primary" @click="handleCreateInChat">
                <template #icon><ChatBubbleOutlineOutlined /></template>
                在对话中创建
              </el-button>
            </div>
          </div>

          <!-- Tab 导航 -->
          <el-tabs v-model="activeTab" class="scheduler-tabs">
            <el-tab-pane label="已配置" name="tasks">
              <template #label>
                <div class="flex items-center gap-1.5">
                  <span>已配置</span>
                  <span v-if="tasks.length > 0" class="text-xs text-gray-400 dark:text-[#6b6d75]">{{ tasks.length }}</span>
                </div>
              </template>
            </el-tab-pane>
            <el-tab-pane label="执行历史" name="history" />
            <el-tab-pane label="任务模板" name="templates" />
          </el-tabs>

          <!-- 已配置：任务卡片网格 -->
          <div v-if="activeTab === 'tasks'" class="mt-4">
            <div v-if="tasks.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div v-for="task in tasks" :key="task.id"
                class="group relative bg-(--color-surface) border border-gray-200 dark:border-[#232428] rounded-lg p-4 hover:border-(--color-primary) transition-all duration-200 cursor-pointer"
                @click="handleEditTask(task)">
                <!-- more 菜单（绝对定位，不占流） -->
                <div class="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-20"
                  @click.stop>
                  <DropdownMenu @command="(cmd: string) => handleTaskMenu(cmd, task)">
                    <div class="session-action-trigger">
                      <el-icon class="w-4 h-4 text-gray-500 dark:text-[#8b8d95]">
                        <MoreHorizontal20Filled />
                      </el-icon>
                    </div>
                    <template #dropdown>
                      <DropdownMenuItem command="logs">
                        <DescriptionOutlined class="w-4 h-4 mr-2" />
                        查看日志
                      </DropdownMenuItem>
                      <DropdownMenuItem command="delete">
                        <RemoveCircleOutlineRound class="w-4 h-4 mr-2 text-red-500" />
                        删除任务
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenu>
                </div>

                <!-- 头部：名称 + 开关 -->
                <div class="flex items-center justify-between gap-2">
                  <div class="font-semibold text-base text-gray-900 dark:text-[#e8e9ed] truncate">{{ task.name }}</div>
                  <el-switch v-model="task.enabled" :active-value="true" :inactive-value="false"
                    @change="handleToggleTask(task)" @click.stop inline-prompt active-text="启用" inactive-text="禁用"
                    size="small" class="shrink-0" />
                </div>

                <!-- 状态标签行 -->
                <div v-if="isTaskLimited(task)" class="flex items-center gap-1.5 mt-2">
                  <el-tag type="warning" size="small" effect="plain">
                    剩余 {{ getRemainingCount(task) }} 次
                  </el-tag>
                </div>

                <!-- 提示词 -->
                <div class="text-sm text-gray-500 dark:text-[#8b8d95] mt-3 line-clamp-2 min-h-[2.5rem]">
                  {{ task.prompt }}
                </div>

                <!-- 元数据 -->
                <div class="flex flex-col gap-1.5 text-xs text-gray-400 dark:text-[#6b6d75] mt-3">
                  <div class="flex items-center gap-3">
                    <span class="flex items-center gap-1">
                      <el-icon :size="13"><CalendarTodayOutlined /></el-icon>
                      {{ formatTargetMode(task.targetMode) }}
                    </span>
                    <span v-if="task.executionCount !== undefined && task.maxExecutions">
                      {{ task.executionCount }} / {{ task.maxExecutions }} 次
                    </span>
                    <span v-else-if="task.executionCount !== undefined">
                      已执行 {{ task.executionCount }} 次
                    </span>
                  </div>
                  <span v-if="task.nextRunAt" class="flex items-center gap-1">
                    <el-icon :size="13"><CalendarTodayOutlined /></el-icon>
                    下次: {{ formatDateTime(task.nextRunAt) }}
                  </span>
                </div>

              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="flex flex-col items-center justify-center py-20 text-center">
              <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#2a2c30] flex items-center justify-center mb-4">
                <el-icon :size="28" class="text-gray-400 dark:text-[#6b6d75]">
                  <ScheduleOutlined />
                </el-icon>
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">尚未配置自动化任务。</p>
              <el-button type="primary" class="mt-4" @click="handleCreateInChat">
                从模板创建
                <template #icon><ArrowForwardOutlined /></template>
              </el-button>
            </div>
          </div>

          <!-- 执行历史 -->
          <div v-else-if="activeTab === 'history'" class="mt-4">
            <div class="flex items-center justify-between mb-4">
              <div class="text-sm text-gray-500 dark:text-[#8b8d95]">共 {{ historyLogs.length }} 条记录</div>
              <el-button size="small" @click="loadHistoryLogs" :loading="historyLoading">
                <template #icon><RefreshOutlined /></template>
                刷新
              </el-button>
            </div>
            <!-- 时间线 -->
            <div v-if="historyLogs.length > 0" class="relative">
              <!-- 竖线 -->
              <div class="absolute left-[5px] top-3 bottom-3 w-0.5 bg-gray-200 dark:bg-[#2e3035] rounded-full z-10"></div>
              <div v-for="log in historyLogs" :key="log.id"
                class="relative flex gap-3 pb-5 last:pb-0 cursor-pointer rounded-md hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors -mx-2 px-2 py-1.5"
                @click="handleLogClick(log)">
                <!-- 节点 -->
                <div class="relative z-10 shrink-0 w-3 h-3 mt-1 flex items-center justify-center">
                  <div v-if="log.status === 'completed'" class="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </div>
                  <div v-else-if="log.status === 'failed'" class="w-3 h-3 rounded-full bg-red-500 flex items-center justify-center">
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </div>
                  <div v-else class="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-[#4a4c52] bg-(--color-surface)"></div>
                </div>
                <!-- 内容 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900 dark:text-[#e8e9ed] truncate">{{ getTaskName(log.taskId) }}</span>
                    <span v-if="log.status === 'running'"
                      class="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">执行中</span>
                    <span v-else-if="log.status === 'failed'"
                      class="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">失败</span>
                    <span v-else-if="log.status === 'pending'"
                      class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#2a2c30] text-gray-500 dark:text-[#8b8d95]">等待中</span>
                  </div>
                  <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-1.5">
                    {{ formatTime(log.startedAt) }}
                  </div>
                  <div v-if="log.error" class="text-xs text-red-500 mt-1.5 line-clamp-2">{{ log.error }}</div>
                </div>
              </div>
              <!-- 加载更多 -->
              <div v-if="historyHasMore" class="flex justify-center mt-2">
                <el-button @click="loadMoreHistoryLogs" :loading="historyLoading" text>
                  加载更多
                </el-button>
              </div>
            </div>
            <!-- 空状态 -->
            <div v-else-if="!historyLoading" class="flex flex-col items-center justify-center py-20 text-center">
              <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#2a2c30] flex items-center justify-center mb-4">
                <el-icon :size="28" class="text-gray-400 dark:text-[#6b6d75]">
                  <HistoryOutlined />
                </el-icon>
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">暂无执行记录</p>
            </div>
          </div>

          <!-- 任务模板（占位） -->
          <div v-else-if="activeTab === 'templates'" class="mt-4 flex flex-col items-center justify-center py-20 text-center">
            <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#2a2c30] flex items-center justify-center mb-4">
              <el-icon :size="28" class="text-gray-400 dark:text-[#6b6d75]">
                <DashboardOutlined />
              </el-icon>
            </div>
            <p class="text-sm text-gray-500 dark:text-[#8b8d95]">任务模板功能开发中</p>
          </div>
        </div>
      </ScrollContainer>
    </div>
  </div>

  <!-- 新建/编辑任务弹窗 -->
  <TaskEditDialog v-model="showEditDialog" :is-edit="isEditMode" :task="currentTask" :cron-presets="cronPresets"
    @save="handleSaveTask" />

  <!-- 执行日志抽屉 -->
  <TaskLogDrawer v-model="showLogDrawer" :task="currentTask" :logs="taskLogs" :loading="logsLoading"
    @refresh="() => loadTaskLogs()" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton, ElTag, ElSwitch, ElIcon, ElTabs, ElTabPane } from 'element-plus'
import {
  AddOutlined,
  RefreshOutlined,
  RemoveCircleOutlineRound,
  ScheduleOutlined,
  CalendarTodayOutlined,
  DescriptionOutlined,
  ChatBubbleOutlineOutlined,
  ArrowForwardOutlined,
  HistoryOutlined,
  DashboardOutlined
} from '@vicons/material'
import { MoreHorizontal20Filled } from '@vicons/fluent'
import PageHeader from '@/components/PageHeader.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import DropdownMenuItem from '@/components/ui/DropdownMenuItem.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { usePrefillInput } from '../../composables/usePrefillInput'
import type { ScheduledTask, ScheduledTaskLog } from '../../types/scheduler'
import TaskEditDialog from './TaskEditDialog.vue'
import TaskLogDrawer from './TaskLogDrawer.vue'

const router = useRouter()
const { setPrefill } = usePrefillInput()
const { toast, confirm } = usePopup()

const activeTab = ref<string>('tasks')

// 任务列表
const tasks = ref<ScheduledTask[]>([])
const loading = ref(false)

// 弹窗状态
const showEditDialog = ref(false)
const isEditMode = ref(false)
const currentTask = ref<ScheduledTask | null>(null)

// 日志抽屉状态
const showLogDrawer = ref(false)
const taskLogs = ref<ScheduledTaskLog[]>([])
const logsLoading = ref(false)

// Cron 预设
const cronPresets = ref<{ label: string; value: string }[]>([])

// 执行历史
const historyLogs = ref<ScheduledTaskLog[]>([])
const historyLoading = ref(false)
const historyCursor = ref<string | null>(null)
const historyHasMore = ref(false)
const taskNameMap = computed(() => {
  const map = new Map<string, string>()
  tasks.value.forEach(t => map.set(t.id, t.name))
  return map
})

function getTaskName(taskId: string): string {
  return taskNameMap.value.get(taskId) || taskId
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function loadHistoryLogs() {
  historyLoading.value = true
  historyCursor.value = null
  historyHasMore.value = false
  try {
    const response = await apiService.fetchAllScheduledTaskLogs(undefined, 30)
    historyLogs.value = response.items || []
    historyCursor.value = response.nextCursor
    historyHasMore.value = response.hasMore
  } catch (err: any) {
    console.error('加载执行历史失败:', err)
    toast.error(err.message || '加载失败')
  } finally {
    historyLoading.value = false
  }
}

async function loadMoreHistoryLogs() {
  if (!historyCursor.value || historyLoading.value) return
  historyLoading.value = true
  try {
    const response = await apiService.fetchAllScheduledTaskLogs(historyCursor.value, 30)
    historyLogs.value.push(...(response.items || []))
    historyCursor.value = response.nextCursor
    historyHasMore.value = response.hasMore
  } catch (err: any) {
    console.error('加载更多失败:', err)
    toast.error(err.message || '加载失败')
  } finally {
    historyLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'history' && historyLogs.value.length === 0) {
    loadHistoryLogs()
  }
})

/**
 * 加载任务列表
 */
async function loadTasks() {
  loading.value = true
  try {
    const response = await apiService.fetchScheduledTasks()
    tasks.value = response.items || []
  } catch (err: any) {
    console.error('加载定时任务失败:', err)
    toast.error(err.message || '加载失败')
  } finally {
    loading.value = false
  }
}

/**
 * 加载 Cron 预设
 */
async function loadCronPresets() {
  try {
    cronPresets.value = await apiService.fetchCronPresets()
  } catch (err: any) {
    console.error('加载 Cron 预设失败:', err)
  }
}

/**
 * 加载任务日志
 */
async function loadTaskLogs(taskId?: string) {
  const id = taskId || currentTask.value?.id
  if (!id) return
  logsLoading.value = true
  try {
    const response = await apiService.fetchScheduledTaskLogs(id)
    taskLogs.value = response.items || []
  } catch (err: any) {
    console.error('加载任务日志失败:', err)
    toast.error(err.message || '加载日志失败')
  } finally {
    logsLoading.value = false
  }
}

/**
 * 刷新列表
 */
function handleRefresh() {
  loadTasks()
}

/**
 * 新建任务
 */
function handleAddTask() {
  isEditMode.value = false
  currentTask.value = null
  showEditDialog.value = true
}

/**
 * 在对话中创建任务 — 跳转到新建会话页面并预填模板文本
 */
function handleCreateInChat() {
  const template = '我想要创建一个自动化任务。\n任务内容是：\n执行时间是：'
  setPrefill(template)
  router.push({ name: 'Chat', params: { sessionId: 'new-session' } })
}

/**
 * 编辑任务
 */
function handleEditTask(task: ScheduledTask) {
  isEditMode.value = true
  currentTask.value = { ...task }
  showEditDialog.value = true
}

/**
 * 卡片 more 菜单
 */
function handleTaskMenu(cmd: string, task: ScheduledTask) {
  if (cmd === 'logs') handleViewLogs(task)
  else if (cmd === 'delete') handleDeleteTask(task)
}

/**
 * 点击历史记录跳转到对应会话
 */
function handleLogClick(log: ScheduledTaskLog) {
  if (log.sessionId) {
    router.replace({ name: 'Chat', params: { sessionId: log.sessionId } })
  }
}

/**
 * 保存任务
 */
async function handleSaveTask(data: any) {
  try {
    if (isEditMode.value && currentTask.value) {
      await apiService.updateScheduledTask(currentTask.value.id, data)
      toast.success('更新成功')
    } else {
      await apiService.createScheduledTask(data)
      toast.success('创建成功')
    }
    showEditDialog.value = false
    await loadTasks()
  } catch (err: any) {
    console.error('保存任务失败:', err)
    toast.error(err.message || '保存失败')
  }
}

/**
 * 删除任务
 */
async function handleDeleteTask(task: ScheduledTask) {
  try {
    const confirmed = await confirm('删除任务', `确定要删除任务 "${task.name}" 吗？此操作不可恢复。`)
    if (!confirmed) return

    await apiService.deleteScheduledTask(task.id)
    tasks.value = tasks.value.filter(t => t.id !== task.id)
    toast.success('删除成功')
  } catch (err: any) {
    if (err !== 'cancelled') {
      console.error('删除任务失败:', err)
      toast.error(err.message || '删除失败')
    }
  }
}

/**
 * 切换任务启用状态
 */
async function handleToggleTask(task: ScheduledTask) {
  try {
    await apiService.toggleScheduledTask(task.id)
    toast.success(task.enabled ? '已启用' : '已禁用')
  } catch (err: any) {
    console.error('切换状态失败:', err)
    toast.error(err.message || '切换失败')
    // 恢复原状态
    task.enabled = !task.enabled
  }
}

/**
 * 查看日志
 */
function handleViewLogs(task: ScheduledTask) {
  currentTask.value = task
  showLogDrawer.value = true
  loadTaskLogs(task.id)
}

/**
 * 判断任务是否有限制执行次数
 */
function isTaskLimited(task: ScheduledTask): boolean {
  return task.maxExecutions !== null && task.maxExecutions !== undefined && task.maxExecutions > 0
}

/**
 * 获取剩余执行次数
 */
function getRemainingCount(task: ScheduledTask): number {
  const count = task.executionCount || 0
  const max = task.maxExecutions || 0
  return Math.max(0, max - count)
}

/**
 * 格式化 Cron 表达式为可读文本
 */
function formatCron(cron: string): string {
  const preset = cronPresets.value.find(p => p.value === cron)
  return preset ? preset.label : cron
}

/**
 * 格式化目标模式
 */
function formatTargetMode(mode: string): string {
  return mode === 'new_session' ? '新建会话' : '已有会话'
}

/**
 * 格式化日期时间
 */
function formatDateTime(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onMounted(() => {
  loadTasks()
  loadCronPresets()
})
</script>

<style scoped>
.session-action-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.session-action-trigger:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.dark .session-action-trigger:hover {
  background-color: #383a40;
}

.scheduler-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.scheduler-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.scheduler-tabs :deep(.el-tabs__item) {
  padding: 0 18px;
  height: 44px;
  line-height: 44px;
  font-size: 14px;
}
</style>
