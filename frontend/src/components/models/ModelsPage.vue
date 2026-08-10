<template>
  <div class="h-full overflow-hidden flex flex-col">
    <PageHeader title="模型管理" />
    <div class="flex-1 flex flex-col overflow-hidden">
      <template v-if="!showDetail">
        <!-- 标题区（固定不滚动） -->
        <div class="shrink-0 flex items-center justify-between gap-4 mb-8 mt-2 px-4 w-full md:max-w-260 md:mx-auto">
          <div class="min-w-0">
            <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">模型供应商</h1>
            <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">管理 AI 模型供应商和模型配置，支持多协议接入。</p>
          </div>
          <el-button type="primary" @click="handleCreateGroup">
            <template #icon><PlusOutlined /></template>
            添加自定义
          </el-button>
        </div>

        <!-- 内容区（独立滚动，满屏宽度） -->
        <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable both-edges;">
          <div class="px-4 pb-4 w-full md:max-w-260 md:mx-auto">
            <ModelsProviderList :items="providers" :templates="availableTemplates"
              @item-click="handleItemClick"
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
      <el-dialog v-model="showProviderModal" :title="getProviderModalTitle" width="500px" align-center append-to-body
        class="provider-modal dialog-with-scroll">
        <div class="dialog-content">
          <el-form ref="formRef" :label-width="80" :model="currentProviderEdit" :rules="providerRules" size="large"
            label-position="left" hide-required-asterisk>
            <el-form-item label="名字" prop="name">
              <el-input v-model="currentProviderEdit.name" placeholder="输入分组名字" :disabled="!isNameEditable" />
            </el-form-item>
            <el-form-item label="协议类型" prop="protocol">
              <el-select v-model="currentProviderEdit.protocol" placeholder="请选择协议类型" style="width: 100%"
                :disabled="!isProtocolEditable">
                <el-option label="OpenAI" value="openai" />
                <el-option label="OpenAI-Response" value="openai-response" />
                <el-option label="Gemini" value="gemini" />
                <el-option label="Anthropic" value="anthropic" />
              </el-select>
            </el-form-item>
            <el-form-item label="API地址" prop="apiUrl">
              <el-input v-model="currentProviderEdit.apiUrl" placeholder="api_url" :disabled="!isCustomProvider" />
            </el-form-item>
            <el-form-item label="API KEY" prop="apiKey">
              <div class="api-key-input-wrapper">
                <el-input v-model="currentProviderEdit.apiKey" placeholder="api_key" type="password" show-password />
                <el-button type="primary" @click="handleTestConnection" :loading="testingConnection"
                  :disabled="!currentProviderEdit.apiUrl || !currentProviderEdit.apiKey">
                  测试
                </el-button>
              </div>
              <!-- API Key 获取链接（仅非自定义供应商显示） -->
              <div v-if="currentProviderEdit.provider !== 'custom'" class="mt-2">
                <el-link type="primary" :underline="false" @click="handleOpenApiKeyUrl" class="text-xs">
                  <el-icon class="mr-1">
                    <LinkOutlined />
                  </el-icon>
                  获取 API Key
                </el-link>
              </div>
            </el-form-item>
            <!-- 自定义请求头（仅自定义供应商可编辑） -->
            <el-form-item label="自定义请求头" prop="headers">
              <el-input
                v-model="currentProviderEdit.headers"
                type="textarea"
                :rows="4"
                class="w-full"
                placeholder="每行一个请求头，格式为: Key: Value"
              />
              <div class="text-xs text-gray-400 mt-1">用于 API Gateway 认证等场景，格式示例: Authorization: Bearer token</div>
            </el-form-item>
          </el-form>
        </div>
        <template #footer>
          <span class="dialog-footer">
            <el-button @click="showProviderModal = false">取消</el-button>
            <el-button type="primary" @click="handleSaveProvider">确定</el-button>
          </span>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import ModelsProviderList from '../setting/ModelsProviderList.vue'
import ModelsProviderDetail from './ModelsProviderDetail.vue'
import {
  PlusOutlined,
  LinkOutlined
} from '@vicons/material'
import PageHeader from '@/components/PageHeader.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { openInExternalBrowser } from '@/utils/browserUtils'

// Element Plus 组件导入
import {
  ElInput,
  ElFormItem,
  ElForm,
  ElButton,
  ElDialog,
  ElSelect,
  ElOption,
} from 'element-plus'
import type { FormInstance } from 'element-plus'

const { notify, confirm } = usePopup()
const currentProviderId = ref<string | null>(null)

// 使用响应式数据替代伪数据
const providers = ref<any[]>([])
const models = ref<any[]>([])
const showDetail = ref(false)

// 供应商模板相关
const providerTemplates = ref<any[]>([])
// 模型预设库
const modelPresets = ref<any[]>([])

// 计算可用的模板（过滤掉已添加的）
const availableTemplates = computed(() => {
  const addedProviderTypes = new Set(providers.value.map(p => p.provider))
  return providerTemplates.value.filter(t => !addedProviderTypes.has(t.id))
})

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
const isCustomProvider = computed(() => {
  if (!isProviderEditMode.value) {
    return true
  }
  return currentProviderEdit.value.provider === 'custom'
})

const isNameEditable = computed(() => {
  return currentProviderEdit.value.provider === 'custom'
})

const isProtocolEditable = computed(() => {
  return currentProviderEdit.value.provider === 'custom'
})

// 动态获取弹窗标题
const getProviderModalTitle = computed(() => {
  if (isProviderEditMode.value) {
    return '编辑供应商'
  }
  const isFromTemplate = currentProviderEdit.value.provider !== 'custom'
  return isFromTemplate ? `添加 ${currentProviderEdit.value.name || '供应商'}` : '新建分组'
})

const isProviderEditMode = ref(false)

const showProviderModal = ref(false)
const testingConnection = ref(false)

// 供应商表单验证规则
const providerRules = {
  name: {
    required: true,
    message: '请输入供应商名字',
    trigger: ['blur', 'input']
  },
  protocol: {
    required: true,
    message: '请选择协议类型',
    trigger: ['change', 'blur']
  },
  apiUrl: {
    required: true,
    message: '请输入API地址',
    trigger: ['blur', 'input']
  },
  apiKey: {
    required: true,
    message: '请输入API密钥',
    trigger: ['blur']
  },
  headers: {
    validator: (rule: any, value: string, callback: any) => {
      const errors = validateHeadersText(value)
      if (errors.length > 0) {
        callback(new Error(errors.join('；')))
      } else {
        callback()
      }
    },
    trigger: ['blur', 'input']
  }
}

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

const currentProvider = computed(() => {
  const provider = providers.value.find(p => p.id === currentProviderId.value)
  if (!provider) {
    return { name: "", apiUrl: "", apiKey: "" }
  }
  return provider
})

const currentModels = computed(() => {
  return models.value.filter(m => m.providerId === currentProviderId.value)
})

const formRef = ref<FormInstance | null>(null)

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
  formRef.value?.clearValidate?.()
  isProviderEditMode.value = false
  showProviderModal.value = true
}

const handleSaveProvider = async () => {
  try {
    await formRef.value?.validate()

    const headers = parseHeaders(currentProviderEdit.value.headers)

    if (isProviderEditMode.value) {
      const updateData: any = {
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
      notify.success('更新成功', '供应商信息已更新', { duration: 2000 })

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
      const payload = {
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
        notify.success('添加成功', `已添加 ${currentProviderEdit.value.name}，您可以点击"获取模型列表"来同步模型`, { duration: 3000 })
      } else {
        notify.success('创建成功', '分组创建成功', { duration: 2000 })
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
    notify.error('配置错误', '请先填写 API 地址', { duration: 2000 })
    return
  }
  if (!currentProviderEdit.value.apiKey) {
    notify.error('配置错误', '请先填写 API Key', { duration: 2000 })
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
      notify.success('连接成功', result.message || 'API 连接测试成功', { duration: 3000 })
    } else {
      notify.error('连接失败', result.message || 'API 连接测试失败', { duration: 3000 })
    }
  } catch (error) {
    console.error('测试连通性失败:', error)
    notify.error('连接失败', '测试连通性时发生错误', { duration: 3000 })
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
    notify.warning('提示', '该供应商暂未配置 API Key 获取地址', { duration: 2000 })
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
      errors.push(`第 ${i + 1} 行格式错误，缺少冒号`)
    } else {
      const key = line.substring(0, colonIndex).trim()
      if (!key) {
        errors.push(`第 ${i + 1} 行 Header 名称不能为空`)
      }
    }
  }
  
  return errors
}

// 删除供应商的API调用
const deleteProvider = async (providerId: string) => {
  await apiService.deleteProvider(providerId)
  providers.value = providers.value.filter(p => p.id !== providerId)
}

const handleItemClick = (provider: any) => {
  showDetail.value = true
  currentProviderId.value = provider.id
}

// 编辑供应商配置
const handleEditProvider = (provider: any) => {
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

  formRef.value?.clearValidate()
  showProviderModal.value = true
}

// 处理模板点击（从网格中添加）
const handleTemplateClick = (template: any) => {
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

  formRef.value?.clearValidate()
  showProviderModal.value = true
}

// 添加从列表中删除供应商的方法
const handleDeleteProviderFromList = async (provider: any) => {
  const result = await confirm("删除供应商", `确定要删除供应商"${provider.name}"吗？这将同时删除该供应商下的所有模型，操作不可恢复。`)

  if (!result) {
    return
  }

  try {
    await deleteProvider(provider.id)
    models.value = models.value.filter(m => m.provider_id !== provider.id)

    if (providers.value.length > 0) {
      currentProviderId.value = providers.value[0].id
    } else {
      currentProviderId.value = ""
    }

    notify.success('删除成功', `供应商"${provider.name}"已删除`, { duration: 2000 })
  } catch (error) {
    notify.error('删除失败', '删除供应商时发生错误', { duration: 2000 })
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
  // 获取模型预设库
  apiService.getModelPresets().then(presets => {
    modelPresets.value = presets
  }).catch(error => {
    console.error('获取模型预设库失败:', error)
  })
})
</script>

<style scoped>
/* 统一输入框内容左对齐 */
:deep(.el-input__inner),
:deep(.el-textarea__inner),
:deep(.el-input-number__decrease),
:deep(.el-input-number__increase) {
  text-align: left !important;
}

/* API Key 输入框和按钮布局 */
.api-key-input-wrapper {
  display: flex;
  gap: 8px;
  width: 100%;
}

.api-key-input-wrapper :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
</style>