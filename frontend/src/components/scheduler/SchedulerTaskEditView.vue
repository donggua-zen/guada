<template>
  <!-- 弹窗模式下不加高度/滚动约束：滚动由外层 GdDialog 的 .l-dialog__body 承担 -->
  <div :class="inDialog ? 'dialog-form-root' : 'h-full flex flex-col overflow-hidden'">
    <!-- 顶部操作栏（整页模式；弹窗模式由 GdDialog 头部与 footer 承载） -->
    <div v-if="!inDialog" class="edit-header shrink-0">
      <div class="edit-header-inner">
        <div class="header-left">
          <button type="button" class="back-btn" @click="emit('back')">
            <ArrowLeft24Filled class="w-4.5 h-4.5"  />
            <span>{{ t('common.back') }}</span>
          </button>
          <span class="header-divider">·</span>
          <span class="header-title">
            {{ isEdit ? t('scheduler.edit.editTitle') : t('scheduler.edit.createTitle') }}
          </span>
        </div>
        <div class="header-actions">
          <GdButton v-if="isEdit" text :loading="testing" @click="handleTest">
            {{ t('scheduler.edit.test') }}
          </GdButton>
          <GdButton :loading="running" @click="handleRunNow">
            {{ t('scheduler.edit.runNow') }}
          </GdButton>
          <GdButton type="primary" :loading="saving" @click="handleSave">
            {{ t('scheduler.edit.save') }}
          </GdButton>
          <DropdownMenu v-if="isEdit" @command="handleCommand">
            <button type="button" class="icon-btn" :aria-label="t('scheduler.edit.moreActions')">
              <MoreHorizontal20Filled class="w-4.5 h-4.5"  />
            </button>
            <template #dropdown>
              <DropdownMenuItem command="delete">{{ t('scheduler.edit.delete') }}</DropdownMenuItem>
            </template>
          </DropdownMenu>
        </div>
      </div>
    </div>

    <!-- 编辑主体 -->
    <div ref="bodyRef" :class="inDialog ? 'dialog-form-body' : 'flex-1 overflow-auto pb-16'">
      <div class="edit-content" :class="{ 'edit-content--dialog': inDialog }">
        <p v-if="formError" class="form-error">{{ formError }}</p>

        <!-- 状态 -->
        <section v-if="isEdit" class="status-row">
          <button type="button" class="status-pill" :class="{ enabled: form.enabled }"
            @click="form.enabled = !form.enabled">
            <span class="status-dot"></span>
            {{ form.enabled ? t('scheduler.edit.statusEnabled') : t('scheduler.edit.statusPaused') }}
          </button>
          <span class="status-hint">{{ t('scheduler.edit.statusHint') }}</span>
        </section>

        <!-- 标题 -->
        <section class="field">
          <label class="field-label">{{ t('scheduler.edit.titleLabel') }}</label>
          <GdInput class="title-input" :model-value="form.name" maxlength="100"
            :placeholder="t('scheduler.edit.titlePlaceholder')" @update:model-value="onNameUpdate" />
          <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
        </section>

        <!-- 调度 -->
        <section class="field">
          <label class="field-label">{{ t('scheduler.edit.scheduleLabel') }}</label>
          <ScheduleSentence :model-value="form.schedule" :error="errors.schedule"
            @update:model-value="onScheduleUpdate" />
        </section>

        <!-- 指令 -->
        <section class="field">
          <label class="field-label">{{ t('scheduler.edit.instructionsLabel') }}</label>
          <SchedulerComposer :model-value="form.composer" :error="composerError"
            :prompt-error="errors.prompt" @update:model-value="onComposerUpdate"
            @agents-loaded="handleAgentsLoaded" />
        </section>

        <!-- 更多设置 -->
        <section class="field">
          <button type="button" class="more-toggle" @click="advancedOpen = !advancedOpen">
            
              <ChevronDown16Regular class="more-icon w-3.5 h-3.5" :class="{ rotated: advancedOpen }"  />
            
            <span>{{ t('scheduler.edit.moreSettings') }}</span>
          </button>

          <div v-if="advancedOpen" class="advanced-panel">
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-label">{{ t('scheduler.edit.expiresAt') }}</span>
                <span class="setting-desc">{{ t('scheduler.edit.expiresAtHint') }}</span>
              </div>
              <GdDatePicker :model-value="form.expiresAt" clearable class="setting-control wide"
                :placeholder="t('scheduler.edit.noExpiry')"
                @update:model-value="form.expiresAt = $event; errors.expiresAt = ''" />
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-label">{{ t('scheduler.edit.retryCount') }}</span>
                <span class="setting-desc">{{ t('scheduler.edit.retryCountHint') }}</span>
              </div>
              <GdInputNumber v-model="form.maxRetries" :min="0" :max="10"
                class="setting-control" />
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-label">{{ t('scheduler.edit.retryInterval') }}</span>
                <span class="setting-desc">{{ t('scheduler.edit.retryIntervalHint') }}</span>
              </div>
              <div class="interval-control">
                <GdInputNumber v-model="form.retryInterval" :min="10" :max="3600"
                  class="setting-control" />
                <span class="setting-unit">{{ t('scheduler.edit.seconds') }}</span>
              </div>
            </div>
          </div>
          <p v-if="errors.expiresAt" class="field-error">{{ errors.expiresAt }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft24Filled, ChevronDown16Regular, MoreHorizontal20Filled } from '@vicons/fluent'
import GdDatePicker from '@/components/ui/GdDatePicker.vue'
import GdButton from '@/components/ui/GdButton.vue'
import GdInputNumber from '@/components/ui/GdInputNumber.vue';
import GdInput from '@/components/ui/GdInput.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import DropdownMenuItem from '@/components/ui/DropdownMenuItem.vue'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { toast } from '@/components/ui/toastService';
import { getErrorMessage } from '@/utils/errorMessage'
import ScheduleSentence from './ScheduleSentence.vue'
import SchedulerComposer from './SchedulerComposer.vue'
import {
  buildSchedule,
  createDefaultScheduleDraft,
  parseLocalDateTime,
  parseSchedule,
  toLocalDateTimeString,
  validateScheduleDraft,
  type ScheduleDraft,
} from './schedule'
import type { SchedulerComposerValue } from './composer.types'
import type {
  CreateTaskRequest,
  ScheduledTask,
  UpdateTaskRequest,
} from '@/types/scheduler'
import type { Agent } from '@/types/agent'

const DEFAULT_AGENT_ID = 'assistant-agent'

const props = defineProps<{
  task: ScheduledTask | null
  /** 弹窗模式：隐藏整页顶栏，由外层 GdDialog 承载标题与操作 */
  inDialog?: boolean
}>()

const emit = defineEmits<{
  back: []
  saved: [task: ScheduledTask]
  deleted: [taskId: string]
}>()

const { t } = useI18n()
const { confirm } = usePopup()

const bodyRef = ref<HTMLElement | null>(null)
const saving = ref(false)
const running = ref(false)
const testing = ref(false)
const advancedOpen = ref(false)
const formError = ref('')
/** 新建任务保存成功后记住 id：后续「立即执行/再保存」按编辑处理 */
const savedTaskId = ref<string | null>(null)

const isEdit = computed(() => Boolean(props.task?.id || savedTaskId.value))

const agents = ref<Agent[]>([])
const agentsLoaded = ref(false)

interface FormErrors {
  name: string
  prompt: string
  schedule: string
  agent: string
  model: string
  targetSession: string
  expiresAt: string
}

const errors = reactive<FormErrors>({
  name: '',
  prompt: '',
  schedule: '',
  agent: '',
  model: '',
  targetSession: '',
  expiresAt: '',
})

function createComposer(task: ScheduledTask | null): SchedulerComposerValue {
  if (!task) {
    return {
      prompt: '',
      agentId: DEFAULT_AGENT_ID,
      modelId: '',
      thinkingEffort: '',
      workspacePath: '',
      attachments: {},
      targetMode: 'new_session',
      outputMode: 'independent',
      targetSessionId: '',
      unattended: true,
    }
  }

  return {
    prompt: task.prompt || '',
    agentId: task.agentId || DEFAULT_AGENT_ID,
    modelId: task.modelId || '',
    thinkingEffort: (task.settings?.thinkingEffort as string) || '',
    workspacePath: task.workspacePath || '',
    attachments: task.attachments || {},
    targetMode: task.targetMode || 'new_session',
    outputMode: task.outputMode || 'independent',
    targetSessionId: task.targetSessionId || '',
    unattended: task.unattended ?? false,
  }
}

function initialSchedule(task: ScheduledTask | null): ScheduleDraft {
  return task ? parseSchedule(task) : createDefaultScheduleDraft()
}

function initialExpiresAt(task: ScheduledTask | null): string {
  if (!task?.expiresAt) return ''
  const date = new Date(task.expiresAt)
  return Number.isNaN(date.getTime()) ? '' : toLocalDateTimeString(date)
}

const form = reactive({
  name: props.task?.name || '',
  schedule: initialSchedule(props.task),
  composer: createComposer(props.task),
  expiresAt: initialExpiresAt(props.task),
  maxRetries: props.task?.maxRetries ?? 3,
  retryInterval: props.task?.retryInterval ?? 60,
  enabled: props.task?.enabled ?? true,
})

// 编辑已有任务时，只要存在非默认配置就展开「更多设置」
if (props.task) {
  advancedOpen.value = Boolean(
    props.task.expiresAt ||
      props.task.targetMode === 'existing_session' ||
      props.task.outputMode === 'merged' ||
      (props.task.maxRetries ?? 3) !== 3 ||
      (props.task.retryInterval ?? 60) !== 60 ||
      props.task.enabled === false,
  )
}

const composerError = computed(
  () => errors.agent || errors.model || errors.targetSession || '',
)

function clearErrors() {
  errors.name = ''
  errors.prompt = ''
  errors.schedule = ''
  errors.agent = ''
  errors.model = ''
  errors.targetSession = ''
  errors.expiresAt = ''
  formError.value = ''
}

function scrollToTop() {
  const el = bodyRef.value
  if (!el) return
  // 弹窗模式：本组件不再是滚动容器（滚动交给 GdDialog 的 .l-dialog__body），
  // 往上找真正的滚动宿主；整页模式回落为自身
  const scroller = el.closest('.l-dialog__body') as HTMLElement | null
  if (scroller) scroller.scrollTop = 0
  else el.scrollTop = 0
}

function onNameUpdate(value: string) {
  form.name = value
  errors.name = ''
  formError.value = ''
}

function onScheduleUpdate(value: ScheduleDraft) {
  form.schedule = value
  errors.schedule = ''
  formError.value = ''
}

function onComposerUpdate(value: SchedulerComposerValue) {
  form.composer = value
  errors.prompt = ''
  errors.agent = ''
  errors.model = ''
  errors.targetSession = ''
  formError.value = ''
}

function handleAgentsLoaded(list: Agent[]) {
  agents.value = list
  agentsLoaded.value = true
}

function validate(): boolean {
  clearErrors()
  let ok = true

  if (!form.name.trim()) {
    errors.name = t('scheduler.validation.nameRequired')
    ok = false
  }

  if (!form.composer.prompt.trim()) {
    errors.prompt = t('scheduler.validation.promptRequired')
    ok = false
  }

  const scheduleErrorKey = validateScheduleDraft(form.schedule)
  if (scheduleErrorKey) {
    errors.schedule = t(scheduleErrorKey)
    ok = false
  }

  if (form.composer.targetMode === 'new_session') {
    if (!form.composer.agentId) {
      errors.agent = t('scheduler.validation.agentRequired')
      ok = false
    }
    // 智能体尚未加载完成时不做模型兜底判断，避免误报
    if (agentsLoaded.value && !form.composer.modelId) {
      const agent = agents.value.find((item) => item.id === form.composer.agentId)
      if (!agent?.modelId) {
        errors.model = t('scheduler.validation.modelRequired')
        ok = false
      }
    }
  } else if (!form.composer.targetSessionId.trim()) {
    errors.targetSession = t('scheduler.validation.targetSessionRequired')
    ok = false
  }

  if (form.expiresAt) {
    const date = parseLocalDateTime(form.expiresAt)
    if (!date || date.getTime() <= Date.now()) {
      errors.expiresAt = t('scheduler.validation.expiresAtInPast')
      ok = false
    }
  }

  if (!ok) {
    formError.value = t('scheduler.validation.fixErrors')
    scrollToTop()
  }
  return ok
}

function buildPayload(): UpdateTaskRequest {
  const schedule = buildSchedule(form.schedule)
  const composer = form.composer
  const isNewSession = composer.targetMode === 'new_session'

  const data: UpdateTaskRequest = {
    name: form.name.trim(),
    prompt: composer.prompt.trim(),
    scheduleType: schedule.scheduleType,
    cronExpression: schedule.cronExpression,
    executeAt: schedule.scheduleType === 'once' ? schedule.executeAt ?? null : null,
    targetMode: composer.targetMode,
    outputMode: isNewSession ? composer.outputMode : undefined,
    targetSessionId: isNewSession ? null : composer.targetSessionId.trim() || null,
    agentId: isNewSession ? composer.agentId || null : null,
    modelId: isNewSession ? composer.modelId || null : null,
    workspacePath: isNewSession ? composer.workspacePath || null : null,
    attachments: isNewSession ? composer.attachments : null,
    enabled: form.enabled,
    expiresAt: form.expiresAt ? parseLocalDateTime(form.expiresAt)?.toISOString() ?? null : null,
    unattended: composer.unattended,
    maxRetries: form.maxRetries,
    retryInterval: form.retryInterval,
  }

  if (isNewSession) {
    const settings: Record<string, unknown> = { ...(props.task?.settings || {}) }
    if (composer.thinkingEffort) settings.thinkingEffort = composer.thinkingEffort
    else delete settings.thinkingEffort
    data.settings = settings
  }

  return data
}

function toCreateRequest(data: UpdateTaskRequest): CreateTaskRequest {
  return {
    name: data.name ?? '',
    prompt: data.prompt ?? '',
    scheduleType: data.scheduleType ?? 'cron',
    cronExpression: data.cronExpression,
    executeAt: data.executeAt ?? undefined,
    targetMode: data.targetMode ?? 'new_session',
    targetSessionId: data.targetSessionId ?? undefined,
    outputMode: data.outputMode,
    agentId: data.agentId ?? undefined,
    modelId: data.modelId ?? undefined,
    settings: data.settings ?? undefined,
    workspacePath: data.workspacePath ?? undefined,
    attachments: data.attachments ?? undefined,
    enabled: data.enabled,
    expiresAt: data.expiresAt ?? undefined,
    unattended: data.unattended,
    maxRetries: data.maxRetries,
    retryInterval: data.retryInterval,
  }
}

async function persist(): Promise<ScheduledTask | null> {
  if (!validate()) return null

  saving.value = true
  try {
    const data = buildPayload()
    let task: ScheduledTask

    if (props.task?.id) {
      task = await apiService.updateScheduledTask(props.task.id, data)
      toast.success(t('common.updateSuccess'))
    } else if (savedTaskId.value) {
      task = await apiService.updateScheduledTask(savedTaskId.value, data)
      toast.success(t('common.updateSuccess'))
    } else {
      task = await apiService.createScheduledTask(toCreateRequest(data))
      savedTaskId.value = task.id
      toast.success(t('common.createSuccess'))
    }

    return task
  } catch (error) {
    console.error('保存任务失败:', error)
    toast.error(getErrorMessage(error) || t('scheduler.edit.saveFailed'))
    return null
  } finally {
    saving.value = false
  }
}

async function handleSave() {
  const task = await persist()
  if (!task) return
  emit('saved', task)
  emit('back')
}

async function handleRunNow() {
  const task = await persist()
  if (!task) return

  running.value = true
  let ran = false
  try {
    await apiService.runScheduledTask(task.id)
    ran = true
    toast.success(t('scheduler.edit.runNowSuccess'))
  } catch (error) {
    console.error('立即执行失败:', error)
    toast.error(getErrorMessage(error) || t('scheduler.edit.runNowFailed'))
  } finally {
    running.value = false
  }

  emit('saved', task)
  if (ran) emit('back')
}

async function handleTest() {
  const taskId = props.task?.id || savedTaskId.value
  if (!taskId) return
  testing.value = true
  try {
    const result = await apiService.testScheduledTask(taskId)
    toast.success(result.message || t('scheduler.edit.testSuccess'))
  } catch (error) {
    console.error('测试触发失败:', error)
    toast.error(getErrorMessage(error) || t('scheduler.edit.testFailed'))
  } finally {
    testing.value = false
  }
}

async function handleDelete() {
  const taskId = props.task?.id || savedTaskId.value
  if (!taskId) return

  try {
    const confirmed = await confirm(
      t('scheduler.edit.deleteTitle'),
      t('scheduler.edit.deleteConfirm', { name: form.name || t('scheduler.edit.untitled') }),
    )
    if (!confirmed) return

    await apiService.deleteScheduledTask(taskId)
    toast.success(t('common.deleteSuccess'))
    emit('deleted', taskId)
    emit('back')
  } catch (error) {
    if (error !== 'cancelled') {
      console.error('删除任务失败:', error)
      toast.error(getErrorMessage(error) || t('common.deleteFailed'))
    }
  }
}

function handleCommand(command: string) {
  if (command === 'delete') void handleDelete()
}

// 弹窗模式：外层通过 ref 调用保存/执行，并用 exposed refs 控制按钮 loading
defineExpose({
  save: handleSave,
  runNow: handleRunNow,
  test: handleTest,
  remove: handleDelete,
  saving,
  running,
  testing,
  isEdit,
})
</script>

<style scoped>
.edit-header {
  border-bottom: 1px solid var(--gd-color-surface-border);
  background: var(--gd-color-surface);
}

.edit-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 10px 16px;
}

.header-left,
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--gd-color-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 2px;
}

.back-btn:hover {
  color: var(--gd-color-primary);
}

.header-divider {
  color: var(--gd-color-text-disabled);
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--gd-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--gd-color-text);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--gd-color-field-bg);
}

.edit-content {
  display: flex;
  flex-direction: column;
  gap: 26px;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 32px;
}

/* 弹窗模式：高度与滚动全部交给外层 GdDialog（.l-dialog max-height:85vh +
   .l-dialog__body 自身 overflow-y:auto）。这里刻意不再设 max-height/overflow——
   嵌套滚动容器会把滚动条收进内层、还白占一截右侧内边距，上下空间也浪费。
   （只删 overflow-y 会因 overflow-x:hidden 触发「visible 折算 auto」，两个方向必须一起删） */

.dialog-form-body {
  padding: 2px 0 4px;
}

.edit-content--dialog {
  max-width: none;
  padding: 0;
  gap: 20px;
}

.form-error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--gd-color-danger-0f, rgba(245, 108, 108, 0.1));
  color: var(--gd-color-danger);
  font-size: 13px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--gd-color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--gd-color-text-gray);
  font-size: 12px;
  cursor: pointer;
}

.status-pill.enabled {
  border-color: var(--gd-color-success);
  color: var(--gd-color-success);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gd-color-text-disabled);
}

.status-pill.enabled .status-dot {
  background: var(--gd-color-success);
}

.status-hint {
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--gd-color-text-gray);
}

.field-error {
  margin: 0;
  font-size: 12px;
  color: var(--gd-color-danger);
}

.more-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--gd-color-text-gray);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 0;
}

.more-toggle:hover {
  color: var(--gd-color-text);
}

.more-icon {
  transition: transform 0.15s ease;
}

.more-icon.rotated {
  transform: rotate(180deg);
}

.advanced-panel {
  border: 1px solid var(--gd-color-border);
  border-radius: 10px;
  overflow: hidden;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--gd-color-border);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  font-size: 13px;
  color: var(--gd-color-text);
}

.setting-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--gd-color-text-gray);
}

/* 控件宽度：类落在子组件内部元素上（GdDatePicker/GdTimePicker 触发器、GdInputNumber 转发给
   GdInput），普通 scoped 选择器带 [data-v] 匹配不到，必须 :deep——否则内部 w-full 生效、
   控件撑满整行 */
:deep(.setting-control) {
  width: 120px;
  flex-shrink: 0;
}

:deep(.setting-control.wide) {
  width: 200px;
}

.interval-control {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.setting-unit {
  font-size: 12px;
  color: var(--gd-color-text-gray);
}

@media (max-width: 640px) {
  .setting-row {
    flex-direction: column;
    align-items: flex-start;
  }

  :deep(.setting-control),
  :deep(.setting-control.wide) {
    width: 100%;
  }
}
</style>
