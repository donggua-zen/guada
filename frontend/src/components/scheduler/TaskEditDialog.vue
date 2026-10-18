<template>
  <GdDialog v-model="dialogVisible" :title="isEdit ? t('scheduler.edit.editTitle') : t('scheduler.edit.createTitle')"
    size="xl" align-center destroy-on-close class="task-edit-dialog">
    <p class="dialog-subtitle">{{ t('scheduler.edit.subtitle') }}</p>
    <el-form ref="formRef" :model="form" :validate-on-rule-change="false" label-position="top" size="default" class="task-edit-form">
      <div class="task-edit-body">
        <!-- 左栏：任务内容 -->
        <div class="left-pane">
          <el-form-item prop="name" class="name-item">
            <el-input v-model="form.name" :placeholder="t('scheduler.edit.namePlaceholder')" class="name-input"
              maxlength="100" />
          </el-form-item>

          <el-form-item prop="prompt" class="prompt-item">
            <el-input v-model="form.prompt" type="textarea"
              :placeholder="t('scheduler.edit.promptGuide')" class="prompt-input" resize="none" />
          </el-form-item>

          <!-- 底部工具条：智能体 / 工作目录 / 模型（仅新建会话） -->
          <div class="composer-bar">
            <button v-if="form.targetMode === 'new_session'" ref="agentButtonRef" type="button" class="bar-btn"
              @click.stop="agentPopoverVisible = !agentPopoverVisible">
              <Avatar v-if="currentAgent" :src="currentAgent.avatarUrl || undefined" :name="currentAgent.name"
                type="assistant" :round="false" class="w-4.5 h-4.5 shrink-0" />
              <span class="text-xs font-medium ml-1 max-w-32 truncate">{{ currentAgent ? currentAgent.name : t('scheduler.edit.agentPlaceholder') }}</span>
              <el-icon size="14" class="ml-0.5"><ChevronUpDown16Regular /></el-icon>
            </button>
            <el-button v-if="form.targetMode === 'new_session'" ref="workspaceButtonRef" text class="workspace-btn"
              @click.stop="openWorkspaceDialog">
              <el-icon size="16"><FolderOpen24Regular /></el-icon>
              <span class="text-xs font-medium ml-1 max-w-32 truncate">{{ displayWorkspacePath }}</span>
              <el-icon size="14" class="ml-0.5"><ChevronUpDown16Regular /></el-icon>
            </el-button>
            <!-- 远程目录（附加工作目录）：与新建页共用同一个独立按钮 -->
            <RemoteDirButton v-if="form.targetMode === 'new_session'" :attachments="form.attachments"
              @update:attachments="form.attachments = $event" />
            <button v-if="form.targetMode === 'new_session'" ref="modelButtonRef" type="button" class="bar-btn"
              @click.stop="modelPanelVisible = !modelPanelVisible">
              <Avatar v-if="currentModel"
                :src="getModelAvatarPath(currentModel.modelName, getProviderName(currentModel.providerId)) || undefined"
                :name="getModelDisplayName(currentModel.modelName)" type="assistant" :round="false"
                class="w-4.5 h-4.5 shrink-0" />
              <span class="text-xs font-medium ml-1 max-w-32 truncate">{{ modelButtonLabel }}</span>
              <span v-if="displayThinkingEffort" class="text-xs text-gray-400">{{ getThinkingEffortLabelWithKey(displayThinkingEffort) }}</span>
              <el-icon size="14" class="ml-0.5"><ChevronUpDown16Regular /></el-icon>
            </button>
          </div>

          <!-- 工作目录选择弹窗（纯本地目录：远程附加目录已拆为独立的 RemoteDirButton） -->
          <WorkspaceSelectorPopover v-model:visible="workspacePopoverVisible" :anchor-el="workspaceButtonRef?.$el ?? null"
            :current-workspace-path="form.workspacePath || null" :public-path="publicPath"
            @select="handleWorkspaceSelect" />

          <!-- 模型选择弹窗（复用 ChatInput 的完整选择器：全部模型/收藏/推理强度级联） -->
          <ModelSelectorPanel v-model:visible="modelPanelVisible" :anchor-el="modelButtonRef" :models="modelList"
            :providers="modelProviders" :current-model-id="form.modelId || null"
            :thinking-effort-options="thinkingEffortOptions" :thinking-effort-value="displayThinkingEffort"
            @select="handleModelSelect" @select-thinking-effort="handleThinkingEffortChange" />

          <!-- 智能体选择弹窗（与工具条其他项同款的轻量清单） -->
          <GdPopover :show="agentPopoverVisible" @update:show="agentPopoverVisible = $event" :width="240"
            :max-height="320" :anchor-el="agentButtonRef">
            <div v-for="agent in agents" :key="agent.id"
              class="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
              :class="agent.id === form.agentId
                ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
                : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
              @click="handleAgentSelect(agent)">
              <Avatar :src="agent.avatarUrl || undefined" :name="agent.name" type="assistant" :round="false"
                class="w-6 h-6 shrink-0" />
              <span class="flex-1 text-sm text-(--gd-color-text) truncate">{{ agent.name }}</span>
              <el-icon v-if="agent.id === form.agentId" size="14" class="shrink-0 text-(--el-color-primary)">
                <Checkmark16Filled />
              </el-icon>
            </div>
          </GdPopover>
        </div>

        <!-- 右栏：配置（自身滚动） -->
        <div class="right-pane">
          <!-- 计划时间 -->
          <section class="cfg-section">
            <div class="cfg-title">{{ t('scheduler.edit.sectionSchedule') }}</div>
            <el-radio-group v-model="timeMode" size="small" class="time-mode-tabs">
              <el-radio-button value="period">{{ t('scheduler.edit.modePeriod') }}</el-radio-button>
              <el-radio-button value="interval">{{ t('scheduler.edit.modeInterval') }}</el-radio-button>
              <el-radio-button value="once">{{ t('scheduler.edit.modeOnce') }}</el-radio-button>
              <el-radio-button value="advanced">{{ t('scheduler.edit.modeAdvanced') }}</el-radio-button>
            </el-radio-group>

            <!-- 周期模式 -->
            <div v-if="timeMode === 'period'" class="cfg-panel space-y-3">
              <el-radio-group v-model="periodType" size="small" class="period-sub-tabs">
                <el-radio-button value="monthly">{{ t('scheduler.edit.periodMonthly') }}</el-radio-button>
                <el-radio-button value="weekly">{{ t('scheduler.edit.periodWeekly') }}</el-radio-button>
                <el-radio-button value="daily">{{ t('scheduler.edit.periodDaily') }}</el-radio-button>
              </el-radio-group>

              <div v-if="periodType === 'monthly'">
                <div class="sub-label">{{ t('scheduler.edit.selectDate') }}</div>
                <el-checkbox-group v-model="periodConfig.monthly.days" size="small">
                  <el-checkbox-button v-for="d in 31" :key="d" :value="d">{{ d }}</el-checkbox-button>
                </el-checkbox-group>
              </div>

              <div v-if="periodType === 'weekly'">
                <div class="sub-label">{{ t('scheduler.edit.selectWeek') }}</div>
                <el-checkbox-group v-model="periodConfig.weekly.days" size="small">
                  <el-checkbox-button v-for="(label, index) in weekDays" :key="index" :value="index">{{ label }}</el-checkbox-button>
                </el-checkbox-group>
              </div>

              <div class="flex items-center gap-2">
                <span class="sub-label mb-0">{{ t('scheduler.edit.time') }}</span>
                <el-time-picker v-model="periodConfig[periodType].time" format="HH:mm" value-format="HH:mm"
                  :placeholder="t('scheduler.edit.selectTimePlaceholder')" style="width: 120px" size="small" />
              </div>
            </div>

            <!-- 间隔模式 -->
            <div v-if="timeMode === 'interval'" class="cfg-panel space-y-3">
              <div class="flex items-center gap-2">
                <span class="sub-label mb-0">{{ t('scheduler.edit.every') }}</span>
                <el-input-number v-model="intervalConfig.hours" :min="1" :max="168" controls-position="right"
                  style="width: 100px" size="small" />
                <span class="sub-label mb-0">{{ t('scheduler.edit.hoursExec') }}</span>
              </div>
              <div>
                <div class="sub-label">{{ t('scheduler.edit.effectiveWeek') }}</div>
                <el-checkbox-group v-model="intervalConfig.days" size="small">
                  <el-checkbox-button v-for="(label, index) in weekDays" :key="index" :value="index">{{ label }}</el-checkbox-button>
                </el-checkbox-group>
              </div>
            </div>

            <!-- 一次性模式 -->
            <div v-if="timeMode === 'once'" class="cfg-panel">
              <el-date-picker v-model="onceConfig.datetime" type="datetime" :placeholder="t('scheduler.edit.selectExecTime')"
                format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" size="small" />
            </div>

            <!-- 高级模式 -->
            <div v-if="timeMode === 'advanced'" class="cfg-panel">
              <el-input v-model="form.cronExpression" placeholder="* * * * *" class="font-mono text-sm" size="small" />
              <div class="cfg-hint mt-1">{{ t('scheduler.edit.cronFormat') }}</div>
            </div>
          </section>

          <!-- 执行目标 -->
          <section class="cfg-section">
            <div class="cfg-title">{{ t('scheduler.edit.sectionTarget') }}</div>
            <el-radio-group v-model="form.targetMode" size="small">
              <el-radio-button value="new_session">
                <span class="flex items-center gap-1">
                  <el-icon :size="14"><AddCircleOutlineRound /></el-icon>
                  {{ t('scheduler.edit.newSession') }}
                </span>
              </el-radio-button>
              <el-radio-button value="existing_session">
                <span class="flex items-center gap-1">
                  <el-icon :size="14"><LogInRound /></el-icon>
                  {{ t('scheduler.edit.existingSession') }}
                </span>
              </el-radio-button>
            </el-radio-group>

            <!-- 新建会话 → 任务输出（独立/合并） -->
            <div v-if="form.targetMode === 'new_session'" class="sub-block">
              <div class="cfg-subtitle">{{ t('scheduler.edit.sectionOutput') }}</div>
              <el-radio-group v-model="form.outputMode" size="small">
                <el-radio-button value="independent">{{ t('scheduler.edit.outputIndependent') }}</el-radio-button>
                <el-radio-button value="merged">{{ t('scheduler.edit.outputMerged') }}</el-radio-button>
              </el-radio-group>
              <div class="cfg-hint">{{ t('scheduler.edit.outputHint') }}</div>
            </div>

            <!-- 已有会话 → 目标会话输入 -->
            <el-form-item v-if="form.targetMode === 'existing_session'" prop="targetSessionId" class="sub-block" label="">
              <el-input v-model="form.targetSessionId" :placeholder="t('scheduler.edit.targetSessionPlaceholder')"
                clearable size="small" />
            </el-form-item>
          </section>

          <!-- 到期日期 -->
          <section class="cfg-section">
            <div class="cfg-title-row">
              <div class="cfg-title">{{ t('scheduler.edit.expiresAt') }}</div>
              <el-date-picker v-model="form.expiresAt" type="datetime" :placeholder="t('scheduler.edit.noExpiry')"
                value-format="YYYY-MM-DDTHH:mm:ss" style="width: 190px" size="small" clearable />
            </div>
            <div class="cfg-hint">{{ t('scheduler.edit.expiresAtHint') }}</div>
          </section>

          <!-- 执行授权 -->
          <section class="cfg-section">
            <div class="cfg-title-row">
              <div class="cfg-title">{{ t('scheduler.edit.unattended') }}</div>
              <el-switch v-model="form.unattended" size="small" inline-prompt
                :active-text="t('scheduler.edit.on')" :inactive-text="t('scheduler.edit.off')" />
            </div>
            <div class="cfg-hint">{{ t('scheduler.edit.unattendedHint') }}</div>
            <div v-if="form.targetMode === 'existing_session'" class="cfg-hint warn">{{ t('scheduler.edit.unattendedExistingWarning') }}</div>
          </section>

          <!-- 重试 / 启用 -->
          <section class="cfg-section">
            <div class="cfg-title-row">
              <div class="cfg-title">{{ t('scheduler.edit.retryCount') }}</div>
              <el-input-number v-model="form.maxRetries" :min="0" :max="10" controls-position="right" style="width: 110px" size="small" />
            </div>
          </section>
          <section class="cfg-section">
            <div class="cfg-title-row">
              <div class="cfg-title">{{ t('scheduler.edit.retryInterval') }}</div>
              <el-input-number v-model="form.retryInterval" :min="10" :max="3600" controls-position="right" style="width: 120px" size="small" />
            </div>
          </section>
          <section class="cfg-section">
            <div class="cfg-title-row">
              <div class="cfg-title">{{ t('scheduler.edit.enabledLabel') }}</div>
              <el-switch v-model="form.enabled" size="small" inline-prompt
                :active-text="t('scheduler.edit.enable')" :inactive-text="t('scheduler.edit.disable')" />
            </div>
          </section>
        </div>
      </div>
    </el-form>

    <template #footer>
      <div class="dialog-footer flex items-center justify-between gap-3">
        <div class="footer-left flex items-center gap-3 min-w-0">
          <el-button v-if="isEdit" type="warning" plain @click="handleTest" :loading="testing">
            {{ t('scheduler.edit.testTrigger') }}
          </el-button>
          <span v-if="formError" class="footer-error">{{ formError }}</span>
        </div>
        <div class="flex justify-end gap-2 shrink-0">
          <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="handleSubmit" :loading="submitting">{{ t('scheduler.edit.save') }}</el-button>
        </div>
      </div>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElForm, ElFormItem, ElInput, ElRadioGroup, ElRadioButton, ElSwitch, ElInputNumber, ElIcon, ElButton, ElCheckboxGroup, ElCheckboxButton, ElTimePicker, ElDatePicker, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { AddCircleOutlineRound, LogInRound } from '@vicons/material'
import { FolderOpen24Regular, ChevronUpDown16Regular, Checkmark16Filled } from '@vicons/fluent'
import type { ScheduledTask, UpdateTaskRequest } from '../../types/scheduler'
import type { Agent } from '../../types/agent'
import type { Model, ModelProvider } from '../../types/api'
import { apiService } from '../../services/ApiService'
import GdDialog from '@/components/ui/GdDialog.vue'
import GdPopover from '@/components/ui/GdPopover.vue'
import Avatar from '@/components/ui/Avatar.vue'
import WorkspaceSelectorPopover from '@/components/chat/chat-input/WorkspaceSelectorPopover.vue'
import RemoteDirButton from '@/components/chat/chat-input/RemoteDirButton.vue'
import ModelSelectorPanel from '@/components/chat/chat-input/ModelSelectorPanel.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { getModelDisplayName, getModelAvatarPath, getModelThinkingEfforts, getDefaultThinkingEffort, getThinkingEffortLabelWithKey } from '@/utils/modelUtils'

const { t } = useI18n()
const DEFAULT_AGENT_ID = 'assistant-agent'
type TimeMode = 'period' | 'interval' | 'once' | 'advanced'
type PeriodType = 'monthly' | 'weekly' | 'daily'

interface Props {
  modelValue: boolean
  isEdit: boolean
  task: ScheduledTask | null
  cronPresets: { label: string; value: string }[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [data: UpdateTaskRequest]
}>()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const formRef = ref<FormInstance | null>(null)
const submitting = ref(false)
const testing = ref(false)
const formError = ref('')

// 工作目录选择
const workspaceStore = useWorkspaceStore()
const workspacePopoverVisible = ref(false)
const workspaceButtonRef = ref<{ $el: HTMLElement } | null>(null)
const publicPath = computed(() => workspaceStore.getPublicPath())

// 时间模式
const timeMode = ref<TimeMode>('period')
const periodType = ref<PeriodType>('daily')

// 周期配置
const periodConfig = ref({
  monthly: { days: [] as number[], time: '09:00' },
  weekly: { days: [0, 1, 2, 3, 4, 5, 6] as number[], time: '09:00' },
  daily: { time: '09:00' }
})

// 间隔配置
const intervalConfig = ref({ hours: 1, days: [0, 1, 2, 3, 4, 5, 6] as number[] })

// 一次性配置
const onceConfig = ref({ datetime: '' })

const weekDays = computed(() => [
  t('common.weekday.sunday'),
  t('common.weekday.monday'),
  t('common.weekday.tuesday'),
  t('common.weekday.wednesday'),
  t('common.weekday.thursday'),
  t('common.weekday.friday'),
  t('common.weekday.saturday')
])

// 智能体列表
const agents = ref<Agent[]>([])
const agentPopoverVisible = ref(false)
const agentButtonRef = ref<HTMLElement | null>(null)

// 模型列表（对齐 ChatInput：providers + 扁平 models，喂给 ModelSelectorPanel）
const modelProviders = ref<ModelProvider[]>([])
const modelList = ref<Model[]>([])
const modelPanelVisible = ref(false)
const modelButtonRef = ref<HTMLElement | null>(null)

const form = ref({
  name: '',
  prompt: '',
  cronExpression: '0 9 * * *',
  targetMode: 'new_session' as 'new_session' | 'existing_session',
  targetSessionId: '',
  outputMode: 'independent' as 'independent' | 'merged',
  agentId: '',
  modelId: '',
  thinkingEffort: '',
  workspacePath: '' as string,
  attachments: {} as Record<string, string[]>,
  expiresAt: '' as string,
  unattended: false,
  maxRetries: 3,
  retryInterval: 60,
  enabled: true
})

/**
 * 根据配置生成 cron 表达式
 */
function generateCron(): string {
  if (timeMode.value === 'advanced') {
    return form.value.cronExpression
  }

  if (timeMode.value === 'once') {
    if (!onceConfig.value.datetime) return '0 0 * * *'
    const date = new Date(onceConfig.value.datetime)
    const min = date.getMinutes()
    const hour = date.getHours()
    const day = date.getDate()
    const month = date.getMonth() + 1
    return `${min} ${hour} ${day} ${month} *`
  }

  if (timeMode.value === 'interval') {
    const hours = intervalConfig.value.hours
    const days = intervalConfig.value.days.sort((a, b) => a - b).join(',')
    if (hours >= 24) {
      const dayInterval = Math.floor(hours / 24)
      return `0 0 */${dayInterval} * ${days}`
    }
    return `0 */${hours} * * ${days}`
  }

  // period mode
  const [hour, min] = (periodConfig.value[periodType.value].time || '09:00').split(':').map(Number)

  if (periodType.value === 'daily') {
    return `${min} ${hour} * * *`
  }

  if (periodType.value === 'weekly') {
    const days = periodConfig.value.weekly.days
    if (days.length === 0) return `${min} ${hour} * * 1`
    const dayStr = days.sort((a, b) => a - b).join(',')
    return `${min} ${hour} * * ${dayStr}`
  }

  if (periodType.value === 'monthly') {
    const days = periodConfig.value.monthly.days
    if (days.length === 0) return `${min} ${hour} 1 * *`
    const dayStr = days.sort((a, b) => a - b).join(',')
    return `${min} ${hour} ${dayStr} * *`
  }

  return '0 9 * * *'
}

/**
 * 从 cron 表达式解析时间配置
 */
function parseCron(cron: string) {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return

  const [minStr, hourStr, dayStr, monthStr, weekStr] = parts

  // 尝试识别一次性模式：具体日期时间
  const monthNum = parseInt(monthStr, 10)
  const dayNum = parseInt(dayStr, 10)
  if (!monthStr.includes('*') && !monthStr.includes('/') && monthNum >= 1 && monthNum <= 12
    && !dayStr.includes('*') && !dayStr.includes('/') && dayNum >= 1 && dayNum <= 31
    && weekStr === '*') {
    timeMode.value = 'once'
    const now = new Date()
    const year = now.getFullYear()
    const hour = parseInt(hourStr, 10)
    const min = parseInt(minStr, 10)
    onceConfig.value.datetime = `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
    return
  }

  // 尝试识别间隔模式
  if (hourStr.startsWith('*/') && dayStr === '*' && monthStr === '*') {
    timeMode.value = 'interval'
    intervalConfig.value.hours = parseInt(hourStr.slice(2), 10)
    const days = weekStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6)
    intervalConfig.value.days = days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]
    return
  }
  if (minStr === '0' && hourStr === '0' && dayStr.startsWith('*/') && monthStr === '*') {
    timeMode.value = 'interval'
    intervalConfig.value.hours = parseInt(dayStr.slice(2), 10) * 24
    const days = weekStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6)
    intervalConfig.value.days = days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]
    return
  }

  // 周期模式
  timeMode.value = 'period'

  const hour = parseInt(hourStr, 10)
  const min = parseInt(minStr, 10)
  const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`

  if (dayStr === '*' && weekStr === '*') {
    periodType.value = 'daily'
    periodConfig.value.daily.time = time
    return
  }

  if (dayStr === '*' && weekStr !== '*') {
    periodType.value = 'weekly'
    periodConfig.value.weekly.time = time
    const days = weekStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6)
    periodConfig.value.weekly.days = days
    return
  }

  if (dayStr !== '*' && weekStr === '*') {
    periodType.value = 'monthly'
    periodConfig.value.monthly.time = time
    const days = dayStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 1 && d <= 31)
    periodConfig.value.monthly.days = days
    return
  }

  // 无法识别，归为高级模式
  timeMode.value = 'advanced'
}

/**
 * 手动校验：返回第一条错误信息，无错误返回 null
 */
function validateForm(): string | null {
  if (!form.value.name.trim()) return t('scheduler.edit.nameRequired')
  if (!form.value.prompt.trim()) return t('scheduler.edit.promptRequired')
  if (form.value.targetMode === 'new_session' && !form.value.agentId) {
    return t('scheduler.edit.agentRequired')
  }
  if (form.value.targetMode === 'existing_session' && !form.value.targetSessionId.trim()) {
    return t('scheduler.edit.targetSessionRequired')
  }
  return validateTimeConfig()
}

/**
 * 初始化表单数据
 */
function initForm() {
  if (props.isEdit && props.task) {
    form.value = {
      name: props.task.name || '',
      prompt: props.task.prompt || '',
      cronExpression: props.task.cronExpression || '0 9 * * *',
      targetMode: props.task.targetMode || 'new_session',
      targetSessionId: props.task.targetSessionId || '',
      outputMode: props.task.outputMode || 'independent',
      agentId: props.task.agentId || (props.task.targetMode === 'new_session' ? DEFAULT_AGENT_ID : ''),
      modelId: props.task.modelId || '',
      thinkingEffort: (props.task.settings?.thinkingEffort as string) || '',
      workspacePath: props.task.workspacePath || '',
      attachments: props.task.attachments || {},
      expiresAt: props.task.expiresAt || '',
      unattended: props.task.unattended ?? false,
      maxRetries: props.task.maxRetries ?? 3,
      retryInterval: props.task.retryInterval ?? 60,
      enabled: props.task.enabled ?? true
    }
    // 一次性任务优先使用 executeAt 恢复时间配置
    if (props.task.scheduleType === 'once' && props.task.executeAt) {
      timeMode.value = 'once'
      onceConfig.value.datetime = props.task.executeAt
    } else {
      parseCron(form.value.cronExpression)
    }
  } else {
    form.value = {
      name: '',
      prompt: '',
      cronExpression: '0 9 * * *',
      targetMode: 'new_session',
      targetSessionId: '',
      outputMode: 'independent',
      agentId: DEFAULT_AGENT_ID,
      modelId: '',
      thinkingEffort: '',
      workspacePath: '',
      attachments: {},
      expiresAt: '',
      unattended: true,
      maxRetries: 3,
      retryInterval: 60,
      enabled: true
    }
    timeMode.value = 'period'
    periodType.value = 'daily'
    periodConfig.value = {
      monthly: { days: [], time: '09:00' },
      weekly: { days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' },
      daily: { time: '09:00' }
    }
    intervalConfig.value = { hours: 1, days: [0, 1, 2, 3, 4, 5, 6] }
    onceConfig.value = { datetime: '' }
  }
}

/**
 * 校验时间配置合法性
 */
function validateTimeConfig(): string | null {
  if (timeMode.value === 'period') {
    if (periodType.value === 'monthly' && periodConfig.value.monthly.days.length === 0) {
      return t('scheduler.edit.monthlyAtLeastDay')
    }
    if (periodType.value === 'weekly' && periodConfig.value.weekly.days.length === 0) {
      return t('scheduler.edit.weeklyAtLeastDay')
    }
  }

  if (timeMode.value === 'interval' && intervalConfig.value.days.length === 0) {
    return t('scheduler.edit.intervalAtLeastDay')
  }

  if (timeMode.value === 'once' && !onceConfig.value.datetime) {
    return t('scheduler.edit.selectTime')
  }

  if (timeMode.value === 'advanced') {
    const cronPattern = /^([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)$/
    if (!cronPattern.test(form.value.cronExpression.trim())) {
      return t('scheduler.edit.cronInvalid')
    }
  }

  return null
}

/**
 * 提交表单
 */
async function handleSubmit() {
  formError.value = ''
  const err = validateForm()
  if (err) {
    formError.value = err
    return
  }

  try {
    submitting.value = true

    const cronExpression = generateCron()

    const data: UpdateTaskRequest = {
      name: form.value.name.trim(),
      prompt: form.value.prompt.trim(),
      scheduleType: timeMode.value === 'once' ? 'once' : 'cron',
      cronExpression,
      targetMode: form.value.targetMode,
      outputMode: form.value.targetMode === 'new_session' ? form.value.outputMode : undefined,
      enabled: form.value.enabled,
      maxRetries: form.value.maxRetries,
      retryInterval: form.value.retryInterval
    }

    if (timeMode.value === 'once' && onceConfig.value.datetime) {
      data.executeAt = new Date(onceConfig.value.datetime).toISOString()
    } else {
      data.executeAt = null
    }

    if (form.value.targetMode === 'existing_session' && form.value.targetSessionId) {
      data.targetSessionId = form.value.targetSessionId.trim()
    }

    if (form.value.agentId) {
      data.agentId = form.value.agentId.trim()
    }

    if (form.value.modelId) {
      data.modelId = form.value.modelId.trim()
    }

    if (form.value.targetMode === 'new_session') {
      data.workspacePath = form.value.workspacePath || null
      data.attachments = form.value.attachments || {}
    } else {
      data.workspacePath = null
      data.attachments = null
    }

    data.expiresAt = form.value.expiresAt ? new Date(form.value.expiresAt).toISOString() : null
    data.unattended = form.value.unattended

    // 思考强度走 task.settings 透传（executor 把 task.settings 并入 session.settings，thinkingEffort 本就在白名单）
    if (form.value.targetMode === 'new_session') {
      const settings: Record<string, unknown> = { ...(props.task?.settings || {}) }
      if (form.value.thinkingEffort) settings.thinkingEffort = form.value.thinkingEffort
      else delete settings.thinkingEffort
      data.settings = settings
    }

    emit('save', data)
  } catch (err) {
    // 表单验证失败
  } finally {
    submitting.value = false
  }
}

/**
 * 测试触发任务
 */
async function handleTest() {
  if (!props.task?.id) return
  testing.value = true
  try {
    const result = await apiService.testScheduledTask(props.task.id)
    ElMessage.success(result.message || t('scheduler.edit.testSuccess'))
  } catch (err) {
    console.error('测试触发失败:', err)
    ElMessage.error(getErrorMessage(err) || t('scheduler.edit.testFailed'))
  } finally {
    testing.value = false
  }
}

// ── 工作目录选择 ──
const displayWorkspacePath = computed(() => {
  const p = form.value.workspacePath
  if (!p) return t('scheduler.edit.autoCreateDir')
  const normalized = p.replace(/\\/g, '/')
  const segs = normalized.split('/').filter(Boolean)
  return segs[segs.length - 1] || p
})

function openWorkspaceDialog() {
  workspacePopoverVisible.value = !workspacePopoverVisible.value
}

function handleWorkspaceSelect(workspacePath: string | null) {
  let mode: 'auto' | 'public' | 'custom'
  if (workspacePath === null) mode = 'auto'
  else if (publicPath.value && workspacePath === publicPath.value) mode = 'public'
  else mode = 'custom'
  workspaceStore.setLastChoice(mode, workspacePath)
  if (workspacePath) workspaceStore.addRecent(workspacePath)
  form.value.workspacePath = workspacePath || ''
}

// ── 智能体选择（工具条同款轻量弹层）──
const currentAgent = computed(
  () => agents.value.find((a) => a.id === form.value.agentId) || null,
)

function handleAgentSelect(agent: Agent) {
  form.value.agentId = agent.id
  agentPopoverVisible.value = false
}

// ── 模型选择（复用 ModelSelectorPanel）──
const currentModel = computed(
  () => modelList.value.find((m) => m.id === form.value.modelId) || null,
)

const modelButtonLabel = computed(() =>
  currentModel.value ? getModelDisplayName(currentModel.value.modelName) : t('scheduler.edit.modelPlaceholder'),
)

const thinkingEffortOptions = computed(() =>
  currentModel.value ? getModelThinkingEfforts(currentModel.value, modelProviders.value) : [],
)

// 展示值：显式选过且仍在档位菜单内用所选；否则跟随菜单默认档（与后端 defaultThinkingEffort 同规则）
const displayThinkingEffort = computed(() => {
  const opts = thinkingEffortOptions.value
  if (opts.length === 0) return ''
  if (form.value.thinkingEffort && opts.includes(form.value.thinkingEffort)) return form.value.thinkingEffort
  return getDefaultThinkingEffort(opts)
})

function getProviderName(providerId?: string): string {
  if (!providerId) return ''
  return modelProviders.value.find((p) => p.id === providerId)?.name || ''
}

function handleModelSelect(modelId: string) {
  form.value.modelId = modelId
  const model = modelList.value.find((m) => m.id === modelId)
  const opts = model ? getModelThinkingEfforts(model, modelProviders.value) : []
  if (form.value.thinkingEffort && !opts.includes(form.value.thinkingEffort)) {
    form.value.thinkingEffort = ''
  }
}

function handleThinkingEffortChange(effort: string) {
  if (!effort) return
  form.value.thinkingEffort = effort
}

// 监听弹窗打开，初始化表单
watch(() => props.modelValue, (val) => {
  if (val) {
    formError.value = ''
    initForm()
    loadAgents()
    loadModels()
    workspaceStore.ensureBaseDir()
    setTimeout(() => {
      formRef.value?.clearValidate()
    }, 100)
  }
})

// 加载智能体列表
async function loadAgents() {
  try {
    const response = await apiService.fetchAgents()
    agents.value = response.items || []
    // 新建会话任务：若已存的 agentId 不在列表中（智能体已被删除），回退默认智能体
    if (
      form.value.targetMode === 'new_session' &&
      form.value.agentId &&
      !agents.value.some((a) => a.id === form.value.agentId)
    ) {
      form.value.agentId = DEFAULT_AGENT_ID
    }
  } catch (error) {
    console.error('获取智能体列表失败:', error)
  }
}

// 加载模型列表（对齐 ChatInput：仅 text 模型；额外保留调度器原有的 isActive 过滤）
async function loadModels() {
  try {
    const response = await apiService.fetchModels()
    const providers: ModelProvider[] = []
    const models: Model[] = []
    for (const provider of response.items || []) {
      const textModels = (provider.models || []).filter((m) => m.modelType === 'text' && m.isActive)
      if (textModels.length === 0) continue
      models.push(...textModels)
      const { models: _nested, ...rest } = provider
      providers.push(rest as ModelProvider)
    }
    modelList.value = models
    modelProviders.value = providers
    // 已存的 modelId 不在可用列表（模型被删/停用）→ 清空，执行时回落 agent/默认模型
    if (form.value.modelId && !models.some((m) => m.id === form.value.modelId)) {
      form.value.modelId = ''
      form.value.thinkingEffort = ''
    }
  } catch (error) {
    console.error('获取模型列表失败:', error)
  }
}
</script>

<style scoped>
.dialog-subtitle {
  margin: -4px 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.footer-error {
  font-size: 13px;
  color: var(--el-color-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-edit-form {
  width: 100%;
}

.task-edit-body {
  display: flex;
  gap: 20px;
  align-items: stretch;
  height: 40vh;
  min-height: 300px;
}

/* 左栏：内容 */
.left-pane {
  flex: 1 1 55%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.name-item {
  margin-bottom: 8px;
}

.name-input :deep(.el-input__wrapper) {
  box-shadow: none;
  padding-left: 0;
}

.name-input :deep(.el-input__inner) {
  font-size: 18px;
  font-weight: 600;
}

.prompt-item {
  flex: 1 1 auto;
  min-height: 0;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
}

.prompt-item :deep(.el-form-item__content) {
  flex: 1;
  min-height: 0;
  margin-left: 0;
}

.prompt-input {
  height: 100%;
}

.prompt-input :deep(.el-textarea) {
  height: 100%;
}

.prompt-input :deep(.el-textarea__inner) {
  height: 100% !important;
  box-shadow: none;
  padding-left: 0;
  line-height: 1.7;
  color: var(--gd-color-text);
}

/* 校验错误改为静态流式，避免压住下方控件 */
.task-edit-form :deep(.el-form-item__error) {
  position: static;
  padding-top: 2px;
}

.composer-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

/* 工具条触发按钮（智能体/模型）：与工具条其他项同高的紧凑样式 */
.bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--gd-size-dialog-rounded-radius, 6px);
  background: transparent;
  color: var(--gd-color-text);
  cursor: pointer;
  transition: background 0.2s;
}

.bar-btn:hover {
  background: var(--el-fill-color);
}

/* 右栏：配置，自身滚动 */
.right-pane {
  flex: 0 0 46%;
  max-width: 46%;
  overflow-y: auto;
  border-left: 1px solid var(--el-border-color-lighter);
  padding-left: 20px;
  padding-right: 6px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cfg-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cfg-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--gd-color-text);
}

.cfg-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cfg-subtitle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.cfg-panel {
  padding: 12px;
  border-radius: 8px;
  background-color: var(--el-fill-color-light);
  width: 100%;
  box-sizing: border-box;
}

.sub-block {
  margin-top: 4px;
}

.sub-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.cfg-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.cfg-hint.warn {
  color: var(--el-color-warning);
}

.time-mode-tabs,
.period-sub-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

:deep(.el-checkbox-button__inner) {
  padding: 5px 10px;
  font-size: 12px;
}

:deep(.el-form-item) {
  margin-bottom: 0;
}
</style>
