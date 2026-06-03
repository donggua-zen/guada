<template>
  <div class="flex-1 overflow-hidden">
    <!-- 头部区域 -->
    <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
      <div class="flex items-center gap-3">
        <span>OCR 设置</span>
        <el-link type="info" :underline="'never'" @click="openOcrDocs" class="flex items-center whitespace-nowrap text-sm">
          <el-icon class="mr-1"><QuestionCircleOutlined /></el-icon>
          <span>使用说明</span>
        </el-link>
      </div>
      <el-button type="primary" @click="handleSave" :disabled="!hasChanges">
        <template #icon>
          <SaveOutlined />
        </template>
        保存设置
      </el-button>
    </div>

    <div class="space-y-6">
      <!-- OCR 提供商选择 -->
      <div class="px-8 py-4 rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428]">
        <el-form ref="formRef" :model="settingsForm" label-position="left" label-width="50%" size="large">
          <el-form-item prop="provider" style="margin-bottom: 16px;">
            <template #label>
              <div class="flex flex-col gap-1">
                <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">OCR 提供商</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                  选择用于识别扫描件 PDF 的 OCR 服务
                </span>
              </div>
            </template>
            <el-select v-model="settingsForm.provider" placeholder="请选择 OCR 提供商" style="width: 240px;">
              <el-option label="不启用 OCR" value="none" />
              <el-option label="UMI-OCR（本地）" value="umi" />
            </el-select>
          </el-form-item>

          <!-- UMI-OCR 配置 -->
          <template v-if="settingsForm.provider === 'umi'">
            <el-form-item prop="umiHost" style="margin-bottom: 16px;">
              <template #label>
                <div class="flex flex-col gap-1">
                  <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">服务地址</span>
                  <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                    UMI-OCR 服务的主机地址
                  </span>
                </div>
              </template>
              <el-input v-model="settingsForm.umiHost" placeholder="127.0.0.1" style="width: 240px;" />
            </el-form-item>

            <el-form-item prop="umiPort" style="margin-bottom: 0;">
              <template #label>
                <div class="flex flex-col gap-1">
                  <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">服务端口</span>
                  <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                    UMI-OCR 服务的端口号
                  </span>
                </div>
              </template>
              <el-input-number v-model="settingsForm.umiPort" :min="1" :max="65535" placeholder="1224" />
            </el-form-item>
          </template>

          <!-- 百度 OCR 配置（暂时隐藏） -->
          <template v-if="false">
            <el-form-item prop="baiduApiKey" style="margin-bottom: 16px;">
              <template #label>
                <div class="flex flex-col gap-1">
                  <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">API Key</span>
                  <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                    百度智能云应用的 API Key
                  </span>
                </div>
              </template>
              <el-input v-model="settingsForm.baiduApiKey" placeholder="请输入 API Key" style="width: 320px;" />
            </el-form-item>

            <el-form-item prop="baiduSecretKey" style="margin-bottom: 0;">
              <template #label>
                <div class="flex flex-col gap-1">
                  <span class="text-lg text-gray-900 dark:text-[#e8e9ed]">Secret Key</span>
                  <span class="text-xs text-gray-500 dark:text-[#8b8d95] font-normal">
                    百度智能云应用的 Secret Key
                  </span>
                </div>
              </template>
              <el-input v-model="settingsForm.baiduSecretKey" placeholder="请输入 Secret Key" type="password" show-password style="width: 320px;" />
            </el-form-item>
          </template>
        </el-form>

        <!-- 提示信息 -->
        <div class="mt-4 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded border border-gray-200 dark:border-gray-700">
          <template v-if="settingsForm.provider === 'none'">
            <div>• 不启用 OCR 时，扫描件 PDF 将无法被识别和索引</div>
          </template>
          <template v-else>
            <div>• 请确保 UMI-OCR 服务已启动（Umi-OCR.exe --server）</div>
            <div>• 默认监听地址：http://127.0.0.1:1224</div>
            <div>• 支持 PDF 和图片的 OCR 识别</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { SaveOutlined, QuestionCircleOutlined } from '@vicons/antd'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { openExternalLink } from '@/utils/modelUtils'

const { notify } = usePopup()

// 表单引用
const formRef = ref(null)

// 表单数据
const settingsForm = reactive({
  provider: 'none',
  umiHost: '127.0.0.1',
  umiPort: 1224,
  baiduApiKey: '',
  baiduSecretKey: '',
})

// 原始设置备份，用于对比是否有改动
const originalSettings = ref<any>(null)

// 计算是否有改动
const hasChanges = computed(() => {
  if (!originalSettings.value) return false
  return JSON.stringify(settingsForm) !== JSON.stringify(originalSettings.value)
})

// 打开 OCR 使用说明
const openOcrDocs = () => {
  openExternalLink('https://ai.dingd.cn/docs/ocr')
}

// 加载 OCR 分组设置
const loadSettings = async () => {
  try {
    const response = await apiService.fetchGroupSettings('ocr')

    // 填充表单
    settingsForm.provider = response.provider || 'none'
    settingsForm.umiHost = response.umiHost || '127.0.0.1'
    settingsForm.umiPort = response.umiPort || 1224
    settingsForm.baiduApiKey = response.baiduApiKey || ''
    settingsForm.baiduSecretKey = response.baiduSecretKey || ''

    // 备份原始数据
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
  } catch (error) {
    console.error('获取 OCR 设置失败:', error)
    // OCR 分组可能不存在，使用默认值
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
  }
}

// 保存设置
const handleSave = async () => {
  try {
    // 构造保存数据
    const dataToSave: Record<string, any> = {
      provider: settingsForm.provider,
    }

    if (settingsForm.provider === 'umi') {
      dataToSave.umiHost = settingsForm.umiHost || '127.0.0.1'
      dataToSave.umiPort = settingsForm.umiPort || 1224
    } else if (settingsForm.provider === 'baidu') {
      dataToSave.baiduApiKey = settingsForm.baiduApiKey || ''
      dataToSave.baiduSecretKey = settingsForm.baiduSecretKey || ''
    }

    // 使用分组设置接口更新 ocr 分组
    await apiService.updateGroupSettings('ocr', dataToSave)

    // 保存成功后更新原始数据备份
    originalSettings.value = JSON.parse(JSON.stringify(settingsForm))

    notify.success('保存成功', 'OCR 设置已更新')
  } catch (error: any) {
    console.error('保存 OCR 设置失败:', error)
    notify.error('保存失败', error.message || '未知错误')
  }
}

// 生命周期
onMounted(() => {
  loadSettings()
})
</script>
