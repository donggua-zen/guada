<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 语言设置 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('common.language') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.general.language') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.general.languageDesc') }}</span>
            </div>
            <div class="shrink-0 w-52">
              <el-select v-model="selectedLanguage" @change="handleLanguageChange" size="default">
                <el-option label="简体中文" value="zh-CN" />
                <el-option label="English" value="en-US" />
              </el-select>
            </div>
          </div>
        </div>
      </div>

      <!-- 登录设置分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.general.login') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <!-- 免登录模式 -->
          <div
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] last:border-b-0">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.general.autoLoginMode') }}</span>
              <span
                class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.general.autoLoginDesc') }}</span>
            </div>
            <el-switch v-model="settingsForm.autoLoginEnabled" size="large" />
          </div>

        </div>
      </div>

      <!-- 工作目录分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.general.workspace') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <!-- 工作目录基路径 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.general.workspaceBaseDir') }}</span>
              <span
                class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.general.workspaceBaseDirDesc') }}</span>
            </div>
            <div class="flex gap-2 shrink-0 max-w-md w-full">
              <el-input v-model="settingsForm.workspaceBaseDir" :placeholder="t('settings.general.workspaceBaseDirPlaceholder')" clearable />
              <el-button @click="selectFolder" type="primary" plain>
                {{ t('settings.general.selectFolder') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Agent 设置分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.general.agent') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <!-- 最大工具调用轮次 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] last:border-b-0">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.general.maxToolIterations') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.general.maxToolIterationsDesc') }}</span>
            </div>
            <div class="shrink-0">
              <el-input-number v-model="settingsForm.maxToolIterations" :min="1" :max="500" :step="1" size="default" controls-position="right" />
            </div>
          </div>
          <!-- 请求超时 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] last:border-b-0">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.general.llmRequestTimeout') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.general.llmRequestTimeoutDesc') }}</span>
            </div>
            <div class="shrink-0">
              <el-input-number v-model="settingsForm.llmRequestTimeoutMs" :min="10" :max="3600" :step="10" size="default" controls-position="right">
                <template #suffix>{{ t('settings.general.secondsUnit') }}</template>
              </el-input-number>
            </div>
          </div>
          <!-- 空闲超时 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.general.llmIdleTimeout') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.general.llmIdleTimeoutDesc') }}</span>
            </div>
            <div class="shrink-0">
              <el-input-number v-model="settingsForm.llmIdleTimeoutMs" :min="5" :max="600" :step="5" size="default" controls-position="right">
                <template #suffix>{{ t('settings.general.secondsUnit') }}</template>
              </el-input-number>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { useAuthStore } from '@/stores/auth'
import { useLanguage } from '@/composables/useLanguage'

const authStore = useAuthStore()
const { notify } = usePopup()
const { t } = useI18n()
const { locale: currentLocale, setLanguage } = useLanguage()
const selectedLanguage = ref(currentLocale.value)

function handleLanguageChange(val: string) {
  setLanguage(val as 'zh-CN' | 'en-US')
}

// 表单数据
const settingsForm = reactive({
  autoLoginEnabled: false,
  workspaceBaseDir: '',
  maxToolIterations: 100,
  llmRequestTimeoutMs: 600,   // 秒（后端存储为毫秒）
  llmIdleTimeoutMs: 120,     // 秒
})

// 原始设置备份，用于对比是否有改动
const originalSettings = ref<any>(null)

// 计算是否有改动
const hasChanges = computed(() => {
  if (!originalSettings.value) return false
  return JSON.stringify(settingsForm) !== JSON.stringify(originalSettings.value)
})

// 自动保存（防抖 300ms）
const debouncedSave = useDebounceFn(async () => {
  if (!hasChanges.value) return
  await handleSave()
}, 300)

// 监听设置变化自动保存
watch(() => ({ autoLoginEnabled: settingsForm.autoLoginEnabled, workspaceBaseDir: settingsForm.workspaceBaseDir, maxToolIterations: settingsForm.maxToolIterations, llmRequestTimeoutMs: settingsForm.llmRequestTimeoutMs, llmIdleTimeoutMs: settingsForm.llmIdleTimeoutMs }), () => {
  debouncedSave()
}, { deep: true })

// 加载 system 分组设置
const loadSettings = async () => {
  try {
    const response = await apiService.fetchGroupSettings('system')

    // 填充表单
    settingsForm.autoLoginEnabled = response.autoLoginEnabled === true || response.autoLoginEnabled === 'true'
    settingsForm.workspaceBaseDir = response.workspaceBaseDir || ''
    settingsForm.maxToolIterations = Number(response.maxToolIterations) || 100
    settingsForm.llmRequestTimeoutMs = Math.round(Number(response.llmRequestTimeoutMs) / 1000) || 600
    settingsForm.llmIdleTimeoutMs = Math.round(Number(response.llmIdleTimeoutMs) / 1000) || 120
    // 备份原始数据
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
  } catch (error: any) {
    console.error('获取通用设置失败:', error)
    notify.error(t('settings.general.loadFailed'), error.message || t('common.error.unknown'))
  }
}

// 选择文件夹
const selectFolder = async () => {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI
  if (isElectron && window.electronAPI?.selectFolder) {
    try {
      const selectedPath = await window.electronAPI.selectFolder()
      if (selectedPath) {
        settingsForm.workspaceBaseDir = selectedPath
        ElMessage.success(t('settings.general.folderSelected'))
      }
    } catch (error) {
      ElMessage.error(t('settings.general.selectFolderFailed'))
    }
  } else {
    ElMessage.warning(t('settings.general.folderSelectNotSupported'))
  }
}

// 保存设置
const handleSave = async () => {
  try {
    // 验证工作目录基路径
    const path = settingsForm.workspaceBaseDir.trim()
    if (path) {
      const isAbsolute = /^[a-zA-Z]:\\/.test(path) || path.startsWith('/')
      if (!isAbsolute) {
        ElMessage.error(t('settings.general.pathMustBeAbsolute'))
        return
      }
    }

    // 构造保存数据
    const dataToSave = {
      autoLoginEnabled: settingsForm.autoLoginEnabled,
      workspaceBaseDir: path || null,
      maxToolIterations: settingsForm.maxToolIterations,
      llmRequestTimeoutMs: settingsForm.llmRequestTimeoutMs * 1000,
      llmIdleTimeoutMs: settingsForm.llmIdleTimeoutMs * 1000,
    }

    // 使用分组设置接口更新 system 分组
    await apiService.updateGroupSettings('system', dataToSave)

    // 保存成功后更新原始数据备份
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))

    // 同步更新 authStore 中的免登录状态
    authStore.autoLoginEnabled = settingsForm.autoLoginEnabled

    notify.success(t('common.saveSuccess'), t('settings.general.updated'))
  } catch (error: any) {
    console.error('保存设置失败:', error)
    notify.error(t('common.saveFailed'), error.message || t('common.error.unknown'))
  }
}

// 生命周期
onMounted(() => {
  loadSettings()
})
</script>
