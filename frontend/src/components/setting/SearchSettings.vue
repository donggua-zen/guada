<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 搜索设置分组 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">搜索设置</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
          <!-- 网络搜索插件开关 -->
          <div
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">网络搜索插件</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">启用后 AI 助手可以通过搜索获取实时信息。你也可以在「插件 →
                本地工具」中管理此开关。</span>
            </div>
            <el-switch v-model="pluginEnabled" :loading="pluginLoading" @update:model-value="handlePluginToggle"
              size="large" />
          </div>

          <!-- 搜索供应商 -->
          <div
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">搜索供应商</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">切换供应商不会丢失另一方的 API Key 配置</span>
            </div>
            <el-select v-model="selectedProvider" @update:model-value="handleProviderChange" style="width: 220px;"
              class="shrink-0">
              <el-option label="博查 (Bocha)" value="bocha" />
              <el-option label="Tavily" value="tavily" />
              <el-option label="秘塔搜索 (Metaso)" value="metaso" />
            </el-select>
          </div>

          <!-- 秘塔 API Key -->
          <div v-if="selectedProvider === 'metaso'"
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">秘塔 API Key</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">秘塔搜索 API 密钥。<span
                  class="text-[#409eff] cursor-pointer hover:underline" @click="openMetasoUrl">前往获取</span></span>
            </div>
            <el-input v-model="providerKeys.metaso" type="password" show-password placeholder="mk-..."
              style="width: 360px;" class="shrink-0" clearable />
          </div>

          <!-- 博查 API Key -->
          <div v-if="selectedProvider === 'bocha'"
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">博查 API Key</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">博查搜索 API 密钥。<span
                  class="text-[#409eff] cursor-pointer hover:underline" @click="openBochaUrl">前往获取</span></span>
            </div>
            <el-input v-model="providerKeys.bocha" type="password" show-password placeholder="sk-..."
              style="width: 360px;" class="shrink-0" clearable />
          </div>

          <!-- Tavily API Key -->
          <div v-if="selectedProvider === 'tavily'"
            class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">Tavily API Key</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">Tavily Search API 密钥。<span
                  class="text-[#409eff] cursor-pointer hover:underline" @click="openTavilyUrl">前往获取</span></span>
            </div>
            <el-input v-model="providerKeys.tavily" type="password" show-password placeholder="tvly-..."
              style="width: 360px;" class="shrink-0" clearable />
          </div>

          <!-- 提示信息 -->
          <div class="px-4 py-3.5 bg-gray-50 dark:bg-[#1e1f23]">
            <div class="text-xs text-gray-500 dark:[#8b8d95] space-y-1">
              <template v-if="selectedProvider === 'bocha'">
                <div>• 博查搜索专为 AI 设计的搜索引擎，国内直连，中文搜索质量优秀</div>
              </template>
              <template v-else-if="selectedProvider === 'tavily'">
                <div>• Tavily 适合英文内容搜索，免费额度 1000 次/月</div>
              </template>
              <template v-else>
                <div>• 秘塔搜索适合中文内容搜索，需要购买积分或开通会员</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { apiService } from '@/services/ApiService'
import { usePopup } from '@/composables/usePopup'
import { openExternalLink } from '@/utils/modelUtils'
import { ElMessage } from 'element-plus'

const { notify } = usePopup()

// 当前选中的供应商
const selectedProvider = ref('bocha')

// 各供应商 API Key 独立存储（切换供应商时不会丢失）
const providerKeys = reactive({
  bocha: '',
  tavily: '',
  metaso: '',
})

// 原始备份，用于检测变更
const originalSettings = ref<any>(null)

// 插件状态
const pluginEnabled = ref(false)
const pluginLoading = ref(false)

// 自动保存（防抖 500ms）
const debouncedSave = useDebounceFn(async () => {
  await handleSave()
}, 500)

// 监听 API Key 变化自动保存
watch(() => [providerKeys.bocha, providerKeys.tavily, providerKeys.metaso], () => {
  debouncedSave()
})

// 打开链接
const openBochaUrl = () => openExternalLink('https://open.bochaai.com')
const openMetasoUrl = () => openExternalLink('https://metaso.cn/search-api')
const openTavilyUrl = () => openExternalLink('https://app.tavily.com')

// 切换供应商即时保存 + 触发插件重载以重新注册工具
const handleProviderChange = async (val: string) => {
  selectedProvider.value = val
  await handleSave()
  try {
    await apiService.reloadPlugin('web-search')
  } catch (error: any) {
    console.error('重新加载插件失败:', error)
  }
}

// 加载设置
const loadSettings = async () => {
  try {
    const response = await apiService.fetchGroupSettings('search')
    selectedProvider.value = response.provider || 'bocha'
    providerKeys.bocha = response.bocha?.apiKey || ''
    providerKeys.tavily = response.tavily?.apiKey || ''
    providerKeys.metaso = response.metaso?.apiKey || ''
    originalSettings.value = JSON.parse(JSON.stringify({
      provider: selectedProvider.value,
      bocha: { apiKey: providerKeys.bocha },
      tavily: { apiKey: providerKeys.tavily },
      metaso: { apiKey: providerKeys.metaso },
    }))
  } catch (error) {
    console.error('获取搜索设置失败:', error)
    originalSettings.value = JSON.parse(JSON.stringify({
      provider: 'bocha',
      bocha: { apiKey: '' },
      tavily: { apiKey: '' },
      metaso: { apiKey: '' },
    }))
  }

  // 加载插件状态
  try {
    const pluginsRes = await apiService.queryPlugins()
    const plugin = pluginsRes.plugins?.find((p: any) => p.pluginId === 'web-search')
    if (plugin) {
      pluginEnabled.value = plugin.enabled
    }
  } catch (error) {
    console.error('获取插件状态失败:', error)
  }
}

// 保存设置
const handleSave = async () => {
  try {
    const dataToSave: Record<string, any> = {
      provider: selectedProvider.value,
      bocha: { apiKey: providerKeys.bocha || '' },
      tavily: { apiKey: providerKeys.tavily || '' },
      metaso: { apiKey: providerKeys.metaso || '' },
    }

    await apiService.updateGroupSettings('search', dataToSave)
    originalSettings.value = JSON.parse(JSON.stringify({
      provider: selectedProvider.value,
      bocha: { apiKey: providerKeys.bocha },
      tavily: { apiKey: providerKeys.tavily },
      metaso: { apiKey: providerKeys.metaso },
    }))
  } catch (error: any) {
    console.error('保存搜索设置失败:', error)
    notify.error('保存失败', error.message || '未知错误')
  }
}

// 切换插件状态
const handlePluginToggle = async (enabled: boolean) => {
  pluginLoading.value = true
  try {
    const res = await apiService.updateGlobalToolStatus('web-search', enabled)
    if (res?.success) {
      pluginEnabled.value = enabled
      ElMessage.success(enabled ? '网络搜索插件已启用' : '网络搜索插件已禁用')
    }
  } catch (error: any) {
    pluginEnabled.value = !enabled
    console.error('切换插件状态失败:', error)
    notify.error('插件状态切换失败', error.message || '未知错误')
  } finally {
    pluginLoading.value = false
  }
}

// 生命周期
onMounted(() => {
  loadSettings()
})
</script>
