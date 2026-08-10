<template>
  <el-dialog v-model="dialogVisible" :title="isEdit ? t('scheduler.edit.editTitle') : t('scheduler.edit.createTitle')" width="775px" align-center
    destroy-on-close class="dialog-with-scroll" style="max-height: 70vh;">
    <div class="dialog-content">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="left" label-width="100px" size="default">
        <!-- 基本信息 -->
        <el-form-item :label="t('scheduler.edit.nameLabel')" prop="name">
          <el-input v-model="form.name" :placeholder="t('scheduler.edit.namePlaceholder')" clearable />
        </el-form-item>

        <el-form-item :label="t('scheduler.edit.promptLabel')" prop="prompt">
          <el-input v-model="form.prompt" type="textarea" :rows="3"
            :placeholder="t('scheduler.edit.promptPlaceholder')" />
        </el-form-item>

        <!-- 时间设置 -->
        <el-form-item :label="t('scheduler.edit.timeLabel')" required class="time-setting-item">
          <div class="time-mode-wrapper">
            <el-radio-group v-model="timeMode" size="small" class="time-mode-tabs">
              <el-radio-button value="period">{{ t('scheduler.edit.modePeriod') }}</el-radio-button>
              <el-radio-button value="interval">{{ t('scheduler.edit.modeInterval') }}</el-radio-button>
              <el-radio-button value="once">{{ t('scheduler.edit.modeOnce') }}</el-radio-button>
              <el-radio-button value="advanced">{{ t('scheduler.edit.modeAdvanced') }}</el-radio-button>
            </el-radio-group>

            <!-- 周期模式 -->
            <div v-if="timeMode === 'period'" class="period-panel">
              <el-radio-group v-model="periodType" size="small" class="period-sub-tabs">
                <el-radio-button value="monthly">{{ t('scheduler.edit.periodMonthly') }}</el-radio-button>
                <el-radio-button value="weekly">{{ t('scheduler.edit.periodWeekly') }}</el-radio-button>
                <el-radio-button value="daily">{{ t('scheduler.edit.periodDaily') }}</el-radio-button>
              </el-radio-group>

              <!-- 每月 -->
              <div v-if="periodType === 'monthly'" class="space-y-3">
                <div>
                  <div class="text-xs text-gray-500 mb-1.5">{{ t('scheduler.edit.selectDate') }}</div>
                  <el-checkbox-group v-model="periodConfig.monthly.days" size="small">
                    <el-checkbox-button v-for="d in 31" :key="d" :value="d">{{ d }}{{ t('scheduler.edit.dayUnit') }}</el-checkbox-button>
                  </el-checkbox-group>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">{{ t('scheduler.edit.time') }}</span>
                  <el-time-picker v-model="periodConfig.monthly.time" format="HH:mm" value-format="HH:mm"
                    :placeholder="t('scheduler.edit.selectTimePlaceholder')" style="width: 120px" />
                </div>
              </div>

              <!-- 每周 -->
              <div v-if="periodType === 'weekly'" class="space-y-3">
                <div>
                  <div class="text-xs text-gray-500 mb-1.5">{{ t('scheduler.edit.selectWeek') }}</div>
                  <el-checkbox-group v-model="periodConfig.weekly.days" size="small">
                    <el-checkbox-button v-for="(label, index) in weekDays" :key="index" :value="index">
                      {{ label }}
                    </el-checkbox-button>
                  </el-checkbox-group>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">{{ t('scheduler.edit.time') }}</span>
                  <el-time-picker v-model="periodConfig.weekly.time" format="HH:mm" value-format="HH:mm"
                    :placeholder="t('scheduler.edit.selectTimePlaceholder')" style="width: 120px" />
                </div>
              </div>

              <!-- 每日 -->
              <div v-if="periodType === 'daily'" class="flex items-center gap-2">
                <span class="text-xs text-gray-500">{{ t('scheduler.edit.time') }}</span>
                <el-time-picker v-model="periodConfig.daily.time" format="HH:mm" value-format="HH:mm"
                  :placeholder="t('scheduler.edit.selectTimePlaceholder')" style="width: 120px" />
              </div>
            </div>

            <!-- 间隔模式 -->
            <div v-if="timeMode === 'interval'" class="interval-panel space-y-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">{{ t('scheduler.edit.every') }}</span>
                <el-input-number v-model="intervalConfig.hours" :min="1" :max="168" controls-position="right"
                  style="width: 100px" />
                <span class="text-xs text-gray-500">{{ t('scheduler.edit.hoursExec') }}</span>
              </div>
              <div>
                <div class="text-xs text-gray-500 mb-1.5">{{ t('scheduler.edit.effectiveWeek') }}</div>
                <el-checkbox-group v-model="intervalConfig.days" size="small">
                  <el-checkbox-button v-for="(label, index) in weekDays" :key="index" :value="index">
                    {{ label }}
                  </el-checkbox-button>
                </el-checkbox-group>
              </div>
            </div>

            <!-- 一次性模式 -->
            <div v-if="timeMode === 'once'" class="once-panel flex items-center gap-2">
              <el-date-picker v-model="onceConfig.datetime" type="datetime" :placeholder="t('scheduler.edit.selectExecTime')"
                format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 220px" />
            </div>

            <!-- 高级模式 -->
            <div v-if="timeMode === 'advanced'" class="advanced-panel">
              <el-input v-model="form.cronExpression" placeholder="* * * * *" class="font-mono text-sm"
                style="width: 200px" />
              <div class="text-xs text-gray-400 mt-1">
                {{ t('scheduler.edit.cronFormat') }}
              </div>
            </div>
          </div>
        </el-form-item>

        <!-- 执行目标 -->
        <el-form-item :label="t('scheduler.edit.targetLabel')" prop="targetMode">
          <el-radio-group v-model="form.targetMode">
            <el-radio-button value="new_session">
              <span class="flex items-center gap-1">
                <el-icon :size="14">
                  <AddCircleOutlineRound />
                </el-icon>
                {{ t('scheduler.edit.newSession') }}
              </span>
            </el-radio-button>
            <el-radio-button value="existing_session">
              <span class="flex items-center gap-1">
                <el-icon :size="14">
                  <LogInRound />
                </el-icon>
                {{ t('scheduler.edit.existingSession') }}
              </span>
            </el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 已有会话时需要选择会话ID -->
        <el-form-item v-if="form.targetMode === 'existing_session'" :label="t('scheduler.edit.targetSessionLabel')" prop="targetSessionId">
          <el-input v-model="form.targetSessionId" :placeholder="t('scheduler.edit.targetSessionPlaceholder')" clearable />
        </el-form-item>

        <!-- 新建会话时可选配置助手和模型 -->
        <el-form-item v-if="form.targetMode === 'new_session'" :label="t('scheduler.edit.characterLabel')" prop="characterId">
          <el-select v-model="form.characterId" :placeholder="t('scheduler.edit.characterPlaceholder')" style="width: 100%" filterable>
            <el-option v-for="character in characters" :key="character.id" :label="character.title"
              :value="character.id">
              <div class="flex items-center gap-2">
                <img v-if="character.avatarUrl" :src="character.avatarUrl" class="w-5 h-5 rounded object-cover" />
                <span>{{ character.title }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.targetMode === 'new_session'" :label="t('scheduler.edit.modelLabel')" prop="modelId">
          <el-select v-model="form.modelId" :placeholder="t('scheduler.edit.modelPlaceholder')" style="width: 100%" filterable clearable>
            <el-option v-for="model in availableModels" :key="model.id" :label="model.modelName" :value="model.id">
              <div class="flex items-center gap-2">
                <span>{{ model.modelName }}</span>
                <span class="text-gray-400 text-xs">{{ model.providerName }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <!-- 可选配置 -->
        <el-divider content-position="left">{{ t('scheduler.edit.advanced') }}</el-divider>

        <el-form-item :label="t('scheduler.edit.maxExecutions')">
          <el-input-number v-model="form.maxExecutions" :min="1" :max="9999" controls-position="right"
            style="width: 160px" :placeholder="t('scheduler.edit.unlimited')" />
          <span class="text-xs text-gray-400 ml-2">{{ t('scheduler.edit.maxExecutionsHint') }}</span>
        </el-form-item>

        <el-form-item :label="t('scheduler.edit.retryCount')">
          <el-input-number v-model="form.maxRetries" :min="0" :max="10" controls-position="right"
            style="width: 120px" />
        </el-form-item>

        <el-form-item :label="t('scheduler.edit.retryInterval')">
          <el-input-number v-model="form.retryInterval" :min="10" :max="3600" controls-position="right"
            style="width: 140px">
            <template #suffix>
              <span class="text-gray-400 text-xs">{{ t('scheduler.edit.seconds') }}</span>
            </template>
          </el-input-number>
        </el-form-item>

        <el-form-item :label="t('scheduler.edit.enabledLabel')">
          <el-switch v-model="form.enabled" inline-prompt :active-text="t('scheduler.edit.enable')" :inactive-text="t('scheduler.edit.disable')" />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer flex justify-end gap-2">
        <el-button v-if="isEdit" type="warning" plain @click="handleTest" :loading="testing">
          {{ t('scheduler.edit.testTrigger') }}
        </el-button>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">{{ t('scheduler.edit.save') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElDialog, ElForm, ElFormItem, ElInput, ElRadioGroup, ElRadioButton,
  ElSwitch, ElInputNumber, ElDivider, ElIcon, ElButton,
  ElCheckboxGroup, ElCheckboxButton, ElTimePicker, ElDatePicker,
  ElMessage, ElSelect, ElOption
} from 'element-plus'
import { AddCircleOutlineRound, LogInRound } from '@vicons/material'
import type { ScheduledTask } from '../../types/scheduler'
import type { Character } from '../../types/character'
import type { Model, ModelProvider } from '../../types/api'
import { apiService } from '../../services/ApiService'

const { t } = useI18n()
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
  'save': [data: any]
}>()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const formRef = ref<any>(null)
const submitting = ref(false)
const testing = ref(false)

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
  t('common.time.sunday'),
  t('common.time.monday'),
  t('common.time.tuesday'),
  t('common.time.wednesday'),
  t('common.time.thursday'),
  t('common.time.friday'),
  t('common.time.saturday')
])

// 角色列表
const characters = ref<Character[]>([])

// 模型列表
const modelProviders = ref<ModelProvider[]>([])
const allModels = ref<Model[]>([])

// 可用的模型列表（按提供商分组后的扁平列表）
const availableModels = computed(() => {
  return allModels.value.filter(model => model.isActive)
})

const form = ref({
  name: '',
  prompt: '',
  cronExpression: '0 9 * * *',
  targetMode: 'new_session' as 'new_session' | 'existing_session',
  targetSessionId: '',
  characterId: '',
  modelId: '',
  maxExecutions: undefined as number | undefined,
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

const rules = computed(() => ({
  name: [
    { required: true, message: t('scheduler.edit.nameRequired'), trigger: 'blur' },
    { min: 1, max: 100, message: t('scheduler.edit.nameLength'), trigger: 'blur' }
  ],
  prompt: [
    { required: true, message: t('scheduler.edit.promptRequired'), trigger: 'blur' }
  ],
  targetMode: [
    { required: true, message: t('scheduler.edit.targetRequired'), trigger: 'change' }
  ],
  targetSessionId: [
    {
      validator: (_rule: any, value: string, callback: Function) => {
        if (form.value.targetMode === 'existing_session' && !value) {
          callback(new Error(t('scheduler.edit.targetSessionRequired')))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  characterId: [
    {
      validator: (_rule: any, value: string, callback: Function) => {
        if (form.value.targetMode === 'new_session' && !value) {
          callback(new Error(t('scheduler.edit.characterRequired')))
        } else {
          callback()
        }
      },
      trigger: 'change'
    }
  ]
}))

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
      characterId: props.task.characterId || '',
      modelId: props.task.modelId || '',
      maxExecutions: props.task.maxExecutions ?? undefined,
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
      characterId: '',
      modelId: '',
      maxExecutions: undefined,
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
  try {
    await formRef.value?.validate()

    const timeError = validateTimeConfig()
    if (timeError) {
      ElMessage.warning(timeError)
      return
    }

    submitting.value = true

    const cronExpression = generateCron()

    const data: any = {
      name: form.value.name.trim(),
      prompt: form.value.prompt.trim(),
      scheduleType: timeMode.value === 'once' ? 'once' : 'cron',
      cronExpression,
      targetMode: form.value.targetMode,
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

    if (form.value.characterId) {
      data.characterId = form.value.characterId.trim()
    }

    if (form.value.modelId) {
      data.modelId = form.value.modelId.trim()
    }

    if (form.value.maxExecutions !== undefined && form.value.maxExecutions > 0) {
      data.maxExecutions = form.value.maxExecutions
    }

    // 一次性任务默认设置 maxExecutions 为 1
    if (timeMode.value === 'once' && data.maxExecutions === undefined) {
      data.maxExecutions = 1
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
  } catch (err: any) {
    console.error('测试触发失败:', err)
    ElMessage.error(err.message || t('scheduler.edit.testFailed'))
  } finally {
    testing.value = false
  }
}

// 监听弹窗打开，初始化表单
watch(() => props.modelValue, (val) => {
  if (val) {
    initForm()
    loadCharacters()
    loadModels()
    setTimeout(() => {
      formRef.value?.clearValidate()
    }, 100)
  }
})

// 加载角色列表
async function loadCharacters() {
  try {
    const response = await apiService.fetchCharacters()
    characters.value = response.items || []
  } catch (error) {
    console.error('获取助手列表失败:', error)
  }
}

// 加载模型列表
async function loadModels() {
  try {
    const response = await apiService.fetchModels()
    modelProviders.value = response.items || []
    // 扁平化所有模型
    allModels.value = modelProviders.value.flatMap(provider =>
      (provider.models || []).map(model => ({
        ...model,
        providerName: provider.name
      }))
    )
  } catch (error) {
    console.error('获取模型列表失败:', error)
  }
}
</script>

<style scoped>

:deep(.el-divider__text) {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.time-mode-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.time-mode-tabs,
.period-sub-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.period-panel,
.interval-panel,
.once-panel,
.advanced-panel {
  padding: 12px;
  border-radius: 8px;
  background-color: var(--el-fill-color-light);
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  display: block;
}

:deep(.el-checkbox-button__inner) {
  padding: 5px 10px;
  font-size: 12px;
}

:deep(.time-setting-item .el-form-item__content) {
  display: block;
  width: 100%;
}
</style>
