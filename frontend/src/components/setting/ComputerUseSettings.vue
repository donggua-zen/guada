<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <el-alert
        v-if="!isElectron"
        type="info"
        :closable="false"
        show-icon
        :title="t('settings.computerUse.desktopOnly')"
      />

      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">
          {{ t('settings.computerUse.title') }}
        </h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.computerUse.enable') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.computerUse.enableDesc') }}</span>
            </div>
            <el-switch v-model="enabled" :disabled="!isElectron" @change="onEnabledChange" />
          </div>

          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.computerUse.sidecarStatus') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95] break-all">{{ statusText }}</span>
            </div>
            <el-tag :type="status?.available ? 'success' : 'warning'" size="small">
              {{ status?.available ? t('settings.computerUse.statusReadyShort') : t('settings.computerUse.statusUnavailableShort') }}
            </el-tag>
          </div>

          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.computerUse.systemPermission') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.computerUse.systemPermissionDesc') }}</span>
            </div>
            <el-tag :type="isWindows ? 'success' : 'info'" size="small">
              {{ isWindows ? t('settings.computerUse.permissionNone') : t('settings.computerUse.permissionUnsupported') }}
            </el-tag>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">
          {{ t('settings.computerUse.actionsTitle') }}
        </h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div
            v-for="(row, index) in actionRows"
            :key="row.key"
            class="px-4 py-3.5 flex items-center justify-between gap-4"
            :class="index < actionRows.length - 1 ? 'border-b border-gray-100 dark:border-[#2e3035]' : ''"
          >
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ row.label }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ row.description }}</span>
            </div>
            <el-select v-model="actions[row.key]" :disabled="!isElectron" style="width: 130px">
              <el-option :label="t('settings.computerUse.allow')" value="allow" />
              <el-option :label="t('settings.computerUse.ask')" value="ask" />
              <el-option :label="t('settings.computerUse.deny')" value="deny" />
            </el-select>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">
          {{ t('settings.computerUse.testTitle') }}
        </h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) p-4 space-y-3">
          <p class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.computerUse.testDesc') }}</p>
          <div class="flex items-center gap-3 flex-wrap">
            <el-button type="primary" :loading="testing" :disabled="!isElectron" @click="runTest">
              {{ t('settings.computerUse.testButton') }}
            </el-button>
            <el-tag v-if="testResult" :type="testResult.ok ? 'success' : 'danger'" size="small">
              {{ testResult.ok ? t('settings.computerUse.testOk') : t('settings.computerUse.testFailed') }}
            </el-tag>
          </div>
          <p v-if="testResult" class="text-xs text-gray-500 dark:text-[#8b8d95] whitespace-pre-wrap break-all">
            {{ testSummary }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <el-button type="primary" :loading="saving" :disabled="!isElectron" @click="save">
          {{ t('common.save') }}
        </el-button>
        <el-button :disabled="!isElectron" @click="reset">{{ t('common.reset') }}</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import {
  COMPUTER_POLICY_KEYS,
  DEFAULT_COMPUTER_POLICY,
  normalizeComputerUseSettings,
  type ComputerPolicy,
  type ComputerPolicyKey,
} from '@/utils/computerUse'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const isWindows = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
const { t } = useI18n()

const enabled = ref(false)
const actions = reactive<ComputerPolicy>({ ...DEFAULT_COMPUTER_POLICY })
const saving = ref(false)
const testing = ref(false)
const status = ref<any>(null)
const testResult = ref<any>(null)

const actionRows = computed(() =>
  COMPUTER_POLICY_KEYS.map((key: ComputerPolicyKey) => ({
    key,
    label: t(`settings.computerUse.actions.${key}`),
    description: t(`settings.computerUse.actionDescriptions.${key}`),
  }))
)

const statusText = computed(() => {
  if (!status.value) return t('settings.computerUse.statusUnknown')
  if (status.value.available) {
    return t('settings.computerUse.statusReady', { version: status.value.version ?? '?' })
  }
  return status.value.error || t('settings.computerUse.statusUnavailable')
})

const testSummary = computed(() => {
  const result = testResult.value
  if (!result) return ''
  if (!result.ok) return result.error || t('settings.computerUse.testFailed')
  const parts: string[] = []
  if (result.version) parts.push(`v${result.version}`)
  if (result.width && result.height) parts.push(`${result.width}x${result.height}`)
  if (typeof result.treeCount === 'number') {
    parts.push(t('settings.computerUse.testTreeCount', { count: result.treeCount }))
  }
  if (result.screenshotPath) parts.push(result.screenshotPath)
  return parts.join(' · ')
})

async function load(): Promise<void> {
  let groupEnabled: boolean | undefined
  try {
    const group = await apiService.fetchGroupSettings<Record<string, unknown>>('computerUse')
    const settings = normalizeComputerUseSettings(group)
    Object.assign(actions, settings.actions)
    if (typeof group.enabled === 'boolean') groupEnabled = group.enabled
  } catch {
    // Backend unavailable: keep the conservative defaults.
  }

  // The plugin master switch is the runtime gate. Read its real state so the
  // page matches the generic plugin list even if the settings group is stale.
  try {
    const result = await apiService.queryPlugins()
    const plugin = result.plugins.find((item) => item.pluginId === 'computer')
    enabled.value = plugin ? plugin.enabled : (groupEnabled ?? false)
  } catch {
    enabled.value = groupEnabled ?? false
  }

  if (isElectron && window.electronAPI?.getComputerUseStatus) {
    try {
      status.value = await window.electronAPI.getComputerUseStatus()
    } catch (error: any) {
      status.value = { available: false, error: error?.message ?? String(error) }
    }
  }
}

async function persist(): Promise<void> {
  await apiService.updateGroupSettings('computerUse', {
    enabled: enabled.value,
    actions: { ...actions },
  })
  await apiService.updateGlobalToolStatus('computer', enabled.value)
}

async function onEnabledChange(value: boolean | string | number): Promise<void> {
  enabled.value = value === true
  try {
    await persist()
    ElMessage.success(t('settings.computerUse.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await persist()
    ElMessage.success(t('settings.computerUse.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function reset(): Promise<void> {
  enabled.value = false
  Object.assign(actions, DEFAULT_COMPUTER_POLICY)
  await save()
}

async function runTest(): Promise<void> {
  if (!window.electronAPI?.testComputerUse) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await window.electronAPI.testComputerUse()
  } catch (error: any) {
    testResult.value = { ok: false, error: error?.message ?? String(error) }
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>
