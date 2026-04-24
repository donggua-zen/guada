<template>
  <div class="flex flex-col h-full">
    <div class="settings-header" v-if="!isSimpleStyle">
      <h2>智能体设置</h2>
    </div>
    <div class="flex-1">
      <el-tabs ref="tabsInstRef" v-model="tabsValue">
        <!-- 基础设置 -->
        <el-tab-pane name="basic" label="基础">
          <div class="p-3">
            <el-form ref="basicFormRef" :model="characterForm" :rules="basicRules" label-position="left"
              label-width="80px" size="large">
              <!-- 头像设置 -->
              <el-form-item label="头像设置" :show-label="false">
                <div class="avatar-upload-container ">
                  <AvatarPreview :src="characterForm.avatarUrl" type="assistant" class="w-10"
                    :name="characterForm.title" @avatar-changed="handleAvatarChanged">
                  </AvatarPreview>
                </div>
              </el-form-item>

              <!-- 角色标题 -->
              <el-form-item label="角色标题" prop="title">
                <el-input v-model="characterForm.title" placeholder="请输入角色标题" />
              </el-form-item>

              <!-- 角色描述 -->
              <el-form-item label="角色描述" prop="description">
                <el-input v-model="characterForm.description" type="textarea" placeholder="请输入角色描述"
                  :autosize="{ minRows: 3, maxRows: 5 }" />
              </el-form-item>

              <!-- 分组设置 -->
              <el-form-item label="分组设置" prop="groupId">
                <el-select v-model="characterForm.groupId" placeholder="请选择分组" clearable style="width: 100%;">
                  <el-option label="未分组" :value="null" />
                  <el-option v-for="group in characterGroups" :key="group.id" :label="group.name" :value="group.id" />
                </el-select>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 提示词 -->
        <el-tab-pane name="prompt" label="提示词">
          <div class="p-3">
            <el-form ref="promptFormRef" :model="characterForm" :rules="promptRules" label-position="top"
              label-width="80px" size="large">
              <el-form-item :show-label="false" :show-feedback="false">
                <div class="flex items-center w-full justify-between">
                  <span>系统系提示(角色设定)</span>
                  <div class="flex items-center">
                    <el-checkbox v-model="characterForm.useUserPrompt" class="ml-2">
                      使用User Role
                    </el-checkbox>
                    <el-tooltip content="启用后，系统将使用User角色而非System发送设定提示词，以优化部分模型的表现（如DeepSeek）" placement="top">
                      <el-icon class="cursor-help text-gray-400 hover:text-gray-600" size="16">
                        <QuestionCircleOutlined />
                      </el-icon>
                    </el-tooltip>
                  </div>

                </div>
              </el-form-item>

              <!-- 详细设定 -->
              <el-form-item prop="systemPrompt" :show-label="false">
                <el-input v-model="characterForm.systemPrompt" type="textarea" placeholder="请输入详细设定"
                  :autosize="{ minRows: 8, maxRows: 12 }" />
              </el-form-item>

            </el-form>
          </div>
        </el-tab-pane>

        <!-- 模型设置 -->
        <el-tab-pane name="model" label="模型" v-if="!isSimpleStyle || true">
          <div class="p-3">
            <el-form ref="modelFormRef" :model="characterForm" :rules="modelRules" label-position="left"
              label-width="100px" size="large">
              <!-- 模型选择 -->
              <el-form-item label="模型选择" prop="modelId">
                <el-select v-model="characterForm.modelId" :options="modelOptions" placeholder="请选择模型" clearable>

                </el-select>
              </el-form-item>

              <!-- 温度设置 -->
              <el-form-item label="温度" prop="modelTemperature">
                <el-slider-optional v-model="characterForm.modelTemperature" :min="0" :max="1.9" :step="0.1" show-input
                  optional-direction="max" optional-text="Auto" />
              </el-form-item>

              <!-- Top P -->
              <el-form-item label="Top P" prop="modelTopP">
                <el-slider-optional v-model="characterForm.modelTopP" :min="0" :max="1" :step="0.1" show-input
                  optional-direction="max" optional-text="Auto" />
              </el-form-item>

              <!-- 频率惩罚 -->
              <el-form-item label="频率惩罚" prop="modelFrequencyPenalty">
                <el-slider-optional v-model="characterForm.modelFrequencyPenalty" :min="-1.9" :max="1.9" :step="0.1"
                  show-input optional-direction="max" optional-text="Auto" />
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 记忆设置 -->
        <el-tab-pane name="memory" label="记忆">
          <div class="p-3">
            <el-form ref="memoryFormRef" :model="characterForm" :rules="memoryRules" label-position="left"
              label-width="120px" size="large">
              <!-- 上下文条数 -->
              <el-form-item label="上下文条数" prop="maxMemoryLength">
                <el-slider-optional v-model="characterForm.maxMemoryLength" :min="2" :max="500" :step="1" show-input
                  optional-direction="max" optional-text="No Limit" />
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 本地工具 -->
        <el-tab-pane name="local_tools" label="本地工具">
          <div class="p-3">
            <el-form label-position="top" size="large">
              <!-- 全局开关 -->
              <el-form-item label="自动启用全部工具" label-position="left">
                <div class="flex items-center gap-2">
                  <el-tooltip content="开启后，角色将自动使用所有全局启用的工具，无需逐个选择" placement="top">
                    <el-icon class="cursor-help text-gray-400 hover:text-gray-600" size="16">
                      <QuestionCircleOutlined />
                    </el-icon>
                  </el-tooltip>
                  <el-switch 
                    :model-value="allToolsEnabled"
                    @update:model-value="handleAllToolsToggle"
                    inline-prompt 
                    active-text="开" 
                    inactive-text="关" 
                  />
                </div>
              </el-form-item>

              <el-alert title="工具说明" type="info" :closable="false" class="mb-4" show-icon>
                <p class="text-sm" v-if="allToolsEnabled">
                  当前已启用所有全局允许的工具，下方列表仅供参考
                </p>
                <p class="text-sm" v-else>
                  只有在全局设置中启用的工具才会显示在这里。您可以进一步选择启用或禁用这些工具。
                </p>
              </el-alert>

              <div v-if="loadingTools" class="text-center py-8">
                <el-icon class="is-loading" size="24">
                  <LoadingOutlined />
                </el-icon>
                <div class="text-sm text-gray-500 mt-2">加载中...</div>
              </div>
              
              <div v-else-if="localTools.length === 0" class="text-center text-gray-500 py-8">
                <el-icon size="48" class="mb-2">
                  <InfoCircleOutlined />
                </el-icon>
                <div>暂无可用的本地工具</div>
                <div class="text-sm mt-2">请先到"插件 > 本地工具"中启用工具</div>
              </div>

              <div v-else>
                <!-- 网格布局：每行3列 -->
                <div class="grid grid-cols-3 gap-3">
                  <div v-for="tool in localTools" :key="tool.namespace" class="tool-item p-3 border rounded">
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="font-medium text-sm flex-1 truncate">{{ tool.displayName }}</div>
                      <el-switch
                        v-if="!allToolsEnabled"
                        v-model="characterToolSettings[tool.namespace]"
                        @change="handleLocalToolToggle(tool.namespace, $event)"
                        inline-prompt
                        active-text="启动"
                        inactive-text="禁用"
                        size="default"
                      />
                      <el-tag v-else type="primary" size="small">已启用</el-tag>
                    </div>
                    <p class="text-xs text-gray-500 line-clamp-2 min-h-[2rem] mb-2">{{ tool.description }}</p>
                    <div v-if="allToolsEnabled" class="text-xs text-blue-500">
                      ✓ 已自动启用
                    </div>
                    <div v-else class="text-xs text-gray-400">
                      <el-tag size="small" type="info" effect="plain">
                        {{ tool.tools?.length || 0 }} 个工具
                      </el-tag>
                    </div>
                  </div>
                </div>
              </div>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- MCP 工具 -->
        <el-tab-pane name="mcp_tools" label="MCP 工具">
          <div class="p-3">
            <el-form label-position="top" size="large">
              <!-- MCP 全局开关 -->
              <el-form-item label="自动启用全部MCP服务器" label-position="left">
                <div class="flex items-center gap-2">
                  <el-tooltip content="开启后，角色将自动使用所有已启用的MCP服务器及其工具，无需逐个选择" placement="top">
                    <el-icon class="cursor-help text-gray-400 hover:text-gray-600" size="16">
                      <QuestionCircleOutlined />
                    </el-icon>
                  </el-tooltip>
                  <el-switch :model-value="characterForm.enabledMcpServers === true"
                    @update:model-value="handleMcpGlobalToggle" inline-prompt active-text="开" inactive-text="关" />
                </div>
              </el-form-item>

              <el-alert title="MCP 服务说明" type="info" :closable="false" class="mb-4" show-icon>
                <p class="text-sm" v-if="characterForm.enabledMcpServers === true">
                  当前已启用所有MCP服务器，下方列表仅供参考
                </p>
                <p class="text-sm" v-else>
                  启用表示此角色可以使用该 MCP 服务，禁用不会影响其他角色或全局 MCP 服务
                </p>
              </el-alert>

              <div v-if="mcpServers.length === 0" class="text-center text-gray-500 py-8">
                <el-icon size="48" class="mb-2">
                  <InfoCircleOutlined />
                </el-icon>
                <div>暂无已启动的 MCP 服务器</div>
              </div>

              <div v-else>
                <div v-for="server in mcpServers" :key="server.id" class="mcp-server-item p-3 border rounded mb-3">
                  <div class="flex items-start justify-between">
                    <div class="flex-1 mr-4">
                      <div class="font-medium text-base mb-1">
                        {{ server.name }}
                        <el-tag v-if="server.enabled" type="success" size="small" class="ml-2">
                          运行中
                        </el-tag>
                        <el-tag v-else type="info" size="small" class="ml-2">
                          未运行
                        </el-tag>
                        <el-tag v-if="characterForm.enabledMcpServers === true" type="primary" size="small"
                          class="ml-2">
                          已自动启用
                        </el-tag>
                      </div>
                      <div v-if="server.description" class="text-sm text-gray-600 line-clamp-2">
                        {{ server.description }}
                      </div>
                      <div v-if="server.tools && Object.keys(server.tools).length > 0"
                        class="text-sm text-gray-500 mt-2">
                        可用工具：{{ Object.keys(server.tools).length }} 个
                      </div>
                    </div>

                    <!-- 启用/禁用开关 -->
                    <el-switch v-if="characterForm.enabledMcpServers !== true"
                      :model-value="Array.isArray(characterForm.enabledMcpServers) && characterForm.enabledMcpServers.includes(server.id)"
                      @update:model-value="handleMcpServerToggle(server.id, $event)" :disabled="!server.enabled" />
                  </div>
                </div>
              </div>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div class="footer pb-5 flex justify-end">
      <el-button round block type="primary" @click="handleSave" size="large">
        应用全部设置
      </el-button>
    </div>
  </div>

</template>

<script setup lang="ts">
// @ts-nocheck - CharacterSettingPanel 组件复杂度高，临时使用@ts-nocheck
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import {
  ElTabs,
  ElTabPane,
  ElForm,
  ElFormItem,
  ElInput,
  ElSelect,
  ElSlider,
  ElInputNumber,
  ElTooltip,
  ElCheckbox,
  ElIcon,
  ElButton,
  ElAlert,
  ElTag,
  ElCheckboxGroup,
  ElSwitch
} from 'element-plus'
import {
  QuestionCircleOutlined,
  InfoCircleOutlined,
  LoadingOutlined
} from '@vicons/antd'

import { apiService } from '../services/ApiService'


import { usePopup } from '../composables/usePopup'
import { AvatarPreview, ElSliderOptional } from './ui/'

const { toast, notify } = usePopup()

// Props
const props = defineProps({
  simple: {
    type: Boolean,
    default: false
  },
  data: {
    type: Object,
    default: () => ({
      id: '',
      title: '',
      description: '',
      avatarUrl: '',
      settings: {
        assistantName: '',
        assistantIdentity: '',
        systemPrompt: '',
        modelId: null,
        memoryType: null,
        modelTemperature: null,
        modelTopP: null,
        modelFrequencyPenalty: null,
        maxMemoryLength: null,
        useUserPrompt: false
      }
    })
  },
  tab: {
    type: String,
    default: 'basic'
  }
})

// Emits
const emit = defineEmits(['update:data', 'update:tab', 'saved'])

// 响应式数据
const isSimpleStyle = ref(false)
const loading = ref(false)

// 模型数据
const models = ref([]);
const providers = ref([]);

// 表单引用
const basicFormRef = ref(null)
const promptFormRef = ref(null)
const modelFormRef = ref(null)
const memoryFormRef = ref(null)

const tabsValue = ref(props.tab)

// 表单数据
const characterForm = reactive({
  id: '',
  title: '',
  description: '',
  avatarUrl: '',
  avatarFile: null,
  groupId: null,  // 新增：分组 ID
  assistantName: '',
  assistantIdentity: '',
  systemPrompt: '',
  modelId: null,
  memoryType: '',
  modelTemperature: null,
  modelTopP: null,
  modelFrequencyPenalty: null,
  maxMemoryLength: null,
  useUserPrompt: false,
  enabledTools: [],  // 启用的本地工具
  enabledMcpServers: []  // 启用的 MCP 服务器 ID 数组
})

// 验证规则
const basicRules = {
  title: [
    { required: true, message: '请输入角色标题', trigger: ['input', 'blur'] },
    { min: 2, max: 20, message: '标题长度在2-20个字符之间', trigger: ['input', 'blur'] }
  ]
}

const promptRules = {
  systemPrompt: [
    { min: 2, max: 8000, message: '详细设定长度在8000个字符之间', trigger: ['input', 'blur'] }
  ]
}

const modelRules = {
  // 模型改为可选项，移除必填验证
}

const memoryRules = {
  maxMemoryLength: [
    { type: 'number', min: 2, max: 500, message: '最大记忆长度在 2-500 之间', trigger: ['input', 'blur'] },
  ],
}

// 选项数据
// const modelOptions = [
//     { label: '默认/不设置', value: '' },
//     { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
//     { label: 'GPT-4', value: 'gpt-4' },
//     { label: 'Claude 2', value: 'claude-2' },
//     { label: 'Llama 2', value: 'llama-2' }
// ]

const memoryOptions = [
  { label: '滑动窗口', value: 'sliding_window' },
  { label: '摘要增强', value: 'summary_augmented_sliding_window' },
  { label: '滑动窗口+记忆检索', value: 'sliding_window_with_rag' },
  { label: '无记忆', value: 'memoryless' }
];

// 模型选择选项（按供应商分组）
const modelOptions = computed(() => {
  if (!models.value.length || !providers.value.length) return []

  const options = []

  // 添加"使用默认模型"选项
  options.push({
    label: '使用默认模型',
    value: null,
    key: 'default'
  })

  providers.value?.forEach(provider => {
    // 获取该供应商下的text类型模型
    const providerModels = models.value.filter(model =>
      model.providerId === provider.id && model.modelType === 'text'
    )

    if (providerModels.length > 0) {
      // 添加分组标签
      options.push({
        label: provider.name,
        key: provider.id,
        disabled: true,

      })

      // 添加该分组下的模型选项
      providerModels.forEach(model => {
        options.push({
          label: model.modelName,
          value: model.id,
          key: model.id
        })
      })
    }
  })
  return options
})

// MCP 服务器数据
const mcpServers = ref([]);

// 角色分组数据
const characterGroups = ref([]);

// 本地工具数据
const localTools = ref([]);
const loadingTools = ref(false);

// 角色工具设置（namespace -> boolean | 'all'）
const characterToolSettings = ref({});

// 是否自动启用全部工具
const allToolsEnabled = computed(() => {
  // 如果所有工具都设置为 'all'，则认为启用了全部工具
  if (localTools.value.length === 0) return false;
  return localTools.value.every(tool => characterToolSettings.value[tool.namespace] === 'all');
});

// 监听 props.show 变化
watch(() => props.simple, (newVal) => {
  isSimpleStyle.value = newVal;
}, { immediate: true })

watch(() => props.data, (newVal) => {

  characterForm.avatarFile = null;

  characterForm.id = newVal.id || '';
  characterForm.title = newVal.title || '';
  characterForm.description = newVal.description || '';
  characterForm.avatarUrl = newVal.avatarUrl || '';
  characterForm.groupId = newVal.groupId || null;  // 加载分组 ID
  characterForm.modelId = newVal.modelId || null;

  characterForm.assistantName = newVal.settings?.assistantName || '';
  characterForm.assistantIdentity = newVal.settings?.assistantIdentity || '';
  characterForm.systemPrompt = newVal.settings?.systemPrompt || '';
  characterForm.memoryType = newVal.settings?.memoryType || 'sliding_window';
  characterForm.modelTemperature = newVal.settings?.modelTemperature || null;
  characterForm.modelTopP = newVal.settings?.modelTopP || null;
  characterForm.modelFrequencyPenalty = newVal.settings?.modelFrequencyPenalty || null;
  characterForm.maxMemoryLength = newVal.settings?.maxMemoryLength || null;
  characterForm.useUserPrompt = newVal.settings?.useUserPrompt || false;
  // 加载已启用的工具
  characterForm.enabledTools = newVal.settings?.tools || [];
  // 加载角色工具设置
  const toolsConfig = newVal.settings?.tools;
  if (typeof toolsConfig === 'object' && !Array.isArray(toolsConfig)) {
    characterToolSettings.value = { ...toolsConfig };
  } else {
    characterToolSettings.value = {};
  }
  // 加载已启用的 MCP 服务器 (支持 boolean 或 array)
  const mcpServersConfig = newVal.settings?.mcpServers;
  if (typeof mcpServersConfig === 'boolean') {
    characterForm.enabledMcpServers = mcpServersConfig;
  } else if (Array.isArray(mcpServersConfig)) {
    characterForm.enabledMcpServers = mcpServersConfig;
  } else {
    characterForm.enabledMcpServers = [];
  }

}, { immediate: true })

const handleAvatarChanged = (file) => {
  characterForm.avatarFile = file
}

// MCP 服务器开关切换处理
const handleMcpServerToggle = (serverId, enabled) => {
  // 如果当前是全局启用模式，不允许单独切换
  if (characterForm.enabledMcpServers === true) {
    console.warn('当前为全局启用模式，无法单独切换服务器');
    return;
  }

  const index = characterForm.enabledMcpServers.indexOf(serverId);
  if (enabled && index === -1) {
    // 启用：添加到数组
    characterForm.enabledMcpServers.push(serverId);
  } else if (!enabled && index !== -1) {
    // 禁用：从数组移除
    characterForm.enabledMcpServers.splice(index, 1);
  }
  console.log(`MCP 服务器 ${serverId} ${enabled ? '启用' : '禁用'}, 当前列表:`, characterForm.enabledMcpServers);
}

// MCP 全局开关切换处理
const handleMcpGlobalToggle = (enabled) => {
  if (enabled) {
    // 开启全局启用
    characterForm.enabledMcpServers = true;
    console.log('MCP 全局启用已开启');
  } else {
    // 关闭全局启用，初始化为空数组
    characterForm.enabledMcpServers = [];
    console.log('MCP 全局启用已关闭，需要手动选择服务器');
  }
}

// 加载本地工具列表
const loadLocalTools = async () => {
  if (!props.data?.id) {
    return;
  }
  
  loadingTools.value = true;
  try {
    const response = await apiService.fetchCharacterTools(props.data.id);
    // 只显示全局启用的工具
    localTools.value = (response.tools || []).filter(tool => tool.enabled);
    
    // 初始化角色工具设置
    const initialSettings = {};
    localTools.value.forEach(tool => {
      // 如果已有设置则使用，否则默认为 'all'（继承全局）
      initialSettings[tool.namespace] = characterToolSettings.value[tool.namespace] || 'all';
    });
    characterToolSettings.value = initialSettings;
  } catch (error) {
    console.error('加载本地工具失败:', error);
    toast.error('加载本地工具失败');
  } finally {
    loadingTools.value = false;
  }
}

// 全部工具开关切换处理
const handleAllToolsToggle = (enabled) => {
  if (enabled) {
    // 开启：将所有工具设置为 'all'（继承全局）
    localTools.value.forEach(tool => {
      characterToolSettings.value[tool.namespace] = 'all';
    });
    console.log('已启用全部工具');
  } else {
    // 关闭：将所有工具设置为 false（禁用）
    localTools.value.forEach(tool => {
      characterToolSettings.value[tool.namespace] = false;
    });
    console.log('已禁用全部工具，需要手动选择');
  }
}

// 本地工具开关切换处理
const handleLocalToolToggle = (namespace, enabled) => {
  characterToolSettings.value[namespace] = enabled;
  console.log(`本地工具 ${namespace} ${enabled ? '启用' : '禁用'}`);
}

const loadModels = async () => {
  try {
    const response = await apiService.fetchModels()

    response.items.forEach(provider => {
      models.value.push(...provider.models)
      delete provider.models
      providers.value.push(provider)
    })

  } catch (error) {
    console.error('获取模型列表失败:', error)
    notify.error('获取模型列表失败', error)
  }
}

const loadMCPServers = async () => {
  try {
    const response = await apiService.getMcpServers()
    // 只显示已启动的服务器
    mcpServers.value = response.items.filter(server => server.enabled)
  } catch (error) {
    console.error('获取 MCP 服务器列表失败:', error)
  }
}

// 加载角色分组列表
const loadCharacterGroups = async () => {
  try {
    characterGroups.value = await apiService.fetchCharacterGroups()
  } catch (error) {
    console.error('获取角色分组列表失败:', error)
  }
}

const findModelById = (modelId) => {
  return models.value.find(model => model.id === modelId)
}

// 监听 props.data.id 变化，重新加载工具列表
watch(() => props.data?.id, async (newVal, oldVal) => {
  if (newVal && newVal !== oldVal) {
    console.log('角色ID变化，重新加载工具列表:', newVal);
    await loadLocalTools();
  }
});

// 生命周期
onMounted(async () => {
  // if (!isSimpleStyle.value)
  loadModels();
  loadMCPServers();
  loadCharacterGroups();  // 加载分组列表
  // 注意：不在 onMounted 中加载工具，而是等待 watch 触发
})

onUnmounted(() => {
  // window.removeEventListener('resize', updateDrawerWidth)
  if (characterForm.avatarUrl && characterForm.avatarUrl.startsWith('blob:')) {
    URL.revokeObjectURL(characterForm.avatarUrl);
  }
})



const handleSave = async () => {
  try {
    // 并行验证所有表单
    var formValidates = [
      basicFormRef.value?.validate(),
      promptFormRef.value?.validate(),
      memoryFormRef.value?.validate(),
      modelFormRef.value?.validate(),
    ]
    //if (!isSimpleStyle.value) {
    // formValidates.push(modelFormRef.value?.validate())
    //}
    const validationResults = await Promise.allSettled(formValidates)

    // 检查是否有验证失败的表单
    const hasError = validationResults.some(result =>
      result.status === 'rejected'
    )

    if (hasError) {
      // 收集所有错误信息
      const errors = validationResults
        .filter(result => result.status === 'rejected')
        .map(result => result.reason)
        .flat()

      console.error('表单验证失败:', errors)
      // toast.error('请检查表单填写是否正确')

      // 自动切换到第一个有错误的tab
      const firstErrorIndex = validationResults.findIndex(result =>
        result.status === 'rejected'
      )
      if (firstErrorIndex !== -1) {
        const tabNames = ['basic', 'prompt', 'memory', 'model',]
        tabsValue.value = tabNames[firstErrorIndex]
      }

      return
    }


    loading.value = true

    // 模拟保存操作 
    // await new Promise(resolve => setTimeout(resolve, 1000))

    // 触发保存事件
    let finalData = {
      'title': characterForm.title,
      'description': characterForm.description,
      'name': characterForm.name,
      'avatarUrl': characterForm.avatarUrl,
      'avatarFile': characterForm.avatarFile,
      'groupId': characterForm.groupId,  // 新增：分组 ID
      'identity': characterForm.identity,
      'modelId': characterForm.modelId,
      'settings': {
        'assistantName': characterForm.assistantName,
        'assistantIdentity': characterForm.assistantIdentity,
        'systemPrompt': characterForm.systemPrompt,
        'memoryType': characterForm.memoryType,
        'maxMemoryLength': characterForm.maxMemoryLength,
        // 模型
        'modelTemperature': characterForm.modelTemperature,
        'modelTopP': characterForm.modelTopP,
        'modelFrequencyPenalty': characterForm.modelFrequencyPenalty,
        'useUserPrompt': characterForm.useUserPrompt,
        // 工具配置
        'tools': characterToolSettings.value,  // 对象格式：{ namespace: boolean | 'all' }
        'mcpServers': characterForm.enabledMcpServers,  // boolean 或 string[]
      }
    }
    emit('update:data', finalData)
    // toast.success('保存成功')
    // handleClose()
  } catch (errors) {
    if (errors) {
      toast.error('请检查表单填写是否正确' + errors.toString())
    } else {
      toast.error('保存失败')
    }
  } finally {
    loading.value = false
  }
}

function format(value) {
  if (value === null || value === "")
    return "不限制";
  return value.toLocaleString("en-US");
}

// 移除不再需要的 parse 和 format 方法（已删除 max_memory_tokens 和 short_term_memory_tokens）
</script>

<style scoped>
.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  list-style: 60px;
  font-size: 18px;
  font-weight: 600;
  padding: 0 20px;
  /* background-color: #ffffff; */
  border-bottom: 1px solid rgba(21, 23, 28, .1);
  border-radius: 0;

  /* margin: 0 40px; */
}

.avatar-upload-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  width: 100%;
}

.avatar-upload-actions {
  display: flex;
  gap: 10px;
}

.avatar-preview {
  width: 100px;
  height: 100px;
}

.modal-body {
  height: 400px;
}

.tool-item {
  transition: all 0.2s;
}

.tool-item:hover {
  border-color: var(--el-color-primary);
  background-color: #f5f7fa;
}

.mcp-server-item {
  transition: all 0.2s;
}

.mcp-server-item:hover {
  border-color: var(--el-color-primary-light-5);
}

.tool-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.tool-checkbox-item {
  display: block;
}

.tool-name {
  font-size: 13px;
  padding: 8px 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
  transition: all 0.2s;
}

.tool-checkbox-item :deep(.el-checkbox__input) {
  position: absolute;
  left: -9999px;
}

.tool-checkbox-item.is-checked .tool-name {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary);
}
</style>