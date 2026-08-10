<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- 详情标题区（固定不滚动） -->
    <div class="shrink-0 flex items-center justify-between gap-4 mb-8 mt-2 px-4 w-full md:max-w-260 md:mx-auto">
      <div class="flex items-center gap-3 min-w-0">
        <el-button link @click="$emit('back')"
          class="flex items-center gap-1 text-gray-900 dark:text-[#e8e9ed] hover:text-(--color-primary) font-medium shrink-0">
          <el-icon :size="20"><ArrowBackIosFilled /></el-icon>
          <span>返回</span>
        </el-button>
        <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed] truncate">{{ provider?.name }}</h1>
      </div>
      <el-button @click="handleAddModel">
        <template #icon><PlusOutlined /></template>
        添加模型
      </el-button>
    </div>

    <!-- 内容区（独立滚动，满屏宽度） -->
    <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable both-edges;">
      <div class="px-4 pb-4 w-full md:max-w-260 md:mx-auto">
        <!-- 空状态 -->
        <div v-if="models.length === 0" class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) p-12 text-center">
          <el-icon size="48" class="text-gray-300 dark:text-[#3e4046] mb-3">
            <Box16Regular />
          </el-icon>
          <p class="text-lg text-gray-500 dark:text-[#8b8d95]">暂无模型</p>
          <p class="text-sm mt-1 text-gray-400 dark:text-[#6b6d75]">点击下方按钮添加模型</p>
          <div class="flex justify-center gap-3 mt-6">
            <el-button type="primary" @click="handleAddModel">
              <template #icon><PlusOutlined /></template>
              添加模型
            </el-button>
          </div>
        </div>

        <!-- 模型列表 -->
        <div v-else class="rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) px-3 py-1 mb-4">
          <ul>
            <li v-for="model in models" :key="model.id"
              class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-[#2e3035] last:border-b-0 hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors rounded px-3 -mx-3">
              <div class="flex items-center flex-1 min-w-0 mr-4">
                <Avatar class="w-10 h-10 shrink-0 mr-3" :src="getModelAvatarForSetting(model)"
                  :name="getModelDisplayName(model.modelName)" type="assistant" :round="false" />
                <div class="flex-1 min-w-0">
                  <div class="font-bold text-gray-800 dark:text-[#e8e9ed] truncate mb-2">{{
                    getModelDisplayName(model.modelName) }}</div>
                  <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-[#8b8d95]">
                    <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#2a2c30] font-medium">
                      {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                    </span>
                    <div v-if="model.modelType === 'text'"
                      class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 dark:bg-[#2a2c30] border border-gray-100 dark:border-[#2e3035]">
                      <div class="flex items-center gap-0.5">
                        <template v-for="cap in (model.config?.inputCapabilities || [])" :key="'in-' + cap">
                          <LTooltip :content="'输入: ' + (cap === 'text' ? '文本' : '图像')" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="16">
                              <TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else-if="cap === 'image'" />
                            </el-icon>
                          </LTooltip>
                        </template>
                      </div>
                      <el-icon class="text-gray-300 dark:text-[#3e4046] mx-0.5" :size="12">
                        <ArrowRight24Regular />
                      </el-icon>
                      <div class="flex items-center gap-0.5">
                        <template v-for="cap in (model.config?.outputCapabilities || [])" :key="'out-' + cap">
                          <LTooltip :content="'输出: ' + (cap === 'text' ? '文本' : '图像')" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="16">
                              <TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else-if="cap === 'image'" />
                            </el-icon>
                          </LTooltip>
                        </template>
                      </div>
                      <template v-if="(model.config?.features || []).length > 0">
                        <span class="w-px h-3 bg-gray-200 dark:bg-[#2e3035] mx-1"></span>
                        <template v-for="feature in (model.config?.features || [])" :key="feature">
                          <LTooltip :content="getLableName(feature)" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="16">
                              <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                              <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                              <ScienceOutlined v-else />
                            </el-icon>
                          </LTooltip>
                        </template>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity shrink-0">
                <el-switch v-model="model.isActive" active-text="启用" inactive-text="禁用"
                  @change="handleToggleModelActive(model)" inline-prompt size="small" />
                <el-button link style="font-size: 18px; color: var(--el-text-color-secondary)"
                  @click="handleEditClick(model)">
                  <el-icon><SettingsOutlined /></el-icon>
                </el-button>
                <el-button type="danger" link style="font-size: 18px" @click="handleDeleteClick(model)">
                  <el-icon><RemoveCircleOutlineRound /></el-icon>
                </el-button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 编辑/新增模型信息的模态框 -->
    <el-dialog v-model="showEditModal" :title="isEditMode ? '编辑模型信息' : '新增模型'" width="600px" align-center
      class="model-edit-dialog dialog-with-scroll" append-to-body>
      <div class="dialog-content">
        <el-form ref="editFormRef" :model="editModelForm" :rules="editModelRules" label-position="left"
          label-width="120px" size="default">

          <div class="form-section">
            <el-form-item label="模型名称" prop="modelName">
              <div class="api-key-input-wrapper">
                <el-input v-model="editModelForm.modelName" placeholder="例如：gpt-4o, qwen-max" clearable
                  :disabled="isEditMode" />
                <el-button v-if="!isEditMode" type="primary" @click="handleFetchModels"
                  :loading="fetchingModels">
                  <template #icon>
                    <CloudDownloadOutlined />
                  </template>
                  从供应商获取
                </el-button>
              </div>
              <!-- 预设检测提示 -->
              <div v-if="!isEditMode && matchedPreset" class="preset-hint" @click="applyPreset(matchedPreset)">
                <el-icon class="mr-1"><AutoFixHighOutlined /></el-icon>
                检测到预设配置「{{ matchedPreset.label }}」，点击自动填充
              </div>
            </el-form-item>

            <el-form-item label="模型类型" prop="modelType">
              <el-radio-group v-model="editModelForm.modelType">
                <el-radio-button value="text">
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <TextT24Regular />
                    </el-icon> 对话 (Chat)</span>
                </el-radio-button>
                <el-radio-button value="embedding">
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <Group24Regular />
                    </el-icon> 嵌入 (Embedding)</span>
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
          </div>

          <!-- 对话模型配置 -->
          <div v-if="editModelForm.modelType === 'text'" class="transition-all">
            <el-form-item label="输入能力" prop="config.inputCapabilities" class="mb-3">
              <el-checkbox-group v-model="editModelForm.config.inputCapabilities">
                <el-checkbox-button value="text" disabled>
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <TextT24Regular />
                    </el-icon> 文本</span>
                </el-checkbox-button>
                <el-checkbox-button value="image">
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <Image24Regular />
                    </el-icon> 图像</span>
                </el-checkbox-button>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item label="输出能力" prop="config.outputCapabilities" class="mb-3">
              <el-checkbox-group v-model="editModelForm.config.outputCapabilities">
                <el-checkbox-button value="text" disabled>
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <TextT24Regular />
                    </el-icon> 文本</span>
                </el-checkbox-button>
                <el-checkbox-button value="image">
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <Image24Regular />
                    </el-icon> 图像</span>
                </el-checkbox-button>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item label="高级功能" prop="config.features" class="mb-4">
              <el-checkbox-group v-model="editModelForm.config.features">
                <el-checkbox-button value="tools">
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <WrenchScrewdriver24Regular />
                    </el-icon> 工具调用</span>
                </el-checkbox-button>
                <el-checkbox-button value="thinking">
                  <span class="flex items-center"><el-icon class="mr-1 align-middle">
                      <LightbulbFilament24Regular />
                    </el-icon> 混合思考</span>
                </el-checkbox-button>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item label="上下文窗口" prop="config.contextWindow">
              <el-input-number v-model="editModelForm.config.contextWindow" placeholder="128000"
                controls-position="right" style="width: 240px;">
                <template #suffix><span class="text-gray-400 text-xs ml-1">Tokens</span></template>
              </el-input-number>
            </el-form-item>

            <el-form-item label="最大输出长度" prop="config.maxOutputTokens">
              <el-input-number v-model="editModelForm.config.maxOutputTokens" placeholder="4096"
                controls-position="right" style="width: 240px;">
                <template #suffix><span class="text-gray-400 text-xs ml-1">Tokens</span></template>
              </el-input-number>
            </el-form-item>

            <el-divider content-position="left" class="!my-4 text-xs text-gray-400">模型默认参数（除非你明确知道自己在干什么，否则请留空，由 API 自行决定）</el-divider>

            <el-form-item label="温度" prop="config.temperature">
              <el-input-number v-model="editModelForm.config.temperature" :min="0" :max="2" :step="0.1"
                placeholder="模型默认" controls-position="right" style="width: 240px;" />
            </el-form-item>

            <el-form-item label="Top P" prop="config.topP">
              <el-input-number v-model="editModelForm.config.topP" :min="0" :max="1" :step="0.05"
                placeholder="模型默认" controls-position="right" style="width: 240px;" />
            </el-form-item>

            <el-form-item label="频率惩罚" prop="config.frequencyPenalty">
              <el-input-number v-model="editModelForm.config.frequencyPenalty" :min="-2" :max="2" :step="0.1"
                placeholder="模型默认" controls-position="right" style="width: 240px;" />
            </el-form-item>

            <el-form-item label="自定义参数 (JSON)" prop="config.customParameters">
              <el-input v-model="customParamsStr" type="textarea" :rows="3"
                placeholder='{ "temperature": 0.7, "top_p": 1 }' class="font-mono text-xs" />
            </el-form-item>
          </div>

          <!-- 嵌入模型配置 -->
          <div v-else-if="editModelForm.modelType === 'embedding'" class="transition-all">
            <el-form-item label="向量维度 (Dimensions)" prop="config.vectorDimensions">
              <el-input-number v-model="editModelForm.config.vectorDimensions" placeholder="例如：768, 1536, 3072"
                style="width: 240px;" controls-position="right" />
              <div class="text-xs text-gray-400 mt-1">该模型生成的向量特征数量</div>
            </el-form-item>
          </div>
        </el-form>
      </div>
      <template #footer>
        <div class="dialog-footer flex justify-end gap-3">
          <el-button @click="showEditModal = false">取消</el-button>
          <el-button type="primary" @click="handleSaveModel" :loading="saving">保存更改</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 获取模型列表的模态框 -->
    <el-dialog v-model="showFetchModal" title="从供应商获取模型" width="600px" align-center
      class="model-fetch-dialog dialog-with-scroll" append-to-body>
      <div class="dialog-content">
        <div class="mb-2 sticky top-0 bg-white dark:bg-[#232428] z-10">
          <el-input v-model="searchModelName" placeholder="搜索模型名称" clearable @input="handleSearchModel">
            <template #prefix>
              <el-icon>
                <SearchOutlined />
              </el-icon>
            </template>
          </el-input>
        </div>

        <div v-if="fetchingModels" class="flex justify-center items-center py-12">
          <el-icon class="is-loading text-primary" style="font-size: 32px;">
            <Loading />
          </el-icon>
        </div>
        <div v-else class="pb-4">
          <div v-if="filteredFetchedModels.length > 0">
            <ul
              class="rounded-lg border border-gray-100 dark:border-[#2e3035] divide-y divide-gray-100 dark:divide-[#2e3035]">
              <li v-for="model in filteredFetchedModels" :key="model.modelName"
                class="flex items-center justify-between py-2 px-4 hover:bg-gray-50 dark:hover:bg-[#2a2c30]/50 transition-colors">
                <div class="flex items-center gap-2 flex-1 min-w-0 mr-4">
                  <span class="font-medium text-gray-800 dark:text-[#e8e9ed] truncate">{{ model.modelName }}</span>
                  <span v-if="model.modelType !== 'text'"
                    class="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium text-xs">
                    嵌入
                  </span>
                  <template v-for="feature in (model.config?.features || [])" :key="feature">
                    <LTooltip :content="getLableName(feature)" placement="top">
                      <el-icon class="hover:text-primary transition-colors" :size="14">
                        <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                        <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                        <ScienceOutlined v-else />
                      </el-icon>
                    </LTooltip>
                  </template>
                </div>
                <el-button link type="primary" size="small" @click="handleSelectFromFetch(model)">
                  选择
                </el-button>
              </li>
            </ul>
          </div>

          <div v-if="filteredFetchedModels.length === 0" class="text-center py-12 text-gray-400 text-sm">
            暂无匹配的模型数据
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { ElMessageBox } from 'element-plus'
import Avatar from '../ui/Avatar.vue'
import LTooltip from '../ui/LTooltip.vue'
import {
  SettingsOutlined,
  RemoveCircleOutlineRound,
  SearchOutlined, ArrowBackIosFilled, PlusOutlined, CloudDownloadOutlined, ScienceOutlined,
  AutoFixHighOutlined
} from '@vicons/material'
import {
  TextT24Regular, LightbulbFilament24Regular, Image24Regular, WrenchScrewdriver24Regular, Group24Regular, ArrowRight24Regular, Box16Regular
} from '@vicons/fluent'
import { Loading } from '@element-plus/icons-vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { getModelDisplayName, getModelAvatarPath } from '@/utils/modelUtils'

const props = defineProps<{
  provider: any
  models: any[]
  modelPresets: any[]
}>()

const emit = defineEmits<{
  back: []
  changed: []
}>()

const { notify, confirm } = usePopup()

// ========== 编辑/新增模型信息 ==========
const showEditModal = ref(false)
const saving = ref(false)
const editFormRef = ref<any>(null)
const currentEditModelId = ref<string | null>(null)
const isEditMode = ref(false)

const editModelForm = ref<any>({
  modelName: '',
  modelType: 'text',
  config: {
    inputCapabilities: ['text'],
    outputCapabilities: ['text'],
    features: [],
    contextWindow: null,
    maxOutputTokens: null,
    temperature: null,
    topP: null,
    frequencyPenalty: null,
    customParameters: {},
    vectorDimensions: null
  }
})

// 用于双向绑定自定义参数字符串
const customParamsStr = computed({
  get() {
    try {
      return JSON.stringify(editModelForm.value.config.customParameters, null, 2)
    } catch (e) {
      return ''
    }
  },
  set(val) {
    try {
      if (val.trim() === '') {
        editModelForm.value.config.customParameters = {}
      } else {
        editModelForm.value.config.customParameters = JSON.parse(val)
      }
    } catch (e) {
      // 解析失败时不更新，避免报错
    }
  }
})

// 检测当前输入的模型名是否匹配预设库
const matchedPreset = computed(() => {
  if (!editModelForm.value.modelName) return null
  const lower = editModelForm.value.modelName.toLowerCase()
  return props.modelPresets.find((p: any) =>
    p.patterns.some((src: string) => new RegExp(src).test(lower))
  ) || null
})

// 应用预设配置到表单
const applyPreset = (preset: any) => {
  editModelForm.value.modelType = preset.modeType
  editModelForm.value.config = {
    inputCapabilities: preset.config.inputCapabilities || ['text'],
    outputCapabilities: preset.config.outputCapabilities || ['text'],
    features: preset.config.features || [],
    contextWindow: preset.config.contextWindow || null,
    maxOutputTokens: preset.config.maxOutputTokens || null,
    temperature: null,
    topP: null,
    frequencyPenalty: null,
    customParameters: {},
    vectorDimensions: preset.config.vectorDimensions || null
  }
}

const editModelRules = {
  modelName: { required: true, message: '请输入模型名字', trigger: 'blur' },
  modelType: { required: true, message: '请选择模型类型', trigger: 'change' },
  'config.contextWindow': {
    required: false,
    type: 'number' as const,
    validator: (rule: any, value: any) => !value || value > 0,
    message: '请输入有效的上下文窗口长度',
    trigger: 'blur' as const
  },
  'config.maxOutputTokens': {
    required: false,
    type: 'number' as const,
    validator: (rule: any, value: any) => !value || value > 0,
    message: '请输入有效的最大输出长度',
    trigger: 'blur' as const
  }
}

const getLableName = (type: string) => {
  switch (type) {
    case 'visual':
      return '视觉'
    case 'tools':
      return '工具调用'
    case 'thinking':
      return '混合思考'
    default:
      return type
  }
}

// 获取模型头像路径
const getModelAvatarForSetting = (model: { modelName: string }) => {
  if (!model || !model.modelName) return undefined
  const providerName = props.provider?.name || undefined
  const avatarPath = getModelAvatarPath(model.modelName, providerName)
  return avatarPath || undefined
}

// 从获取列表中选择模型（预填充到编辑表单，不调用API）
const handleSelectFromFetch = (model: any) => {
  editModelForm.value = {
    modelName: model.modelName || '',
    modelType: model.modelType || 'text',
    config: {
      inputCapabilities: model.config?.inputCapabilities || ['text'],
      outputCapabilities: model.config?.outputCapabilities || ['text'],
      features: model.config?.features || [],
      contextWindow: model.config?.contextWindow || null,
      maxOutputTokens: model.config?.maxOutputTokens || null,
      temperature: model.config?.temperature ?? null,
      topP: model.config?.topP ?? null,
      frequencyPenalty: model.config?.frequencyPenalty ?? null,
      customParameters: model.config?.customParameters || {},
      vectorDimensions: model.config?.vectorDimensions || null
    }
  }
  showFetchModal.value = false
}

// 新增模型
const handleAddModel = () => {
  isEditMode.value = false
  currentEditModelId.value = null
  editModelForm.value = {
    modelName: '',
    modelType: 'text',
    config: {
      inputCapabilities: ['text'],
      outputCapabilities: ['text'],
      features: [],
      contextWindow: null,
      maxOutputTokens: null,
      temperature: null,
      topP: null,
      frequencyPenalty: null,
      customParameters: {},
      vectorDimensions: null
    }
  }
  showEditModal.value = true
}

// 编辑模型
const handleEditClick = (model: any) => {
  isEditMode.value = true
  currentEditModelId.value = model.id
  const config = model.config || {}
  editModelForm.value = {
    modelName: model.modelName || '',
    modelType: model.modelType || 'text',
    config: {
      inputCapabilities: config.inputCapabilities || ['text'],
      outputCapabilities: config.outputCapabilities || ['text'],
      features: config.features || [],
      contextWindow: config.contextWindow || null,
      maxOutputTokens: config.maxOutputTokens || null,
      temperature: config.temperature ?? null,
      topP: config.topP ?? null,
      frequencyPenalty: config.frequencyPenalty ?? null,
      customParameters: config.customParameters || {},
      vectorDimensions: config.vectorDimensions || null
    }
  }
  showEditModal.value = true
}

// 保存模型
const handleSaveModel = async () => {
  try {
    await editFormRef.value?.validate()

    if (isEditMode.value) {
      if (currentEditModelId.value) {
        await apiService.updateModel(currentEditModelId.value, editModelForm.value)
      }
      notify.success('保存成功', '模型信息已更新')
    } else {
      await apiService.createModel({
        ...editModelForm.value,
        providerId: props.provider.id
      })
      notify.success('添加成功', '模型已添加')
    }

    showEditModal.value = false
    emit('changed')
  } catch (errors) {
    // 验证失败，不关闭模态框
    return false
  }
}

// 删除模型
const handleDeleteClick = async (model: any) => {
  const result = await confirm('删除模型', '确定要删除该模型吗？删除后将无法恢复。')
  if (!result) return
  await apiService.deleteModel(model.id)
  notify.success('删除成功', '模型已删除')
  emit('changed')
}

// 切换模型启用状态
const handleToggleModelActive = async (model: any) => {
  try {
    const result = await apiService.toggleModelActive(model.id)
    model.isActive = result.isActive
    const statusText = result.isActive ? '启用' : '禁用'
    notify.success('操作成功', `模型已${statusText}`, { duration: 2000 })
    emit('changed')
  } catch (error) {
    console.error('切换模型状态失败:', error)
    notify.error('操作失败', '切换模型状态时发生错误', { duration: 2000 })
    model.isActive = !model.isActive
  }
}

// ========== 获取模型列表 ==========
const showFetchModal = ref(false)
const fetchingModels = ref(false)
const fetchedModels = ref<any[]>([])
const searchModelName = ref('')

const handleSearchModel = useDebounceFn((value) => {
  // 防抖处理，仅依赖 computed 过滤
}, 300)

const filteredFetchedModels = computed(() => {
  if (!searchModelName.value) {
    return fetchedModels.value
  }
  const searchTerm = searchModelName.value.toLowerCase()
  return fetchedModels.value.filter(model =>
    model.modelName.toLowerCase().includes(searchTerm)
  )
})

const handleFetchModels = async () => {
  if (!props.provider.apiUrl || !props.provider.apiKey) {
    notify.error('配置错误', '请先配置API地址和API KEY', { duration: 2000 })
    return
  }

  fetchingModels.value = true
  showFetchModal.value = true

  try {
    const data = await apiService.fetchRemoteModels(props.provider.id)
    const apiModels = data.items || []
    // 从已添加的模型中继承config参数
    const enrichedModels = apiModels.map((apiModel: any) => {
      const existingModel = props.models.find(
        (model: any) => model.modelName === apiModel.modelName
      )
      if (existingModel) {
        return {
          ...apiModel,
          id: existingModel.id,
          config: { ...existingModel.config }
        }
      }
      return {
        ...apiModel,
        config: apiModel.config || { features: [] }
      }
    })
    fetchedModels.value = enrichedModels
    notify.success('获取成功', `已获取到 ${enrichedModels.length} 个模型`, { duration: 2000 })
  } catch (error) {
    fetchedModels.value = []
    notify.error('获取失败', '获取模型列表时发生错误', { duration: 2000 })
    console.error('获取模型列表失败:', error)
  } finally {
    fetchingModels.value = false
  }
}
</script>

<style scoped>
/* 统一输入框内容左对齐 */
:deep(.el-input__inner),
:deep(.el-textarea__inner),
:deep(.el-input-number__decrease),
:deep(.el-input-number__increase) {
  text-align: left !important;
}

/* 优化 Button 组样式，使其更简约 */
:deep(.el-checkbox-button__inner),
:deep(.el-radio-button__inner) {
  padding: 6px 12px;
  border-radius: 4px !important;
}

/* 调整相邻按钮的间距 */
:deep(.el-checkbox-button + .el-checkbox-button),
:deep(.el-radio-button + .el-radio-button) {
  margin-left: 8px;
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

/* 预设检测提示 */
.preset-hint {
  display: flex;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-primary);
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.preset-hint:hover {
  opacity: 1;
}
</style>