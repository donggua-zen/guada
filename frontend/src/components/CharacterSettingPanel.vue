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
                        <el-form ref="basicFormRef" :model="characterForm" :rules="basicRules" label-position="top"
                            label-width="80px" size="large">
                            <!-- 头像设置 -->
                            <el-form-item label="头像设置" :show-label="false">
                                <div class="avatar-upload-container ">
                                    <AvatarPreview :src="characterForm.avatarUrl" type="assistant"
                                        @avatar-changed="handleAvatarChanged">
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
                                        <el-tooltip content="启用后，系统将使用User角色而非System发送设定提示词，以优化部分模型的表现（如DeepSeek）"
                                            placement="top">
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
                                    :autosize="{ minRows: 5, maxRows: 8 }" />
                            </el-form-item>

                            <!-- 角色名称 -->
                            <el-form-item label="角色名称">
                                <el-input v-model="characterForm.assistantName" placeholder="请输入角色名称" clearable />
                            </el-form-item>

                            <!-- 职业设定 -->
                            <el-form-item label="职业设定">
                                <el-input v-model="characterForm.assistantIdentity" placeholder="请输入职业设定" clearable />
                            </el-form-item>

                        </el-form>
                    </div>
                </el-tab-pane>

                <!-- 模型设置 -->
                <el-tab-pane name="model" label="模型" v-if="!isSimpleStyle || true">
                    <div class="p-3">
                        <el-form ref="modelFormRef" :model="characterForm" :rules="modelRules" label-position="top"
                            label-width="80px" size="large">
                            <!-- 模型选择 -->
                            <el-form-item label="模型选择" prop="modelId">
                                <el-select v-model="characterForm.modelId" :options="modelOptions" placeholder="请选择模型"
                                    clearable>
                                </el-select>
                            </el-form-item>

                            <!-- 温度设置 -->
                            <el-form-item label="温度" prop="modelTemperature">
                                <el-slider-optional v-model="characterForm.modelTemperature" :min="0" :max="1.9" 
                                    :step="0.1" show-input optional-direction="max" optional-text="Auto" />
                            </el-form-item>

                            <!-- Top P -->
                            <el-form-item label="Top P" prop="modelTopP">
                                <el-slider-optional v-model="characterForm.modelTopP" :min="0" :max="1" :step="0.1"
                                    show-input optional-direction="max" optional-text="Auto" />
                            </el-form-item>

                            <!-- 频率惩罚 -->
                            <el-form-item label="频率惩罚" prop="modelFrequencyPenalty">
                                <el-slider-optional v-model="characterForm.modelFrequencyPenalty" :min="-1.9" :max="1.9"
                                    :step="0.1" show-input optional-direction="max" optional-text="Auto" />
                            </el-form-item>
                        </el-form>
                    </div>
                </el-tab-pane>

                <!-- 记忆设置 -->
                <el-tab-pane name="memory" label="记忆">
                    <div class="p-3">
                        <el-form ref="memoryFormRef" :model="characterForm" :rules="memoryRules" label-position="top"
                            size="large">
                            <!-- 上下文条数 -->
                            <el-form-item label="上下文条数" prop="maxMemoryLength">
                                <el-slider-optional v-model="characterForm.maxMemoryLength" :min="2" :max="500"
                                    :step="1" show-input optional-direction="max" optional-text="No Limit" />
                            </el-form-item>
                            
                            <!-- 禁用工具调用结果 -->
                            <el-form-item label="禁用工具调用结果" prop="skipToolCalls">
                                <div class="flex items-center justify-between w-full">
                                    <div class="flex-1 mr-4">
                                        <div class="text-sm font-medium mb-1">工具调用结果</div>
                                        <div class="text-xs text-gray-500">启用后，模型将跳过工具调用的执行，直接返回最终答案，节省 tokens 和响应时间</div>
                                    </div>
                                    <el-switch
                                        v-model="characterForm.skipToolCalls"
                                        inline-prompt
                                        active-text="开"
                                        inactive-text="关"
                                    />
                                </div>
                            </el-form-item>
                        </el-form>
                    </div>
                </el-tab-pane>
                
                <!-- 本地工具 -->
                <el-tab-pane name="local_tools" label="本地工具">
                    <div class="p-3">
                        <el-form label-position="top" size="large">
                            <el-form-item label="可用工具">
                                <el-checkbox-group v-model="characterForm.enabledTools">
                                    <div class="tool-item p-3 border rounded mb-2">
                                        <el-checkbox value="get_current_time" class="w-full">
                                            <div class="flex items-center justify-between w-full">
                                                <div>
                                                    <div class="font-medium">获取当前时间</div>
                                                    <div class="text-sm text-gray-500">返回当前的日期和时间信息</div>
                                                </div>
                                                <el-tag type="info" size="small">内置</el-tag>
                                            </div>
                                        </el-checkbox>
                                    </div>
                                </el-checkbox-group>
                            </el-form-item>
                        </el-form>
                    </div>
                </el-tab-pane>
                
                <!-- MCP 工具 -->
                <el-tab-pane name="mcp_tools" label="MCP 工具">
                    <div class="p-3">
                        <el-form label-position="top" size="large">
                            <el-alert
                                title="MCP 服务说明"
                                type="info"
                                :closable="false"
                                class="mb-4"
                                show-icon>
                                <p class="text-sm">启用表示此角色可以使用该 MCP 服务，禁用不会影响其他角色或全局 MCP 服务</p>
                            </el-alert>
                
                            <div v-if="mcpServers.length === 0" class="text-center text-gray-500 py-8">
                                <el-icon size="48" class="mb-2">
                                    <InfoCircleOutlined />
                                </el-icon>
                                <div>暂无已启动的 MCP 服务器</div>
                            </div>
                
                            <div v-else>
                                <div v-for="server in mcpServers" :key="server.id" 
                                     class="mcp-server-item p-3 border rounded mb-3">
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
                                            </div>
                                            <div class="text-sm text-gray-500 mb-1">{{ server.url }}</div>
                                            <div v-if="server.description" class="text-sm text-gray-600">
                                                {{ server.description }}
                                            </div>
                                            <div v-if="server.tools && Object.keys(server.tools).length > 0" 
                                                 class="text-sm text-gray-500 mt-2">
                                                可用工具：{{ Object.keys(server.tools).length }} 个
                                            </div>
                                        </div>
                                                        
                                        <!-- 启用/禁用开关 -->
                                        <el-switch
                                            :model-value="characterForm.enabledMcpServers.includes(server.id)"
                                            @update:model-value="handleMcpServerToggle(server.id, $event)"
                                            :disabled="!server.enabled"
                                        />
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
    InfoCircleOutlined
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
    assistantName: '',
    assistantIdentity: '',
    systemPrompt: '',
    modelId: '',
    memoryType: '',
    modelTemperature: null,
    modelTopP: null,
    modelFrequencyPenalty: null,
    maxMemoryLength: null,
    skipToolCalls: false,  // 新增：是否禁用工具调用结果
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
    modelId: [
        {
            required: true, message: '请选择模型', trigger: ['change'], validator: (rule, value, callback) => {
                // 明确检查空值情况
                if (value !== null && value !== '' && value !== undefined) {
                    callback();
                } else {
                    callback(new Error('请选择模型'));
                }
            }
        },
    ],

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
    characterForm.modelId = newVal.modelId || '';

    characterForm.assistantName = newVal.settings?.assistantName || '';
    characterForm.assistantIdentity = newVal.settings?.assistantIdentity || '';
    characterForm.systemPrompt = newVal.settings?.systemPrompt || '';
    characterForm.memoryType = newVal.settings?.memoryType || 'sliding_window';
    characterForm.modelTemperature = newVal.settings?.modelTemperature || null;
    characterForm.modelTopP = newVal.settings?.modelTopP || null;
    characterForm.modelFrequencyPenalty = newVal.settings?.modelFrequencyPenalty || null;
    characterForm.maxMemoryLength = newVal.settings?.maxMemoryLength || null;
    characterForm.skipToolCalls = newVal.settings?.skipToolCalls ?? false;  // 加载新字段
    characterForm.useUserPrompt = newVal.settings?.useUserPrompt || false;
    // 加载已启用的工具
    characterForm.enabledTools = newVal.settings?.tools || [];
    // 加载已启用的 MCP 服务器 (数组格式)
    characterForm.enabledMcpServers = newVal.settings?.mcpServers || [];

}, { immediate: true })

const handleAvatarChanged = (file) => {
    characterForm.avatarFile = file
}

// MCP 服务器开关切换处理
const handleMcpServerToggle = (serverId, enabled) => {
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

const findModelById = (modelId) => {
    return models.value.find(model => model.id === modelId)
}

// 生命周期
onMounted(async () => {
    // if (!isSimpleStyle.value)
    loadModels();
    loadMCPServers();
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
            'identity': characterForm.identity,
            'modelId': characterForm.modelId,
            'settings': {
                'assistantName': characterForm.assistantName,
                'assistantIdentity': characterForm.assistantIdentity,
                'systemPrompt': characterForm.systemPrompt,
                'memoryType': characterForm.memoryType,
                'maxMemoryLength': characterForm.maxMemoryLength,
                'skipToolCalls': characterForm.skipToolCalls,  // 新增字段
                // 模型
                'modelName': findModelById(characterForm.modelId).modelName || '请选择模型',
                'modelTemperature': characterForm.modelTemperature,
                'modelTopP': characterForm.modelTopP,
                'modelFrequencyPenalty': characterForm.modelFrequencyPenalty,
                'useUserPrompt': characterForm.useUserPrompt,
                // 工具配置
                'tools': characterForm.enabledTools,
                'mcpServers': characterForm.enabledMcpServers,  // 数组格式：[serverId1, serverId2]
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