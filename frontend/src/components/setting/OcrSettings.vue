<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- OCR 设置分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">OCR 服务</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
          <!-- OCR 提供商 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">OCR 提供商</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">选择用于识别扫描件 PDF 的 OCR 服务，<span class="text-[#409eff] cursor-pointer hover:underline" @click="openOcrDocs">查看使用说明</span></span>
            </div>
            <el-select v-model="settingsForm.provider" placeholder="请选择 OCR 提供商" style="width: 200px;" class="shrink-0">
              <el-option label="不启用 OCR" value="none" />
              <el-option label="UMI-OCR（本地）" value="umi" />
            </el-select>
          </div>

          <!-- UMI-OCR 配置 -->
          <template v-if="settingsForm.provider === 'umi'">
            <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
              <div class="flex flex-col gap-1 min-w-0">
                <span class="text-base text-gray-900 dark:text-[#e8e9ed]">服务地址</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">UMI-OCR 服务的主机地址</span>
              </div>
              <el-input v-model="settingsForm.umiHost" placeholder="127.0.0.1" style="width: 200px;" class="shrink-0" />
            </div>

            <div class="px-4 py-3.5 flex items-center justify-between gap-4">
              <div class="flex flex-col gap-1 min-w-0">
                <span class="text-base text-gray-900 dark:text-[#e8e9ed]">服务端口</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">UMI-OCR 服务的端口号</span>
              </div>
              <el-input-number v-model="settingsForm.umiPort" :min="1" :max="65535" placeholder="1224" class="shrink-0" />
            </div>
          </template>

          <!-- 百度 OCR 配置（暂时隐藏） -->
          <template v-if="false">
            <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
              <div class="flex flex-col gap-1 min-w-0">
                <span class="text-base text-gray-900 dark:text-[#e8e9ed]">API Key</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">百度智能云应用的 API Key</span>
              </div>
              <el-input v-model="settingsForm.baiduApiKey" placeholder="请输入 API Key" style="width: 320px;" class="shrink-0" />
            </div>

            <div class="px-4 py-3.5 flex items-center justify-between gap-4">
              <div class="flex flex-col gap-1 min-w-0">
                <span class="text-base text-gray-900 dark:text-[#e8e9ed]">Secret Key</span>
                <span class="text-xs text-gray-500 dark:text-[#8b8d95]">百度智能云应用的 Secret Key</span>
              </div>
              <el-input v-model="settingsForm.baiduSecretKey" placeholder="请输入 Secret Key" type="password" show-password style="width: 320px;" class="shrink-0" />
            </div>
          </template>

          <!-- 提示信息 -->
          <div class="px-4 py-3.5 bg-gray-50 dark:bg-[#1e1f23] border-t border-gray-100 dark:border-[#2e3035]">
            <div class="text-xs text-gray-500 dark:text-[#8b8d95] space-y-1">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
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

// 自动保存（防抖 300ms）
const debouncedSave = useDebounceFn(async () => {
  if (!hasChanges.value) return
  await handleSave()
}, 300)

// 监听设置变化自动保存
watch(() => ({
  provider: settingsForm.provider,
  umiHost: settingsForm.umiHost,
  umiPort: settingsForm.umiPort,
}), () => {
  debouncedSave()
}, { deep: true })

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
