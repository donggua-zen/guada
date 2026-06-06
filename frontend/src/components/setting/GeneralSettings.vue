<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 登录设置分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">登录</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
          <!-- 免登录模式 -->
          <div
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035] last:border-b-0">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">免登录模式</span>
              <span
                class="text-xs text-gray-500 dark:text-[#8b8d95]">开启后，刷新页面或访问应用时会自动使用主账户登录。开启此功能后，任何访问此应用的人都将自动获得主账户权限，请谨慎使用。</span>
            </div>
            <el-switch v-model="settingsForm.autoLoginEnabled" size="large" />
          </div>

        </div>
      </div>

      <!-- 工作目录分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">工作目录</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
          <!-- 工作目录基路径 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">工作目录基路径</span>
              <span
                class="text-xs text-gray-500 dark:text-[#8b8d95]">所有新会话的默认工作目录将创建在此路径下。必须使用绝对路径，修改后仅影响新创建的会话目录。</span>
            </div>
            <div class="flex gap-2 shrink-0 max-w-md w-full">
              <el-input v-model="settingsForm.workspaceBaseDir" placeholder="例如：D:\AI_Workspaces（留空使用系统默认）" clearable />
              <el-button @click="selectFolder" type="primary" plain>
                选择文件夹
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { notify } = usePopup()

// 表单数据
const settingsForm = reactive({
  autoLoginEnabled: false,
  workspaceBaseDir: '',
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
watch(() => ({ autoLoginEnabled: settingsForm.autoLoginEnabled, workspaceBaseDir: settingsForm.workspaceBaseDir }), () => {
  debouncedSave()
}, { deep: true })

// 加载 system 分组设置
const loadSettings = async () => {
  try {
    const response = await apiService.fetchGroupSettings('system')

    // 填充表单
    settingsForm.autoLoginEnabled = response.autoLoginEnabled === true || response.autoLoginEnabled === 'true'
    settingsForm.workspaceBaseDir = response.workspaceBaseDir || ''
    // 备份原始数据
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
  } catch (error: any) {
    console.error('获取通用设置失败:', error)
    notify.error('获取通用设置失败', error.message || '未知错误')
  }
}

// 选择文件夹
const selectFolder = async () => {
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
  if (isElectron && (window as any).electronAPI?.selectFolder) {
    try {
      const selectedPath = await (window as any).electronAPI.selectFolder()
      if (selectedPath) {
        settingsForm.workspaceBaseDir = selectedPath
        ElMessage.success('已选择文件夹')
      }
    } catch (error) {
      ElMessage.error('选择文件夹失败')
    }
  } else {
    ElMessage.warning('当前环境不支持文件夹选择，请直接输入路径')
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
        ElMessage.error('工作目录基路径必须是绝对路径')
        return
      }
    }

    // 构造保存数据
    const dataToSave = {
      autoLoginEnabled: settingsForm.autoLoginEnabled,
      workspaceBaseDir: path || null,
    }

    // 使用分组设置接口更新 system 分组
    await apiService.updateGroupSettings('system', dataToSave)

    // 保存成功后更新原始数据备份
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))

    // 同步更新 authStore 中的免登录状态
    authStore.autoLoginEnabled = settingsForm.autoLoginEnabled

    notify.success('保存成功', '通用设置已更新')
  } catch (error: any) {
    console.error('保存设置失败:', error)
    notify.error('保存失败', error.message || '未知错误')
  }
}

// 生命周期
onMounted(() => {
  loadSettings()
})
</script>
