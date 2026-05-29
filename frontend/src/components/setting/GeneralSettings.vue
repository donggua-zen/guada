<template>
  <div class="flex-1 overflow-hidden">
    <!-- 头部区域 -->
    <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
      <span>通用设置</span>
      <el-button type="primary" @click="handleSave" :disabled="!hasChanges">
        <template #icon>
          <SaveOutlined />
        </template>
        保存设置
      </el-button>
    </div>

    <div class="space-y-6">
      <!-- 免登录设置 -->
      <div class="px-8 py-4 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428]">
        <el-form ref="autoLoginFormRef" :model="settingsForm" label-position="left" label-width="50%" size="large">
          <el-form-item prop="autoLoginEnabled" style="margin-bottom: 0;">
            <template #label>
              <div class="flex flex-col gap-1">
                <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">免登录模式</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                  开启后，刷新页面或访问应用时会自动使用主账户登录
                </span>
              </div>
            </template>
            <el-switch v-model="settingsForm.autoLoginEnabled" size="large" />
          </el-form-item>
        </el-form>

        <!-- 警告提示 -->
        <div class="mt-4 text-xs text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 rounded border border-orange-200 dark:border-orange-800">
          <el-icon class="inline-block mr-1" :size="14">
            <WarningOutlined />
          </el-icon>
          注意：开启此功能后，任何访问此应用的人都将自动获得主账户权限，请谨慎使用。
        </div>
      </div>

      <!-- 工作目录基路径设置 -->
      <div class="px-8 py-4 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428]">
        <el-form ref="workspaceFormRef" :model="settingsForm" label-position="left" label-width="50%" size="large">
          <el-form-item prop="workspaceBaseDir" style="margin-bottom: 0;">
            <template #label>
              <div class="flex flex-col gap-1">
                <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">工作目录基路径</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                  所有新会话的默认工作目录将创建在此路径下
                </span>
              </div>
            </template>
            <div class="flex gap-2 w-full max-w-md">
              <el-input
                v-model="settingsForm.workspaceBaseDir"
                placeholder="例如：D:\AI_Workspaces（留空使用系统默认）"
                clearable
              />
              <el-button @click="selectFolder" type="primary" plain>
                选择文件夹
              </el-button>
            </div>
          </el-form-item>
        </el-form>

        <!-- 提示信息 -->
        <div class="mt-4 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded border border-gray-200 dark:border-gray-700">
          <div>• 必须使用绝对路径</div>
          <div>• 修改后仅影响新创建的会话目录</div>
          <div>• 已有会话的默认目录不会自动迁移</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { SaveOutlined } from '@vicons/antd'
import { WarningOutlined } from '@vicons/material'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { notify } = usePopup()

// 表单引用
const autoLoginFormRef = ref(null)
const workspaceFormRef = ref(null)

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

// 加载 system 分组设置
const loadSettings = async () => {
  try {
    const response = await apiService.fetchGroupSettings('system')

    // 填充表单
    settingsForm.autoLoginEnabled = response.autoLoginEnabled === true || response.autoLoginEnabled === 'true'
    settingsForm.workspaceBaseDir = response.workspaceBaseDir || ''

    // 备份原始数据
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
  } catch (error) {
    console.error('获取通用设置失败:', error)
    notify.error('获取通用设置失败')
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
