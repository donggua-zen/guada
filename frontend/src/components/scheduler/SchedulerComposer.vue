<template>
  <div class="scheduler-composer">
    <!-- 与聊天输入框一致：智能体在输入框上方；输出目标是本页特色，放在同一行 -->
    <div class="composer-identity">
      <template v-if="isNewSession">
        <span class="identity-label">{{ t('scheduler.composer.use') }}</span>
        <button ref="agentButtonRef" type="button" class="identity-pill"
          @click.stop="agentPopoverVisible = !agentPopoverVisible">
          <Avatar v-if="currentAgent" :src="currentAgent.avatarUrl || undefined" :name="currentAgent.name"
            type="assistant" :round="false" class="w-4 h-4 shrink-0" />
          <span class="identity-text">{{ currentAgent ? currentAgent.name : t('scheduler.composer.agentPlaceholder') }}</span>
          <el-icon :size="12"><ChevronDown16Regular /></el-icon>
        </button>
        <AgentSelectorPopover :show="agentPopoverVisible" :anchor-el="agentButtonRef" :agents="agents"
          :current-agent-id="modelValue.agentId || null" @update:show="agentPopoverVisible = $event"
          @select="handleAgentSelect" />
        <span class="identity-arrow">›</span>
      </template>
      <span class="identity-label">{{ isNewSession ? '' : t('scheduler.composer.sendTo') }}</span>
      <button ref="outputButtonRef" type="button" class="identity-pill" @click.stop="toggleOutputPopover">
        <span class="identity-text">{{ outputLabel }}</span>
        <el-icon :size="12"><ChevronDown16Regular /></el-icon>
      </button>
      <GdPopover :show="outputPopoverVisible" @update:show="outputPopoverVisible = $event" :width="340"
        :anchor-el="outputButtonRef">
        <button type="button" class="option-row" :class="{ active: outputTarget === 'independent' }"
          @click="setOutputTarget('independent')">
          <div class="option-text">
            <span class="option-title">{{ t('scheduler.composer.outputIndependent') }}</span>
            <span class="option-desc">{{ t('scheduler.composer.outputIndependentHint') }}</span>
          </div>
          <el-icon v-if="outputTarget === 'independent'" :size="14"><Checkmark16Filled /></el-icon>
        </button>
        <button type="button" class="option-row" :class="{ active: outputTarget === 'merged' }"
          @click="setOutputTarget('merged')">
          <div class="option-text">
            <span class="option-title">{{ t('scheduler.composer.outputMerged') }}</span>
            <span class="option-desc">{{ t('scheduler.composer.outputMergedHint') }}</span>
          </div>
          <el-icon v-if="outputTarget === 'merged'" :size="14"><Checkmark16Filled /></el-icon>
        </button>
        <button type="button" class="option-row" :class="{ active: outputTarget === 'existing' }"
          @click="setOutputTarget('existing')">
          <div class="option-text">
            <span class="option-title">{{ t('scheduler.composer.outputExisting') }}</span>
            <span class="option-desc">{{ t('scheduler.composer.outputExistingHint') }}</span>
          </div>
          <el-icon v-if="outputTarget === 'existing'" :size="14"><Checkmark16Filled /></el-icon>
        </button>

        <div v-if="outputTarget === 'existing'" class="session-picker">
          <el-input :model-value="sessionKeyword" size="small" :placeholder="t('scheduler.composer.searchSession')"
            clearable @update:model-value="handleSessionSearch">
            <template #prefix>
              <el-icon :size="14"><Search16Regular /></el-icon>
            </template>
          </el-input>
          <div class="session-list">
            <button v-for="session in sessionOptions" :key="session.id" type="button" class="session-row"
              :class="{ active: session.id === modelValue.targetSessionId }" @click="selectSession(session)">
              <span class="session-title">{{ session.title || session.id }}</span>
              <el-icon v-if="session.id === modelValue.targetSessionId" :size="14"><Checkmark16Filled /></el-icon>
            </button>
            <div v-if="sessionOptions.length === 0" class="session-empty">
              {{ sessionsLoading ? t('common.loading') : t('scheduler.composer.noSessions') }}
            </div>
          </div>
        </div>
      </GdPopover>
    </div>

    <div class="composer-shell" :class="{ 'has-error': !!error }">
      <!-- 顶部：工作目录 + 远程目录，和聊天输入框一致 -->
      <div v-if="isNewSession" class="composer-context">
        <button ref="workspaceButtonRef" type="button" class="context-pill"
          @click.stop="workspacePopoverVisible = !workspacePopoverVisible">
          <el-icon :size="14"><FolderOpen24Regular /></el-icon>
          <span class="pill-label">{{ t('scheduler.composer.workspacePrefix') }}{{ displayWorkspacePath }}</span>
          <el-icon :size="12"><ChevronUpDown16Regular /></el-icon>
        </button>
        <WorkspaceSelectorPopover v-model:visible="workspacePopoverVisible" :anchor-el="workspaceButtonRef"
          :current-workspace-path="modelValue.workspacePath || null" :public-path="publicPath"
          @select="handleWorkspaceSelect" />

        <RemoteDirButton :attachments="modelValue.attachments"
          @update:attachments="patch({ attachments: $event })" />
      </div>

      <el-input class="composer-textarea" type="textarea" resize="none" :model-value="modelValue.prompt"
        :autosize="{ minRows: 4, maxRows: 12 }" :placeholder="t('scheduler.composer.placeholder')"
        @update:model-value="patch({ prompt: $event })" />
      <p v-if="promptError" class="composer-prompt-error">{{ promptError }}</p>

      <div class="composer-toolbar">
        <div class="composer-tools">
          <!-- 底部左侧：与聊天输入框的「工作区可写」同一位置 -->
          <template v-if="isNewSession">
            <button ref="permissionButtonRef" type="button" class="composer-pill"
              :class="{ 'pill-warn': modelValue.unattended }" @click.stop="permissionPopoverVisible = !permissionPopoverVisible">
              <el-icon :size="14">
                <ShieldError16Regular v-if="modelValue.unattended" />
                <ShieldLock24Regular v-else />
              </el-icon>
              <span class="pill-label">{{ modelValue.unattended ? t('scheduler.composer.unattended') : t('scheduler.composer.confirmEach') }}</span>
              <el-icon :size="12"><ChevronUpDown16Regular /></el-icon>
            </button>
            <GdPopover :show="permissionPopoverVisible" @update:show="permissionPopoverVisible = $event" :width="280"
              :anchor-el="permissionButtonRef">
              <button type="button" class="option-row" :class="{ active: modelValue.unattended }" @click="setUnattended(true)">
                <div class="option-text">
                  <span class="option-title">{{ t('scheduler.composer.unattended') }}</span>
                  <span class="option-desc">{{ t('scheduler.composer.unattendedHint') }}</span>
                </div>
                <el-icon v-if="modelValue.unattended" :size="14"><Checkmark16Filled /></el-icon>
              </button>
              <button type="button" class="option-row" :class="{ active: !modelValue.unattended }" @click="setUnattended(false)">
                <div class="option-text">
                  <span class="option-title">{{ t('scheduler.composer.confirmEach') }}</span>
                  <span class="option-desc">{{ t('scheduler.composer.confirmEachHint') }}</span>
                </div>
                <el-icon v-if="!modelValue.unattended" :size="14"><Checkmark16Filled /></el-icon>
              </button>
            </GdPopover>
          </template>
        </div>

        <div v-if="isNewSession" class="composer-right">
          <button ref="modelButtonRef" type="button" class="composer-pill model-pill" @click.stop="modelPopoverVisible = !modelPopoverVisible">
            <Avatar v-if="currentModel"
              :src="getModelAvatarPath(currentModel.modelName, getProviderName(currentModel.providerId)) || undefined"
              :name="getModelDisplayName(currentModel.modelName)" type="assistant" :round="false"
              class="w-4 h-4 shrink-0" />
            <span class="pill-label">{{ modelButtonLabel }}</span>
            <span v-if="displayThinkingEffort" class="thinking-label">{{ getThinkingEffortLabelWithKey(displayThinkingEffort) }}</span>
            <el-icon :size="12"><ChevronDown16Regular /></el-icon>
          </button>
          <ModelSelectorPanel v-model:visible="modelPopoverVisible" :anchor-el="modelButtonRef" :models="models"
            :providers="providers" :current-model-id="modelValue.modelId || null"
            :thinking-effort-options="thinkingEffortOptions" :thinking-effort-value="displayThinkingEffort"
            @select="handleModelSelect" @select-thinking-effort="handleThinkingEffortChange" />
        </div>
      </div>
    </div>

    <p v-if="isNewSession && modelValue.targetMode === 'new_session' && modelValue.outputMode === 'merged'" class="composer-hint">
      {{ t('scheduler.composer.mergedHint') }}
    </p>
    <p v-if="!isNewSession" class="composer-hint">
      {{ t('scheduler.composer.existingHint') }}
    </p>
    <p v-if="error" class="composer-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElInput, ElIcon } from 'element-plus'
import {
  Checkmark16Filled,
  ChevronDown16Regular,
  ChevronUpDown16Regular,
  FolderOpen24Regular,
  ShieldError16Regular,
  ShieldLock24Regular,
  Search16Regular,
} from '@vicons/fluent'
import Avatar from '@/components/ui/Avatar.vue'
import GdPopover from '@/components/ui/GdPopover.vue'
import AgentSelectorPopover from '@/components/chat/chat-input/AgentSelectorPopover.vue'
import WorkspaceSelectorPopover from '@/components/chat/chat-input/WorkspaceSelectorPopover.vue'
import RemoteDirButton from '@/components/chat/chat-input/RemoteDirButton.vue'
import ModelSelectorPanel from '@/components/chat/chat-input/ModelSelectorPanel.vue'
import { apiService } from '@/services/ApiService'
import { useWorkspaceStore } from '@/stores/workspace'
import { useModelCatalog } from '@/composables/useModelCatalog'
import {
  getDefaultThinkingEffort,
  getModelAvatarPath,
  getModelDisplayName,
  getModelThinkingEfforts,
  getThinkingEffortLabelWithKey,
} from '@/utils/modelUtils'
import type { Agent } from '@/types/agent'
import type { Session } from '@/types/session'
import type { SchedulerComposerValue } from './composer.types'

const DEFAULT_AGENT_ID = 'assistant-agent'

type OutputTarget = 'independent' | 'merged' | 'existing'

const props = defineProps<{
  modelValue: SchedulerComposerValue
  error?: string | null
  promptError?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SchedulerComposerValue]
  'agents-loaded': [agents: Agent[]]
}>()

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const { models, providers, ensureLoaded } = useModelCatalog()

const agents = ref<Agent[]>([])
const agentPopoverVisible = ref(false)
const agentButtonRef = ref<HTMLElement | null>(null)

const workspacePopoverVisible = ref(false)
const workspaceButtonRef = ref<HTMLElement | null>(null)

const permissionPopoverVisible = ref(false)
const permissionButtonRef = ref<HTMLElement | null>(null)

const outputPopoverVisible = ref(false)
const outputButtonRef = ref<HTMLElement | null>(null)
const sessionOptions = ref<Session[]>([])
const sessionKeyword = ref('')
const sessionsLoading = ref(false)
let sessionSearchTimer: ReturnType<typeof setTimeout> | null = null

const modelPopoverVisible = ref(false)
const modelButtonRef = ref<HTMLElement | null>(null)

function patch(partial: Partial<SchedulerComposerValue>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

const isNewSession = computed(() => props.modelValue.targetMode === 'new_session')

const publicPath = computed(() => workspaceStore.getPublicPath())

const displayWorkspacePath = computed(() => {
  const path = props.modelValue.workspacePath
  if (!path) return t('scheduler.composer.autoCreateDir')
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments[segments.length - 1] || path
})

const currentAgent = computed(
  () => agents.value.find((agent) => agent.id === props.modelValue.agentId) || null,
)

const currentModel = computed(
  () => models.value.find((model) => model.id === props.modelValue.modelId) || null,
)

const modelButtonLabel = computed(() =>
  currentModel.value
    ? getModelDisplayName(currentModel.value.modelName)
    : t('scheduler.composer.modelPlaceholder'),
)

const thinkingEffortOptions = computed(() =>
  currentModel.value ? getModelThinkingEfforts(currentModel.value, providers.value) : [],
)

const displayThinkingEffort = computed(() => {
  const options = thinkingEffortOptions.value
  if (options.length === 0) return ''
  if (props.modelValue.thinkingEffort && options.includes(props.modelValue.thinkingEffort)) {
    return props.modelValue.thinkingEffort
  }
  return getDefaultThinkingEffort(options)
})

const outputTarget = computed<OutputTarget>(() => {
  if (props.modelValue.targetMode === 'existing_session') return 'existing'
  return props.modelValue.outputMode === 'merged' ? 'merged' : 'independent'
})

const outputLabel = computed(() => {
  if (outputTarget.value === 'existing') {
    const selected = sessionOptions.value.find(
      (session) => session.id === props.modelValue.targetSessionId,
    )
    return selected?.title || props.modelValue.targetSessionId || t('scheduler.composer.pickSession')
  }
  if (outputTarget.value === 'merged') return t('scheduler.composer.outputMerged')
  return t('scheduler.composer.outputIndependent')
})

function getProviderName(providerId?: string): string {
  if (!providerId) return ''
  return providers.value.find((provider) => provider.id === providerId)?.name || ''
}

function handleAgentSelect(agent: Agent) {
  patch({ agentId: agent.id })
}

function handleWorkspaceSelect(workspacePath: string | null) {
  let mode: 'auto' | 'public' | 'custom'
  if (workspacePath === null) mode = 'auto'
  else if (publicPath.value && workspacePath === publicPath.value) mode = 'public'
  else mode = 'custom'
  workspaceStore.setLastChoice(mode, workspacePath)
  if (workspacePath) workspaceStore.addRecent(workspacePath)
  patch({ workspacePath: workspacePath || '' })
}

function setUnattended(value: boolean) {
  patch({ unattended: value })
  permissionPopoverVisible.value = false
}

function toggleOutputPopover() {
  outputPopoverVisible.value = !outputPopoverVisible.value
  if (outputPopoverVisible.value) void loadSessions()
}

function setOutputTarget(target: OutputTarget) {
  if (target === 'existing') {
    patch({ targetMode: 'existing_session' })
    return
  }
  patch({ targetMode: 'new_session', outputMode: target })
  outputPopoverVisible.value = false
}

function selectSession(session: Session) {
  patch({ targetSessionId: session.id })
  outputPopoverVisible.value = false
}

function handleSessionSearch(value: string) {
  sessionKeyword.value = value
  if (sessionSearchTimer) clearTimeout(sessionSearchTimer)
  sessionSearchTimer = setTimeout(() => void loadSessions(), 250)
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    const response = await apiService.fetchSessions(0, 50, null, sessionKeyword.value || undefined)
    sessionOptions.value = response.items || []
  } catch (error) {
    console.error('加载会话列表失败:', error)
    sessionOptions.value = []
  } finally {
    sessionsLoading.value = false
  }
}

function handleModelSelect(modelId: string) {
  const model = models.value.find((item) => item.id === modelId)
  const options = model ? getModelThinkingEfforts(model, providers.value) : []
  const thinkingEffort = options.includes(props.modelValue.thinkingEffort)
    ? props.modelValue.thinkingEffort
    : ''
  patch({ modelId, thinkingEffort })
  modelPopoverVisible.value = false
}

function handleThinkingEffortChange(effort: string) {
  if (!effort) return
  patch({ thinkingEffort: effort })
}

async function loadAgents() {
  try {
    const response = await apiService.fetchAgents()
    agents.value = response.items || []
    emit('agents-loaded', agents.value)
    if (
      props.modelValue.targetMode === 'new_session' &&
      props.modelValue.agentId &&
      !agents.value.some((agent) => agent.id === props.modelValue.agentId)
    ) {
      patch({ agentId: DEFAULT_AGENT_ID })
    }
  } catch (error) {
    console.error('获取智能体列表失败:', error)
  }
}

onMounted(() => {
  void ensureLoaded().catch((error) => console.error('获取模型列表失败:', error))
  void loadAgents()
  workspaceStore.ensureBaseDir()
  // 编辑「发送到指定会话」的任务时，先加载会话标题，避免胶囊里只显示裸 ID
  if (props.modelValue.targetMode === 'existing_session') {
    void loadSessions()
  }
})
</script>

<style scoped>
.scheduler-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 智能体 + 输出目标：对齐聊天输入框上方的「使用 xx > 开始新会话」 */
.composer-identity {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding-left: 2px;
  min-height: 24px;
}

.identity-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.identity-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  max-width: 220px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.identity-pill:hover {
  background: var(--el-fill-color-light);
}

.identity-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-arrow {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 工作目录 + 远程目录：对齐聊天输入框顶部 */
.composer-context {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 8px 10px 0;
}

.context-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  max-width: 260px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.context-pill:hover {
  background: var(--el-fill-color-light);
  color: var(--gd-color-text);
}

/* 远程目录按钮自带 primary 文字色，这里统一成和工作目录一致的次要色 */
.composer-context :deep(.workspace-btn) {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 500;
}

.composer-context :deep(.workspace-btn:hover) {
  color: var(--gd-color-text);
}

.composer-shell {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--gd-color-input-border, var(--el-border-color));
  border-radius: var(--gd-size-rounded-radius, 12px);
  background: var(--gd-color-input-bg, var(--el-fill-color-blank));
  transition: border-color 0.15s ease;
}

.composer-shell:focus-within {
  border-color: var(--el-color-primary);
}

.composer-shell.has-error {
  border-color: var(--el-color-danger);
  box-shadow: 0 0 0 2px var(--el-color-danger-light-8);
}

.composer-textarea :deep(.el-textarea__inner) {
  box-shadow: none !important;
  background: transparent;
  border: none;
  padding: 12px 14px 6px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--gd-color-text);
}

.composer-textarea :deep(.el-textarea__inner)::placeholder {
  color: var(--el-text-color-placeholder);
}

.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 8px;
}

.composer-tools,
.composer-right {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
}

.composer-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  max-width: 220px;
  padding: 0 9px;
  border: none;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  color: var(--gd-color-text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.composer-pill:hover {
  background: var(--el-fill-color);
}

.pill-warn {
  color: var(--el-color-warning);
}

.pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-label {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

.model-pill {
  max-width: 260px;
}

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--gd-color-text);
  text-align: left;
  cursor: pointer;
}

.option-row:hover {
  background: var(--el-fill-color-light);
}

.option-row.active {
  background: var(--el-fill-color-light);
}

.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option-title {
  font-size: 13px;
  font-weight: 500;
}

.option-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.session-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.session-list {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.session-row:hover,
.session-row.active {
  background: var(--el-fill-color-light);
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-empty {
  padding: 10px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.composer-hint,
.composer-error,
.composer-prompt-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.composer-prompt-error {
  padding: 0 14px 6px;
  color: var(--el-color-danger);
}

.composer-error {
  color: var(--el-color-danger);
}
</style>
