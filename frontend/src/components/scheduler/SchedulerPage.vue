<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader />

    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- 标题 + 操作 -->
      <div class="shrink-0 px-4 w-full md:max-w-260 md:mx-auto">
        <div class="flex items-start justify-between gap-4 pt-4 pb-3">
          <div class="min-w-0">
            <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('scheduler.page.title') }}</h1>
            <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('scheduler.page.subtitle') }}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <GdButton text :loading="loading" :aria-label="t('scheduler.page.refresh')" @click="loadTasks">
              <template #icon><ArrowClockwise16Regular /></template>
            </GdButton>
            <div class="split-create">
              <GdButton type="primary" @click="openCreate">
                <template #icon><Add16Regular /></template>
                {{ t('scheduler.page.createManual') }}
              </GdButton>
              <DropdownMenu class="split-menu" @command="handleCreateCommand">
                <button type="button" class="split-arrow" :aria-label="t('scheduler.page.moreCreate')">
                  <ChevronDown16Regular class="w-3.5 h-3.5"  />
                </button>
                <template #dropdown>
                  <DropdownMenuItem command="chat">
                    <Chat20Regular class="w-4 h-4 mr-2 inline-block" />
                    {{ t('scheduler.page.createInChat') }}
                  </DropdownMenuItem>
                </template>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <!-- 胶囊 Tab -->
        <div class="page-tabs">
          <button type="button" class="page-tab" :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">
            {{ t('scheduler.page.tabTasks') }}
            <span v-if="tasks.length > 0" class="tab-count">{{ tasks.length }}</span>
          </button>
          <button type="button" class="page-tab" :class="{ active: activeTab === 'templates' }" @click="activeTab = 'templates'">
            {{ t('scheduler.page.tabTemplates') }}
          </button>
          <button type="button" class="page-tab" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">
            {{ t('scheduler.page.tabHistory') }}
          </button>
        </div>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-auto pb-6" style="scrollbar-gutter: stable both-edges;">
        <div class="px-4 w-full md:max-w-260 md:mx-auto">
          <!-- 任务列表 -->
          <template v-if="activeTab === 'tasks'">
            <div v-if="tasks.length > 0" class="task-grid">
              <div v-for="task in tasks" :key="task.id" class="task-card" @click="openEdit(task)">
                <div class="card-head">
                  <span class="card-dot" :class="{ paused: !task.enabled }"></span>
                  <h3 class="card-title">{{ task.name || t('scheduler.edit.untitled') }}</h3>
                  <span class="card-status" :class="{ paused: !task.enabled }">
                    {{ task.enabled ? t('scheduler.page.statusEnabled') : t('scheduler.page.statusPaused') }}
                  </span>
                  <div class="card-menu" @click.stop>
                    <DropdownMenu @command="handleCardCommand($event, task)">
                      <button type="button" class="card-menu-btn" :aria-label="t('scheduler.page.moreActions')">
                        <MoreHorizontal20Filled class="w-4 h-4"  />
                      </button>
                      <template #dropdown>
                        <DropdownMenuItem command="run">
                          <Play20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('scheduler.page.runNow') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem command="logs">
                          <DocumentText20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('scheduler.page.logs') }}
                        </DropdownMenuItem>
                        <div class="my-1 h-px bg-(--gd-color-surface-border)"></div>
                        <DropdownMenuItem command="delete">
                          <Delete20Regular class="w-4 h-4 mr-2 inline-block" />
                          {{ t('scheduler.page.delete') }}
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenu>
                  </div>
                </div>

                <p class="card-prompt">{{ task.prompt }}</p>

                <div class="card-foot">
                  <div class="card-meta">
                    <span class="card-schedule">{{ describe(task) }}</span>
                    <span v-if="nextRun(task)" class="card-next">{{ nextRun(task) }}</span>
                    <span v-if="task.executionCount !== undefined" class="card-count">
                      {{ t('scheduler.page.executionCount', { count: task.executionCount }) }}
                    </span>
                  </div>
                  <div class="card-actions" @click.stop>
                    <GdSwitch v-model="task.enabled" :active-value="true" :inactive-value="false"
                      size="small" @change="handleToggleTask(task)" />
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="loading" class="empty-block">
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('common.loading') }}</p>
            </div>

            <div v-else class="empty-block">
              <div class="empty-icon">
                <CalendarAgenda24Regular class="w-7 h-7"  />
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('scheduler.page.empty') }}</p>
              <p class="text-xs text-gray-400 dark:text-[#6b6d75] mt-1">{{ t('scheduler.page.emptyHint') }}</p>
              <div class="flex items-center gap-2 mt-4">
                <GdButton type="primary" @click="openCreate">
                  <template #icon><Add16Regular /></template>
                  {{ t('scheduler.page.createManual') }}
                </GdButton>
                <GdButton @click="handleCreateInChat">{{ t('scheduler.page.createInChat') }}</GdButton>
              </div>
            </div>
          </template>

          <!-- 执行历史 -->
          <template v-else-if="activeTab === 'history'">
            <div class="flex items-center justify-end mb-4 mt-2">
              <GdButton size="small" :loading="historyLoading" @click="loadHistoryLogs">
                <template #icon><ArrowClockwise16Regular /></template>
                {{ t('scheduler.page.refresh') }}
              </GdButton>
            </div>

            <div v-if="historyLogs.length > 0" class="relative">
              <div class="history-rail"></div>
              <div v-for="log in historyLogs" :key="log.id" class="history-row" @click="handleLogClick(log)">
                <div class="relative z-10 shrink-0 w-3 h-3 mt-1 flex items-center justify-center">
                  <div v-if="log.status === 'completed'" class="history-dot bg-green-500">
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </div>
                  <div v-else-if="log.status === 'failed'" class="history-dot bg-red-500">
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </div>
                  <div v-else-if="log.status === 'missed'" class="history-dot bg-amber-500">
                    <svg class="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2.5V6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      <path d="M6 8.6V9.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </div>
                  <div v-else class="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-[#4a4c52] bg-(--gd-color-surface)"></div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900 dark:text-[#e8e9ed] truncate">{{ getTaskName(log.taskId) }}</span>
                    <span v-if="log.status === 'running'" class="history-status running">{{ t('scheduler.page.running') }}</span>
                    <span v-else-if="log.status === 'failed'" class="history-status failed">{{ t('scheduler.page.failed') }}</span>
                    <span v-else-if="log.status === 'missed'" class="history-status missed">{{ t('scheduler.page.missed') }}</span>
                    <span v-else-if="log.status === 'pending'" class="history-status pending">{{ t('scheduler.page.pending') }}</span>
                  </div>
                  <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-1.5">{{ formatTime(log.startedAt) }}</div>
                  <div v-if="log.error" class="text-xs text-red-500 mt-1.5 line-clamp-2">{{ log.error }}</div>
                  <div v-else-if="log.reason" class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1.5 line-clamp-2">{{ log.reason }}</div>
                </div>
              </div>
              <div v-if="historyHasMore" class="flex justify-center mt-2">
                <GdButton text :loading="historyLoading" @click="loadMoreHistoryLogs">
                  {{ t('scheduler.page.loadMore') }}
                </GdButton>
              </div>
            </div>
            <div v-else-if="!historyLoading" class="empty-block">
              <div class="empty-icon">
                <History20Regular class="w-7 h-7"  />
              </div>
              <p class="text-sm text-gray-500 dark:text-[#8b8d95]">{{ t('scheduler.page.historyEmpty') }}</p>
            </div>
          </template>

          <!-- 任务模板 -->
          <template v-else>
            <p class="template-hint">{{ t('scheduler.templates.hint') }}</p>
            <div class="template-grid">
              <button v-for="template in templates" :key="template.id" type="button" class="template-card"
                @click="openTemplate(template)">
                <div class="template-head">
                  <span class="template-avatar">{{ t(template.titleKey).slice(0, 1) }}</span>
                  <span class="template-title">{{ t(template.titleKey) }}</span>
                </div>
                <p class="template-desc">{{ t(template.descriptionKey) }}</p>
                <div class="template-foot">{{ templateScheduleLabel(template) }}</div>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑统一弹窗：同一套表单，避免两种交互 -->
    <GdDialog v-model="showTaskDialog" :title="dialogTitle" :width="570" align-center destroy-on-close
      class="scheduler-task-dialog">
      <SchedulerTaskEditView :key="editingTask?.id || 'new'" ref="taskDialogRef" :task="editingTask" in-dialog
        @saved="handleSaved" @deleted="handleDeleted" @back="closeTaskDialog" />
      <template #footer>
        <div class="flex items-center justify-between gap-3 w-full">
          <div class="flex items-center gap-1">
            <GdButton v-if="editingTask?.id" text :loading="taskDialogRef?.testing" @click="taskDialogRef?.test()">
              {{ t('scheduler.edit.test') }}
            </GdButton>
            <GdButton v-if="editingTask?.id" text type="danger" @click="taskDialogRef?.remove()">
              {{ t('scheduler.edit.delete') }}
            </GdButton>
          </div>
          <div class="flex items-center gap-2">
            <GdButton @click="closeTaskDialog">{{ t('common.cancel') }}</GdButton>
            <GdButton v-if="editingTask?.id" :loading="taskDialogRef?.running" @click="taskDialogRef?.runNow()">
              {{ t('scheduler.edit.runNow') }}
            </GdButton>
            <GdButton type="primary" :loading="taskDialogRef?.saving" @click="taskDialogRef?.save()">
              {{ t('scheduler.edit.save') }}
            </GdButton>
          </div>
        </div>
      </template>
    </GdDialog>

    <!-- 执行日志抽屉 -->
    <TaskLogDrawer v-model="showLogDrawer" :task="currentTask" :logs="taskLogs" :loading="logsLoading"
      @refresh="() => loadTaskLogs()" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NEW_SESSION_ID } from '@/constants'

import GdButton from '@/components/ui/GdButton.vue'
import GdSwitch from '@/components/ui/GdSwitch.vue';
import GdDialog from '@/components/ui/GdDialog.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import DropdownMenuItem from '@/components/ui/DropdownMenuItem.vue'
import {
  ChevronDown16Regular,
  MoreHorizontal20Filled,
  Add16Regular,
  ArrowClockwise16Regular,
  CalendarAgenda24Regular,
  History20Regular,
  Chat20Regular,
  Play20Regular,
  DocumentText20Regular,
  Delete20Regular,
} from '@vicons/fluent'
import PageHeader from '@/components/PageHeader.vue'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { toast } from '@/components/ui/toastService';
import { usePrefillInput } from '@/composables/usePrefillInput'
import type { ScheduledTask, ScheduledTaskLog } from '@/types/scheduler'
import TaskLogDrawer from './TaskLogDrawer.vue'
import SchedulerTaskEditView from './SchedulerTaskEditView.vue'
import { buildSchedule, describeSchedule, formatTaskNextRun } from './schedule'
import { TASK_TEMPLATES, type TaskTemplate } from './templates'

const router = useRouter()
const { t, locale } = useI18n()
const { setPrefill } = usePrefillInput()
const { confirm } = usePopup()

const activeTab = ref<'tasks' | 'templates' | 'history'>('tasks')
const templates = TASK_TEMPLATES

const tasks = ref<ScheduledTask[]>([])
const loading = ref(false)

const editingTask = ref<ScheduledTask | null>(null)
const showTaskDialog = ref(false)
const taskDialogRef = ref<InstanceType<typeof SchedulerTaskEditView> | null>(null)
const dialogTitle = computed(() =>
  editingTask.value?.id ? t('scheduler.edit.editTitle') : t('scheduler.edit.createTitle'),
)

const showLogDrawer = ref(false)
const taskLogs = ref<ScheduledTaskLog[]>([])
const logsLoading = ref(false)
/** 日志抽屉当前绑定的任务（列表态与编辑态共用） */
const currentTask = ref<ScheduledTask | null>(null)

const historyLogs = ref<ScheduledTaskLog[]>([])
const historyLoading = ref(false)
const historyCursor = ref<string | null>(null)
const historyHasMore = ref(false)

const taskNameMap = computed(() => {
  const map = new Map<string, string>()
  tasks.value.forEach((task) => map.set(task.id, task.name))
  return map
})

/** schedule.ts 的 t 签名比 vue-i18n 更窄，这里做一层适配 */
const tr = (key: string, named?: Record<string, string | number>) =>
  named ? t(key, named) : t(key)

function describe(task: ScheduledTask): string {
  return describeSchedule(task, tr, locale.value)
}

function nextRun(task: ScheduledTask): string | null {
  const label = formatTaskNextRun(task, tr, locale.value)
  return label ? t('scheduler.page.nextRun', { time: label }) : null
}

function getTaskName(taskId: string): string {
  return taskNameMap.value.get(taskId) || taskId
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

async function loadTasks() {
  loading.value = true
  try {
    const response = await apiService.fetchScheduledTasks()
    tasks.value = response.items || []
  } catch (error) {
    console.error('加载定时任务失败:', error)
    toast.error((error as Error)?.message || t('scheduler.page.loadFailed'))
  } finally {
    loading.value = false
  }
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
  } catch (error) {
    console.error('加载执行历史失败:', error)
    toast.error((error as Error)?.message || t('scheduler.page.loadFailed'))
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
  } catch (error) {
    console.error('加载更多失败:', error)
    toast.error((error as Error)?.message || t('scheduler.page.loadFailed'))
  } finally {
    historyLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'history' && historyLogs.value.length === 0) void loadHistoryLogs()
})

async function loadTaskLogs(taskId?: string) {
  const id = taskId || currentTask.value?.id
  if (!id) return
  logsLoading.value = true
  try {
    const response = await apiService.fetchScheduledTaskLogs(id)
    taskLogs.value = response.items || []
  } catch (error) {
    console.error('加载任务日志失败:', error)
    toast.error((error as Error)?.message || t('scheduler.page.loadLogsFailed'))
  } finally {
    logsLoading.value = false
  }
}

function openCreate() {
  editingTask.value = null
  showTaskDialog.value = true
}

function openEdit(task: ScheduledTask) {
  editingTask.value = { ...task }
  showTaskDialog.value = true
}

/** 模板卡片底部的调度摘要 */
function templateScheduleLabel(template: TaskTemplate): string {
  return describeSchedule(buildSchedule(template.schedule), tr, locale.value)
}

/** 点击模板：用无 id 的草稿任务预填新建弹窗（仍按新建处理） */
function openTemplate(template: TaskTemplate) {
  const value = buildSchedule(template.schedule)
  editingTask.value = {
    id: '',
    name: t(template.titleKey),
    prompt: t(template.promptKey),
    scheduleType: value.scheduleType,
    cronExpression: value.cronExpression,
    executeAt: value.executeAt ?? null,
    targetMode: 'new_session',
    outputMode: 'independent',
    enabled: true,
    unattended: true,
    maxRetries: 3,
    retryInterval: 60,
    createdAt: '',
    updatedAt: '',
  }
  showTaskDialog.value = true
}

function closeTaskDialog() {
  showTaskDialog.value = false
}

async function handleSaved() {
  await loadTasks()
}

function handleDeleted(taskId: string) {
  tasks.value = tasks.value.filter((task) => task.id !== taskId)
}

function handleCreateCommand(command: string) {
  if (command === 'chat') handleCreateInChat()
}

/**
 * 在对话中创建任务：跳到新建会话页并预填模板
 */
function handleCreateInChat() {
  setPrefill(t('scheduler.page.chatTemplate'))
  router.push({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
}

function handleLogClick(log: ScheduledTaskLog) {
  if (log.sessionId) {
    router.replace({ name: 'Chat', params: { sessionId: log.sessionId } })
  }
}

async function handleDeleteTask(task: ScheduledTask) {
  try {
    const confirmed = await confirm(
      t('scheduler.page.deleteTitle'),
      t('scheduler.page.deleteConfirm', { name: task.name }),
    )
    if (!confirmed) return

    await apiService.deleteScheduledTask(task.id)
    tasks.value = tasks.value.filter((item) => item.id !== task.id)
    toast.success(t('common.deleteSuccess'))
  } catch (error) {
    if (error !== 'cancelled') {
      console.error('删除任务失败:', error)
      toast.error((error as Error)?.message || t('common.deleteFailed'))
    }
  }
}

async function handleToggleTask(task: ScheduledTask) {
  try {
    await apiService.toggleScheduledTask(task.id)
    toast.success(task.enabled ? t('common.enabled') : t('common.disabled'))
  } catch (error) {
    console.error('切换状态失败:', error)
    toast.error((error as Error)?.message || t('scheduler.page.toggleFailed'))
    task.enabled = !task.enabled
  }
}

function handleViewLogs(task: ScheduledTask) {
  currentTask.value = task
  showLogDrawer.value = true
  void loadTaskLogs(task.id)
}

async function handleRunNow(task: ScheduledTask) {
  try {
    await apiService.runScheduledTask(task.id)
    toast.success(t('scheduler.page.runNowSuccess'))
    // 触发后台回合，稍后刷新以更新执行次数
    setTimeout(() => void loadTasks(), 800)
  } catch (error) {
    console.error('立即执行失败:', error)
    toast.error((error as Error)?.message || t('scheduler.page.runNowFailed'))
  }
}

function handleCardCommand(command: string, task: ScheduledTask) {
  if (command === 'run') void handleRunNow(task)
  else if (command === 'logs') handleViewLogs(task)
  else if (command === 'delete') void handleDeleteTask(task)
}

onMounted(() => {
  void loadTasks()
})
</script>

<style scoped>
.split-create {
  display: inline-flex;
  align-items: stretch;
}

.split-create :deep(.gd-button) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.split-menu {
  display: flex;
}

.split-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 32px;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 0 8px 8px 0;
  background: var(--gd-color-primary);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
}

.split-arrow:hover {
  background: var(--gd-color-primary-800);
}

.page-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0 10px;
}

.page-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--gd-color-text-gray);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.page-tab:hover {
  background: var(--gd-color-field-bg);
  color: var(--gd-color-text);
}

.page-tab.active {
  background: var(--gd-color-field-bg);
  color: var(--gd-color-text);
}

.tab-count {
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}

/* 任务模板 */
.template-hint {
  margin: 4px 0 12px;
  font-size: 12px;
  color: var(--gd-color-text-gray);
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 860px) {
  .template-grid {
    grid-template-columns: 1fr;
  }
}

.template-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 114px;
  padding: 12px;
  border: 1px solid var(--gd-color-surface-border);
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.template-card:hover {
  background: var(--gd-color-surface-hover);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.template-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.template-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--gd-color-field-bg);
  color: var(--gd-color-primary);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.template-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--gd-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--gd-color-text-gray);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-foot {
  margin-top: auto;
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-top: 4px;
}

@media (max-width: 860px) {
  .task-grid {
    grid-template-columns: 1fr;
  }
}

.task-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 132px;
  padding: 12px;
  border: 1px solid var(--gd-color-surface-border);
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface);
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.task-card:hover {
  background: var(--gd-color-surface-hover);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.card-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gd-color-success);
  flex-shrink: 0;
}

.card-dot.paused {
  background: var(--gd-color-text-disabled);
}

.card-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--gd-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-status {
  font-size: 11px;
  color: var(--gd-color-success);
  flex-shrink: 0;
}

.card-status.paused {
  color: var(--gd-color-text-disabled);
}

.card-menu {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.task-card:hover .card-menu {
  opacity: 1;
}

.card-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
}

.card-menu-btn:hover {
  background: var(--gd-color-field-bg-hover);
}

.card-prompt {
  margin: 0;
  min-height: 40px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--gd-color-text-gray);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  color: var(--gd-color-text-disabled);
}

.card-schedule {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-next,
.card-count {
  flex-shrink: 0;
}

.card-actions {
  flex-shrink: 0;
}

.empty-block {
  margin-top: 24px;
  padding: 48px 24px;
  border: 1px solid var(--gd-color-surface-border);
  border-radius: var(--gd-size-surface-radius);
  background: var(--gd-color-surface);
  text-align: center;
}

.empty-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gd-color-field-bg);
  color: var(--gd-color-text-disabled);
}

.history-rail {
  position: absolute;
  left: 5px;
  top: 12px;
  bottom: 12px;
  width: 2px;
  border-radius: 999px;
  background: var(--gd-color-border);
  z-index: 0;
}

.history-row {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 6px 8px;
  margin: 0 -8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.history-row:last-child {
  margin-bottom: 0;
}

.history-row:hover {
  background: var(--gd-color-field-bg);
}

.history-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-status {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.history-status.running {
  background: var(--gd-color-primary-100);
  color: var(--gd-color-primary);
}

.history-status.failed {
  background: var(--gd-color-danger-0f, rgba(245, 108, 108, 0.1));
  color: var(--gd-color-danger);
}

.history-status.missed {
  background: var(--gd-color-warning-0f, rgba(230, 162, 60, 0.1));
  color: var(--gd-color-warning);
}

.history-status.pending {
  background: var(--gd-color-field-bg);
  color: var(--gd-color-text-gray);
}
</style>
