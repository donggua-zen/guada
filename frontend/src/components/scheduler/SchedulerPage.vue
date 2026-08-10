<template>
  <div class="h-full overflow-hidden flex flex-col">
    <PageHeader />
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Tab 头部（固定不滚动） -->
      <div class="shrink-0 px-4 w-full md:max-w-260 md:mx-auto">
        <el-tabs v-model="activeTab" class="scheduler-tabs">
          <el-tab-pane :label="t('scheduler.page.tabConfigured')" name="tasks">
            <template #label>
              <div class="flex items-center gap-1.5">
                <span>{{ t('scheduler.page.tabConfigured') }}</span>
                <span v-if="tasks.length > 0" class="text-xs text-gray-400 dark:text-[#6b6d75]">{{ tasks.length }}</span>
              </div>
            </template>
          </el-tab-pane>
          <el-tab-pane :label="t('scheduler.page.tabHistory')" name="history" />
          <el-tab-pane :label="t('scheduler.page.tabTemplates')" name="templates" />
        </el-tabs>
      </div>

      <!-- 内容区（独立滚动） -->
      <div class="flex-1 overflow-auto pb-4" style="scrollbar-gutter: stable both-edges;">
        <div class="py-3 px-4 w-full md:max-w-260 md:mx-auto">
          <!-- 已配置：任务卡片 -->
          <template v-if="activeTab === 'tasks'">
            <!-- 标题区 -->
            <div class="flex items-center justify-between gap-4 mb-8 mt-2">
              <div class="min-w-0">
                <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('scheduler.page.title') }}</h1>
                <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('scheduler.page.subtitle') }}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <el-button @click="handleAddTask">
                  <template #icon><AddOutlined /></template>
                  {{ t('scheduler.page.createManual') }}
                </el-button>
                <el-button type="primary" @click="handleCreateInChat">
                  <template #icon><ChatBubbleOutlineOutlined /></template>
                  {{ t('scheduler.page.createInChat') }}
                </el-button>
              </div>
            </div>

            <!-- 任务卡片网格 -->
            <div v-if="tasks.length > 0" class="grid gap-y-4 gap-x-3" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
              <div v-for="task in tasks" :key="task.id"
                class="task-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
                @click="handleEditTask(task)">
                <!-- Header: name + tag -->
                <div class="flex items-center gap-2.5 mb-3">
                  <CardAvatar :name="task.name" />
                  <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);">
                    {{ task.name }}
                  </h3>
                  <el-tag v-if="isTaskLimited(task)" size="small" effect="plain">{{ t('scheduler.page.remainingCount', { count: getRemainingCount(task) }) }}</el-tag>
                </div>

                <!-- Description: prompt -->
                <div class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
                  {{ task.prompt }}
                </div>

                <!-- Footer: metadata + actions + switch -->
                <div class="flex items-center justify-between gap-2 mt-3">
                  <div class="flex items-center gap-3 text-xs text-gray-400 dark:text-[#6b6d75] min-w-0">
                    <span class="flex items-center gap-1 shrink-0">
                      <el-icon :size="13"><CalendarTodayOutlined /></el-icon>
                      {{ formatTargetMode(task.targetMode) }}
                    </span>
                    <span v-if="task.executionCount !== undefined" class="shrink-0">
                      {{ t('scheduler.page.executionCount', { count: task.executionCount }) }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <el-button link size="small" @click.stop="handleViewLogs(task)">{{ t('scheduler.page.logs') }}</el-button>
                    <el-button link size="small" type="danger" @click.stop="handleDeleteTask(task)">{{ t('scheduler.page.delete') }}</el-button>
                    <el-switch v-model="task.enabled" :active-value="true" :inactive-value="false"
                      @change="handleToggleTask(task)" @click.stop size="small" inline-prompt
                      :active-text="t('scheduler.page.enable')" :inactive-text="t('scheduler.page.disable')" />
                  </div>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) p-12 text-center">
              <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#2a2c30] flex items-center justify-center mx-auto mb-4">
                <el-icon :size="28" class="text-gray-400 dark:text-[#6b6d75]">
                  <ScheduleOutlined />
                </el-icon>
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('scheduler.page.empty') }}</p>
              <el-button type="primary" class="mt-4" @click="handleCreateInChat">
                {{ t('scheduler.page.createFromTemplate') }}
                <template #icon><ArrowForwardOutlined /></template>
              </el-button>
            </div>
          </template>

          <!-- 执行历史 -->
          <template v-else-if="activeTab === 'history'">
            <div class="flex items-center justify-between gap-4 mb-8 mt-2">
              <div class="min-w-0">
                <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('scheduler.page.historyTitle') }}</h1>
                <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('scheduler.page.historySubtitle') }}</p>
              </div>
              <el-button size="small" @click="loadHistoryLogs" :loading="historyLoading">
                <template #icon><RefreshOutlined /></template>
                {{ t('scheduler.page.refresh') }}
              </el-button>
            </div>

            <div v-if="historyLogs.length > 0" class="relative">
              <div class="absolute left-[5px] top-3 bottom-3 w-0.5 bg-gray-200 dark:bg-[#2e3035] rounded-full z-10"></div>
              <div v-for="log in historyLogs" :key="log.id"
                class="relative flex gap-3 pb-5 last:pb-0 cursor-pointer rounded-md hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors -mx-2 px-2 py-1.5"
                @click="handleLogClick(log)">
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
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900 dark:text-[#e8e9ed] truncate">{{ getTaskName(log.taskId) }}</span>
                    <span v-if="log.status === 'running'"
                      class="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">{{ t('scheduler.page.running') }}</span>
                    <span v-else-if="log.status === 'failed'"
                      class="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">{{ t('scheduler.page.failed') }}</span>
                    <span v-else-if="log.status === 'pending'"
                      class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#2a2c30] text-gray-500 dark:text-[#8b8d95]">{{ t('scheduler.page.pending') }}</span>
                  </div>
                  <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-1.5">
                    {{ formatTime(log.startedAt) }}
                  </div>
                  <div v-if="log.error" class="text-xs text-red-500 mt-1.5 line-clamp-2">{{ log.error }}</div>
                </div>
              </div>
              <div v-if="historyHasMore" class="flex justify-center mt-2">
                <el-button @click="loadMoreHistoryLogs" :loading="historyLoading" text>
                  {{ t('scheduler.page.loadMore') }}
                </el-button>
              </div>
            </div>
            <div v-else-if="!historyLoading" class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) p-12 text-center">
              <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#2a2c30] flex items-center justify-center mx-auto mb-4">
                <el-icon :size="28" class="text-gray-400 dark:text-[#6b6d75]">
                  <HistoryOutlined />
                </el-icon>
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('scheduler.page.historyEmpty') }}</p>
            </div>
          </template>

          <!-- 任务模板 -->
          <template v-else-if="activeTab === 'templates'">
            <div class="flex items-center justify-between gap-4 mb-8 mt-2">
              <div class="min-w-0">
                <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('scheduler.page.templatesTitle') }}</h1>
                <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('scheduler.page.templatesSubtitle') }}</p>
              </div>
            </div>
            <div class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) p-12 text-center">
              <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#2a2c30] flex items-center justify-center mx-auto mb-4">
                <el-icon :size="28" class="text-gray-400 dark:text-[#6b6d75]">
                  <DashboardOutlined />
                </el-icon>
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('scheduler.page.templatesInProgress') }}</p>
            </div>
          </template>
        </div>
      </div>
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
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ElButton, ElTag, ElSwitch, ElIcon, ElTabs, ElTabPane } from 'element-plus'
import {
  AddOutlined,
  RefreshOutlined,
  ScheduleOutlined,
  CalendarTodayOutlined,
  ChatBubbleOutlineOutlined,
  ArrowForwardOutlined,
  HistoryOutlined,
  DashboardOutlined
} from '@vicons/material'
import PageHeader from '@/components/PageHeader.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { usePrefillInput } from '../../composables/usePrefillInput'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import type { ScheduledTask, ScheduledTaskLog } from '../../types/scheduler'
import TaskEditDialog from './TaskEditDialog.vue'
import TaskLogDrawer from './TaskLogDrawer.vue'

const router = useRouter()
const { t } = useI18n()
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
    toast.error(err.message || t('scheduler.page.loadFailed'))
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
    toast.error(err.message || t('scheduler.page.loadFailed'))
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
    toast.error(err.message || t('scheduler.page.loadFailed'))
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
    toast.error(err.message || t('scheduler.page.loadLogsFailed'))
  } finally {
    logsLoading.value = false
  }
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
  const template = t('scheduler.page.chatTemplate')
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
      toast.success(t('common.updateSuccess'))
    } else {
      await apiService.createScheduledTask(data)
      toast.success(t('common.createSuccess'))
    }
    showEditDialog.value = false
    await loadTasks()
  } catch (err: any) {
    console.error('保存任务失败:', err)
    toast.error(err.message || t('scheduler.page.saveFailed'))
  }
}

/**
 * 删除任务
 */
async function handleDeleteTask(task: ScheduledTask) {
  try {
    const confirmed = await confirm(t('scheduler.page.deleteTitle'), t('scheduler.page.deleteConfirm', { name: task.name }))
    if (!confirmed) return

    await apiService.deleteScheduledTask(task.id)
    tasks.value = tasks.value.filter(t => t.id !== task.id)
    toast.success(t('common.deleteSuccess'))
  } catch (err: any) {
    if (err !== 'cancelled') {
      console.error('删除任务失败:', err)
      toast.error(err.message || t('common.deleteFailed'))
    }
  }
}

/**
 * 切换任务启用状态
 */
async function handleToggleTask(task: ScheduledTask) {
  try {
    await apiService.toggleScheduledTask(task.id)
    toast.success(task.enabled ? t('common.enabled') : t('common.disabled'))
  } catch (err: any) {
    console.error('切换状态失败:', err)
    toast.error(err.message || t('scheduler.page.toggleFailed'))
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
 * 格式化目标模式
 */
function formatTargetMode(mode: string): string {
  return mode === 'new_session' ? t('scheduler.page.targetNewSession') : t('scheduler.page.targetExistingSession')
}

onMounted(() => {
  loadTasks()
  loadCronPresets()
})
</script>

<style scoped>
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
