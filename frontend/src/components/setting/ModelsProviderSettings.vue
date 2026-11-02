<template>
  <div class="h-full overflow-hidden flex flex-col">
    <template v-if="!showDetail">
      <!-- 标题区（固定不滚动） -->
      <div class="shrink-0 flex items-center justify-between gap-4 mb-8 mt-2 px-4 w-full md:max-w-220 md:mx-auto">
        <div class="min-w-0">
          <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.models.providers') }}</h1>
          <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('settings.models.providersDesc') }}</p>
        </div>
        <GdButton type="primary" @click="handleCreateGroup">
          <template #icon><Add16Regular /></template>
          {{ t('settings.models.addCustom') }}
        </GdButton>
      </div>

      <!-- 内容区（独立滚动，满屏宽度） -->
      <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable both-edges;">
        <div class="px-4 pb-4 w-full md:max-w-220 md:mx-auto">
          <ModelsProviderList :items="providers" :templates="availableTemplates"
            :protocols="providerProtocols"
            @item-click="handleItemClick"
            @item-toggle="handleToggleProvider"
            @item-edit="handleEditProvider"
            @item-delete="handleDeleteProviderFromList"
            @template-click="handleTemplateClick">
          </ModelsProviderList>
        </div>
      </div>
    </template>
    <template v-else>
      <ModelsProviderDetail
        :provider="currentProvider"
        :models="currentModels"
        :model-presets="modelPresets"
        @back="showDetail = false"
        @changed="reloadProvidersAndModels"
      />
    </template>

    <!-- 供应商编辑弹窗 -->
    <GdDialog v-model="showProviderModal" :title="getProviderModalTitle" size="sm" align-center append-to-body
      class="provider-modal dialog-with-scroll">
      <div class="dialog-content">
        <div class="flex flex-col gap-3">
          <GdFormField :label="t('settings.models.name')" label-width="80px" hide-required-asterisk :error="errors.name || undefined">
            <GdInput v-model="currentProviderEdit.name" :placeholder="t('settings.models.namePlaceholder')" :disabled="!isNameEditable"
              :error="!!errors.name" @blur="validateField('name')" />
          </GdFormField>
          <GdFormField :label="t('settings.models.protocol')" label-width="80px" hide-required-asterisk :error="errors.protocol || undefined">
            <GdSelect v-model="currentProviderEdit.protocol" :placeholder="t('settings.models.selectProtocol')" style="width: 100%"
              :disabled="!isProtocolEditable" :error="!!errors.protocol" @change="validateField('protocol')">
              <GdOption v-for="p in protocolSelectOptions" :key="p.protocol" :label="p.displayName" :value="p.protocol" />
            </GdSelect>
            <div v-if="currentProtocolUnavailable" class="text-xs text-orange-500 mt-1">
              {{ t('settings.models.protocolUnavailable') }}
            </div>
            <div v-if="currentProtocolCapabilities.length" class="flex flex-wrap gap-1 mt-1">
              <GdTag v-for="cap in currentProtocolCapabilities" :key="cap" size="small" type="info" effect="plain">
                {{ cap }}
              </GdTag>
            </div>
          </GdFormField>
          <GdFormField :label="t('settings.models.apiUrl')" label-width="80px" hide-required-asterisk :error="errors.apiUrl || undefined">
            <GdInput v-model="currentProviderEdit.apiUrl" placeholder="api_url" :disabled="!isCustomProvider"
              :error="!!errors.apiUrl" @blur="validateField('apiUrl')" />
          </GdFormField>
          <GdFormField :label="t('settings.models.apiKey')" label-width="80px" hide-required-asterisk :error="errors.apiKey || undefined">
            <div class="api-key-input-wrapper">
              <GdInput v-model="currentProviderEdit.apiKey" placeholder="api_key" type="password" show-password />
              <GdButton type="primary" @click="handleTestConnection" :loading="testingConnection"
                :disabled="!currentProviderEdit.apiUrl || !currentProviderEdit.apiKey">
                {{ t('settings.models.test') }}
              </GdButton>
            </div>
            <!-- API Key 获取链接（仅非自定义供应商显示） -->
            <div v-if="currentProviderEdit.provider !== 'custom'" class="mt-2">
              <GdButton link type="primary" class="text-xs" @click="handleOpenApiKeyUrl">
                <Link16Regular class="mr-1 size-3.5" />
                {{ t('settings.models.getApiKey') }}
              </GdButton>
            </div>
          </GdFormField>
          <!-- 自定义请求头（仅自定义供应商可编辑） -->
          <GdFormField :label="t('settings.models.customHeaders')" label-width="80px" hide-required-asterisk :error="errors.headers || undefined">
            <GdInput
              v-model="currentProviderEdit.headers"
              type="textarea"
              :rows="4"
              class="w-full"
              :placeholder="t('settings.models.customHeadersPlaceholder')"
            />
            <div class="text-xs text-gray-400 mt-1">{{ t('settings.models.customHeadersDesc') }}</div>
          </GdFormField>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <GdButton @click="showProviderModal = false">{{ t('common.cancel') }}</GdButton>
          <GdButton type="primary" @click="handleSaveProvider">{{ t('common.ok') }}</GdButton>
        </div>
      </template>
    </GdDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ModelsProviderList from './ModelsProviderList.vue'

const { t } = useI18n()
const { confirm } = usePopup()
import ModelsProviderDetail from '../models/ModelsProviderDetail.vue'
import { Add16Regular, Link16Regular } from '@vicons/fluent'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { notify } from '@/components/ui/toastService';
import { openInExternalBrowser } from '@/utils/browserUtils'
import type { Model, ModelPreset, ModelProvider, ProviderProtocol, ProviderTemplate } from '@/types/api'
import type { CreateProviderPayload, UpdateProviderPayload } from '../../services/modules/model.api'

import GdButton from '@/components/ui/GdButton.vue';
import GdTag from '@/components/ui/GdTag.vue';
import GdSelect from '@/components/ui/GdSelect.vue';
import GdOption from '@/components/ui/GdSelectOption';
import GdInput from '@/components/ui/GdInput.vue';
import GdFormField from '@/components/ui/GdFormField.vue';
import { useFormValidation } from '@/composables/useFormValidation';

// 供应商表单校验（el-form :rules → useFormValidation）
const { errors, validate, validateField, clearValidate } = useFormValidation({
  name: [{ validator: (v) => (String(v ?? '') ? null : t('settings.models.nameRequired')) }],
  protocol: [{ validator: (v) => (String(v ?? '') ? null : t('settings.models.protocolRequired')) }],
  apiUrl: [{ validator: (v) => (String(v ?? '') ? null : t('settings.models.apiUrlRequired')) }],
  apiKey: [{ validator: (v) => (String(v ?? '') ? null : t('settings.models.apiKeyRequired')) }],
  headers: [{ validator: (v) => {
    const errs = validateHeadersText(String(v ?? ''));
    return errs.length > 0 ? errs.join('；') : null;
  } }],
});

const providers = ref<ProviderRow[]>([])
const models = ref<Model[]>([])
const providerTemplates = ref<ProviderTemplateRow[]>([])
const providerProtocols = ref<ProviderProtocol[]>([])
const modelPresets = ref<ModelPreset[]>([])
const isProviderEditMode = ref(false)
const showProviderModal = ref(false)

const currentProviderId = ref<string | null>(null)

// 使用响应式数据替代伪数据
const showDetail = ref(false)

const FALLBACK_PROTOCOLS: ProviderProtocol[] = [
  { protocol: 'openai', displayName: 'OpenAI', capabilities: {}, source: 'builtin' },
  { protocol: 'openai-response', displayName: 'OpenAI-Response', capabilities: {}, source: 'builtin' },
  { protocol: 'gemini', displayName: 'Gemini', capabilities: {}, source: 'builtin' },
  { protocol: 'anthropic', displayName: 'Anthropic', capabilities: {}, source: 'builtin' },
]

// 供应商模板相关
const activeProtocols = computed(() =>
  providerProtocols.value.length > 0 ? providerProtocols.value : FALLBACK_PROTOCOLS
)
// 下拉选项：接口协议 + 当前实例协议（插件被禁用/卸载时仍可看到原值并得到警告）
const protocolSelectOptions = computed(() => {
  const list = [...activeProtocols.value]
  const current = currentProviderEdit.value.protocol
  if (current && !list.some((p) => p.protocol === current)) {
    list.push({ protocol: current, displayName: current, capabilities: {}, source: 'builtin' })
  }
  return list
})
const PROTOCOL_CAPABILITY_LABELS: Record<string, string> = {
  tools: 'Tools',
  vision: 'Vision',
  reasoning: 'Reasoning',
  embeddings: 'Embedding',
  promptCaching: 'Prompt cache',
  modelDiscovery: 'Model discovery',
}
const currentProtocolCapabilities = computed(() => {
  const current = currentProviderEdit.value.protocol
  const info = activeProtocols.value.find((p) => p.protocol === current)
  if (!info?.capabilities) return []
  return Object.entries(info.capabilities)
    .filter(([key, value]) => key !== 'streaming' && value === true)
    .map(([key]) => PROTOCOL_CAPABILITY_LABELS[key] || key)
})
const currentProtocolUnavailable = computed(() => {
  const current = currentProviderEdit.value.protocol
  return !!current && !activeProtocols.value.some((p) => p.protocol === current)
})
// 协议能力标记（用于提示该协议支持的工具/视觉/思考等；streaming 是基线，不展示）
const availableTemplates = computed(() => providerTemplates.value)

// 添加用于编辑的临时数据
const currentProviderEdit = ref<{
  name: string
  apiUrl: string
  apiKey: string
  provider: string
  protocol: string
  headers: string
  attributes: {
    headers: Record<string, string>
  }
}>({
  name: "",
  apiUrl: "",
  apiKey: "",
  provider: "custom",
  protocol: "openai",
  headers: "",
  attributes: {
    headers: {} as Record<string, string>
  }
})

// 判断是否为自定义供应商（只有 custom 类型才可编辑 name、protocol、apiUrl）
// 文件化后所有实例都是普通配置文件：name/apiUrl/protocol 全部可编辑（id=文件名除外）
const isCustomProvider = computed(() => true)
const isNameEditable = computed(() => true)
const isProtocolEditable = computed(() => true)

// 动态获取弹窗标题
const getProviderModalTitle = computed(() => {
  if (isProviderEditMode.value) {
    return t('settings.models.editProvider')
  }
  const isFromTemplate = currentProviderEdit.value.provider !== 'custom'
  return isFromTemplate ? t('settings.models.addProvider', { name: currentProviderEdit.value.name || t('settings.models.provider') }) : t('settings.models.newGroup')
})

const testingConnection = ref(false)

type ProviderRow = ModelProvider & { enabled?: boolean }
// bundled-providers/*.yaml 模板携带 apiKeyUrl（"获取 API Key"跳转用），ProviderTemplate 接口未收录
type ProviderTemplateRow = ProviderTemplate & { apiKeyUrl?: string }

// 初始化数据函数
const initData = async () => {
  const response = await apiService.fetchAllModels()
  response.items.forEach(provider => {
    if (provider.models) {
      models.value.push(...provider.models.map(model => ({
        ...model,
        isActive: model.isActive !== undefined ? model.isActive : true
      })))
      delete provider.models
    }
    providers.value.push(provider)
  })
}

// 重新加载供应商和模型数据
const reloadProvidersAndModels = async () => {
  providers.value = []
  models.value = []

  const response = await apiService.fetchAllModels()
  response.items.forEach(provider => {
    if (provider.models && provider.models.length > 0) {
      models.value.push(...provider.models.map(model => ({
        ...model,
        isActive: model.isActive !== undefined ? model.isActive : true
      })))
    }
    delete provider.models
    providers.value.push(provider)
  })
}

const currentProvider = computed<ModelProvider>(() => {
  const provider = providers.value.find(p => p.id === currentProviderId.value)
  if (!provider) {
    // 未选中供应商时的显示占位：详情视图仅在选中具体供应商（handleItemClick 先写 id）后渲染，
    // 该兜底对象只参与标题展示，缺失字段不会被任何请求读取
    return { name: "", apiUrl: "", apiKey: "" } as ModelProvider
  }
  return provider
})

const currentModels = computed(() => {
  return models.value.filter(m => m.providerId === currentProviderId.value)
})

const handleCreateGroup = async () => {
  currentProviderId.value = null
  currentProviderEdit.value = {
    name: "",
    apiUrl: "",
    apiKey: "",
    provider: "custom",
    protocol: "openai",
    headers: '',
    attributes: {
      headers: {}
    }
  }
  clearValidate()
  isProviderEditMode.value = false
  showProviderModal.value = true
}

const handleSaveProvider = async () => {
  try {
    const valid = await validate()
    if (!valid) return

    const headers = parseHeaders(currentProviderEdit.value.headers)

    if (isProviderEditMode.value) {
      const updateData: UpdateProviderPayload = {
        apiKey: currentProviderEdit.value.apiKey,
        apiUrl: currentProviderEdit.value.apiUrl,
        attributes: {
          headers
        }
      }

      if (isNameEditable.value) {
        updateData.name = currentProviderEdit.value.name
        updateData.protocol = currentProviderEdit.value.protocol
      }

      if (!currentProviderId.value) {
        return
      }
      await apiService.updateProvider(currentProviderId.value, updateData)
      notify.success(t('common.updateSuccess'), t('settings.models.providerUpdated'), { duration: 2000 })

      const provider = providers.value.find(p => p.id === currentProviderId.value)
      if (provider) {
        provider.apiKey = currentProviderEdit.value.apiKey
        provider.apiUrl = currentProviderEdit.value.apiUrl
        if (isNameEditable.value) {
          provider.name = currentProviderEdit.value.name
          provider.protocol = currentProviderEdit.value.protocol
        }
        provider.attributes = { headers }
      }

      showProviderModal.value = false
    } else {
      const payload: CreateProviderPayload = {
        name: currentProviderEdit.value.name,
        apiUrl: currentProviderEdit.value.apiUrl,
        apiKey: currentProviderEdit.value.apiKey,
        provider: currentProviderEdit.value.provider || 'custom',
        protocol: currentProviderEdit.value.protocol || 'openai',
        attributes: {
          headers
        }
      }
      const provider = await apiService.createProvider(payload)

      await reloadProvidersAndModels()

      const newProvider = providers.value.find(p => p.id === provider.id)
      if (newProvider) {
        currentProviderId.value = newProvider.id
      }

      const isFromTemplate = currentProviderEdit.value.provider !== 'custom'
      if (isFromTemplate) {
        notify.success(t('common.createSuccess'), t('settings.models.providerAdded', { name: currentProviderEdit.value.name }), { duration: 3000 })
      } else {
        notify.success(t('common.createSuccess'), t('settings.models.groupCreated'), { duration: 2000 })
      }

      showProviderModal.value = false
    }
  } catch (error) {
    console.error('编辑分组失败:', error)
  }
}

// 测试供应商连通性
const handleTestConnection = async () => {
  if (!currentProviderEdit.value.apiUrl) {
    notify.error(t('settings.models.configError'), t('settings.models.apiUrlFirst'), { duration: 2000 })
    return
  }
  if (!currentProviderEdit.value.apiKey) {
    notify.error(t('settings.models.configError'), t('settings.models.apiKeyFirst'), { duration: 2000 })
    return
  }

  testingConnection.value = true
  try {
    const result = await apiService.testProviderConnection({
      apiUrl: currentProviderEdit.value.apiUrl,
      apiKey: currentProviderEdit.value.apiKey,
      protocol: currentProviderEdit.value.protocol || 'openai',
      attributes: currentProviderEdit.value.attributes
    })

    if (result.success) {
      notify.success(t('settings.models.connectionSuccess'), result.message || t('settings.models.connectionTestSuccess'), { duration: 3000 })
    } else {
      notify.error(t('settings.models.connectionFailed'), result.message || t('settings.models.connectionTestFailed'), { duration: 3000 })
    }
  } catch (error) {
    console.error('测试连通性失败:', error)
    notify.error(t('settings.models.connectionFailed'), t('settings.models.testConnectionError'), { duration: 3000 })
  } finally {
    testingConnection.value = false
  }
}

// 打开 API Key 获取页面
const handleOpenApiKeyUrl = () => {
  const template = providerTemplates.value.find(
    t => t.id === currentProviderEdit.value.provider
  )

  if (template?.apiKeyUrl) {
    openInExternalBrowser(template.apiKeyUrl)
  } else {
    notify.warning(t('settings.models.tip'), t('settings.models.noApiKeyUrl'), { duration: 2000 })
  }
}

// 解析 headers 文本为对象
const parseHeaders = (text: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  const lines = text.trim().split('\n')

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    const colonIndex = trimmedLine.indexOf(':')
    if (colonIndex === -1) {
      continue
    }

    const key = trimmedLine.substring(0, colonIndex).trim()
    const value = trimmedLine.substring(colonIndex + 1).trim()

    if (key) {
      headers[key] = value
    }
  }

  return headers
}

// 校验 headers 格式（返回错误数组，供表单验证器使用）
const validateHeadersText = (text: string): string[] => {
  const errors: string[] = []
  const lines = text.trim().split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      errors.push(t('settings.models.headerFormatError', { line: i + 1 }))
    } else {
      const key = line.substring(0, colonIndex).trim()
      if (!key) {
        errors.push(t('settings.models.headerNameEmpty', { line: i + 1 }))
      }
    }
  }

  return errors
}

const handleItemClick = (provider: ProviderRow) => {
  showDetail.value = true
  currentProviderId.value = provider.id
}

// 编辑供应商配置
const handleEditProvider = (provider: ProviderRow) => {
  currentProviderId.value = provider.id
  isProviderEditMode.value = true
  const existingHeaders = provider.attributes?.headers || {}

  currentProviderEdit.value = {
    name: provider.name || "",
    apiUrl: provider.apiUrl || "",
    apiKey: provider.apiKey || "",
    provider: provider.provider || "custom",
    protocol: provider.protocol || "openai",
    headers: Object.entries(existingHeaders)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
    attributes: {
      headers: existingHeaders
    }
  }

  clearValidate()
  showProviderModal.value = true
}

// 处理模板点击（从网格中添加）
const handleTemplateClick = (template: ProviderTemplateRow) => {
  currentProviderId.value = null
  isProviderEditMode.value = false

  currentProviderEdit.value = {
    name: template.name || "",
    apiUrl: template.defaultApiUrl || "",
    apiKey: "",
    provider: template.id,
    protocol: template.protocol || 'openai',
    headers: '',
    attributes: {
      headers: {}
    }
  }

  clearValidate()
  showProviderModal.value = true
}

// 启用/禁用开关
const handleToggleProvider = async (provider: ProviderRow, enabled: boolean) => {
  try {
    await apiService.setProviderEnabled(provider.id, enabled)
    provider.enabled = enabled
    notify.success(
      enabled ? t('settings.models.providerEnabled') : t('settings.models.providerDisabled'),
      enabled ? t('settings.models.providerEnabledMsg', { name: provider.name }) : t('settings.models.providerDisabledMsg', { name: provider.name }),
      { duration: 2000 }
    )
  } catch (error) {
    console.error('切换供应商启用状态失败:', error)
  }
}

// 从列表移除供应商：内置类型禁用（预置文件不可真删），自定义类型真删
const deleteProviderInstance = async (providerId: string) => {
  await apiService.deleteProvider(providerId)
}

// 删除供应商实例（真删文件）：
// 内置类型实例删掉后不会自动补种，可从「可添加的供应商」随时重新添加；
// 停用请用卡片开关（enabled: false），删除是不可逆的移除。
const handleDeleteProviderFromList = async (provider: ProviderRow) => {
  const isBuiltinType = provider.provider && provider.provider !== 'custom'
  const result = await confirm(
    t('settings.models.deleteProvider'),
    isBuiltinType
      ? t('settings.models.builtinDeleteConfirm', { name: provider.name })
      : t('settings.models.deleteProviderConfirm', { name: provider.name }),
  )

  if (!result) {
    return
  }

  try {
    await deleteProviderInstance(provider.id)
    notify.success(t('common.deleteSuccess'), t('settings.models.providerDeleted', { name: provider.name }), { duration: 2000 })
    await reloadProvidersAndModels()
  } catch (error) {
    notify.error(t('common.deleteFailed'), t('settings.models.deleteProviderError'), { duration: 2000 })
  }
}

onMounted(() => {
  initData()
  if (providers.value.length > 0) {
    currentProviderId.value = providers.value[0].id
  }
  // 获取供应商模板列表用于网格展示
  apiService.getProviderTemplates().then(templates => {
    providerTemplates.value = templates
  }).catch(error => {
    console.error('获取供应商模板失败:', error)
  })
  // 获取可用协议（内置 + 插件贡献）
  apiService.getProviderProtocols().then(protocols => {
    providerProtocols.value = protocols
  }).catch(error => {
    console.error('获取供应商协议失败:', error)
  })
  // 获取模型预设库
  apiService.getModelPresets().then(presets => {
    modelPresets.value = presets
  }).catch(error => {
    console.error('获取模型预设库失败:', error)
  })
})
</script>

<style scoped>
/* API Key 输入框和按钮布局 */
.api-key-input-wrapper {
  display: flex;
  gap: 8px;
  width: 100%;
}

</style>
