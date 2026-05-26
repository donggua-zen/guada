<template>
  <div class="bg-(--color-sidebar-bg) h-full overflow-auto mx-2">
    <div class="h-full flex flex-col md:max-w-260 md:mx-auto p-4">
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- 头部区域 -->
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
          <span>定时任务</span>
          <el-space>
            <el-button type="primary" @click="handleAddTask">
              <template #icon>
                <AddOutlined />
              </template>
              新建任务
            </el-button>
            <el-button @click="handleRefresh" :loading="loading">
              <template #icon>
                <RefreshOutlined />
              </template>
              刷新
            </el-button>
          </el-space>
        </div>

        <!-- 任务列表 -->
        <div class="rounded-lg border border-gray-200 dark:border-[#232428] bg-white dark:bg-[#232428] overflow-hidden">
          <ul v-if="tasks.length > 0">
            <li v-for="task in tasks" :key="task.id"
              class="flex items-center py-4 px-4 border-b border-gray-200 dark:border-[#2e3035] last:border-b-0 hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors">
              <div class="flex-1 min-w-0 mr-4">
                <div class="flex items-center gap-2 mb-1">
                  <div class="font-semibold text-base truncate">{{ task.name }}</div>
                  <el-tag v-if="task.enabled" type="success" size="small">已启用</el-tag>
                  <el-tag v-else type="info" size="small">已禁用</el-tag>
                  <el-tag v-if="isTaskLimited(task)" type="warning" size="small" effect="plain">
                    剩余 {{ getRemainingCount(task) }} 次
                  </el-tag>
                </div>
                <div class="text-sm text-gray-500 dark:text-[#8b8d95] truncate max-w-md">
                  {{ task.prompt }}
                </div>
                <div class="flex items-center gap-3 text-xs text-gray-400 dark:text-[#6b6d75] mt-1.5">
                  <span class="flex items-center gap-1">
                    <el-icon :size="12">
                      <ScheduleOutlined />
                    </el-icon>
                    {{ formatCron(task.cronExpression) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <el-icon :size="12">
                      <CalendarTodayOutlined />
                    </el-icon>
                    {{ formatTargetMode(task.targetMode) }}
                  </span>
                  <span v-if="task.executionCount !== undefined && task.maxExecutions" class="flex items-center gap-1">
                    <el-icon :size="12">
                      <ScheduleOutlined />
                    </el-icon>
                    已执行 {{ task.executionCount }} / {{ task.maxExecutions }} 次
                  </span>
                  <span v-else-if="task.executionCount !== undefined" class="flex items-center gap-1">
                    <el-icon :size="12">
                      <ScheduleOutlined />
                    </el-icon>
                    已执行 {{ task.executionCount }} 次
                  </span>
                  <span v-if="task.nextRunAt" class="flex items-center gap-1">
                    <el-icon :size="12">
                      <CalendarTodayOutlined />
                    </el-icon>
                    下次: {{ formatDateTime(task.nextRunAt) }}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <el-button link size="small" @click="handleViewLogs(task)">
                  <template #icon>
                    <DescriptionOutlined />
                  </template>
                  日志
                </el-button>
                <el-switch v-model="task.enabled" :active-value="true" :inactive-value="false"
                  @change="handleToggleTask(task)" inline-prompt active-text="启用" inactive-text="禁用"
                  size="small" />
                <el-button link style="font-size: 18px; color: var(--el-text-color-secondary)"
                  @click="handleEditTask(task)">
                  <el-icon>
                    <SettingsOutlined />
                  </el-icon>
                </el-button>
                <el-button type="danger" link style="font-size: 18px" @click="handleDeleteTask(task)">
                  <el-icon>
                    <RemoveCircleOutlineRound />
                  </el-icon>
                </el-button>
              </div>
            </li>
          </ul>

          <!-- 空状态 -->
          <div v-else class="py-12 text-center text-gray-400">
            <el-icon size="48" class="mb-3 opacity-50">
              <InboxOutlined />
            </el-icon>
            <div>暂无定时任务</div>
            <div class="text-sm mt-2">点击"新建任务"开始创建</div>
          </div>
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
import { ref, onMounted } from 'vue'
import { ElButton, ElSpace, ElTag, ElSwitch, ElIcon } from 'element-plus'
import {
  AddOutlined,
  RefreshOutlined,
  SettingsOutlined,
  RemoveCircleOutlineRound,
  InboxOutlined,
  ScheduleOutlined,
  CalendarTodayOutlined,
  DescriptionOutlined
} from '@vicons/material'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import type { ScheduledTask, ScheduledTaskLog } from '../../types/scheduler'
import TaskEditDialog from './TaskEditDialog.vue'
import TaskLogDrawer from './TaskLogDrawer.vue'

const { toast, confirm } = usePopup()

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
 * 编辑任务
 */
function handleEditTask(task: ScheduledTask) {
  isEditMode.value = true
  currentTask.value = { ...task }
  showEditDialog.value = true
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
