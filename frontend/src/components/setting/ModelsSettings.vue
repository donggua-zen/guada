<template>
    <div class="flex-1 overflow-hidden">
        <template v-if="!showDetail">
            <ModelsProviderList :items="providers" :templates="availableTemplates" @item-click="handleItemClick"
                @create-group="handleCreateGroup" @item-edit="handleEditProvider"
                @item-delete="handleDeleteProviderFromList" @template-click="handleTemplateClick">
            </ModelsProviderList>
        </template>
        <template v-else>
            <!-- 头部区域 -->
            <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
                <el-button link @click="showDetail = false" class="flex items-center gap-2">
                    <el-icon :size="16">
                        <ArrowBackIosFilled />
                    </el-icon>
                    <span class="text-xl">{{ currentProvider.name }}</span>
                </el-button>
                <el-space>
                    <el-button @click="handleEditProvider(currentProvider)">
                        <template #icon>
                            <SettingsOutlined />
                        </template>
                        供应商设置
                    </el-button>
                    <el-button @click="handleAddModel">
                        <template #icon>
                            <PlusOutlined />
                        </template>
                        手动添加
                    </el-button>
                    <el-button type="primary" @click="handleFetchModels">
                        <template #icon>
                            <CloudDownloadOutlined />
                        </template>
                        获取模型列表
                    </el-button>
                </el-space>
            </div>
            <div class="mt-4 rounded border px-3 py-1 border-gray-200 dark:border-gray-700">
                <ul>
                    <li v-for="model in currentModels" :key="model.id"
                        class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded px-3 -mx-3">
                        <div class="flex-1 min-w-0 mr-4">
                            <div class="font-bold text-gray-800 dark:text-gray-200 truncate mb-2">{{ model.modelName }}</div>
                            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <!-- 模型类型文本 -->
                                <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-medium">
                                    {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                                </span>

                                <!-- 能力配置组（带底纹和箭头） -->
                                <div v-if="model.modelType === 'text'" class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                                    <!-- 输入能力 -->
                                    <div class="flex items-center gap-0.5">
                                        <template v-for="cap in (model.config?.inputCapabilities || [])" :key="'in-' + cap">
                                            <el-tooltip :content="'输入: ' + (cap === 'text' ? '文本' : '图像')" placement="top">
                                                <el-icon class="hover:text-primary transition-colors" :size="16">
                                                    <TextT24Regular v-if="cap === 'text'" />
                                                    <Image24Regular v-else-if="cap === 'image'" />
                                                </el-icon>
                                            </el-tooltip>
                                        </template>
                                    </div>

                                    <!-- 分隔箭头 -->
                                    <el-icon class="text-gray-300 dark:text-gray-600 mx-0.5" :size="12">
                                        <ArrowRight24Regular />
                                    </el-icon>

                                    <!-- 输出能力 -->
                                    <div class="flex items-center gap-0.5">
                                        <template v-for="cap in (model.config?.outputCapabilities || [])" :key="'out-' + cap">
                                            <el-tooltip :content="'输出: ' + (cap === 'text' ? '文本' : '图像')" placement="top">
                                                <el-icon class="hover:text-primary transition-colors" :size="16">
                                                    <TextT24Regular v-if="cap === 'text'" />
                                                    <Image24Regular v-else-if="cap === 'image'" />
                                                </el-icon>
                                            </el-tooltip>
                                        </template>
                                    </div>

                                    <!-- 高级功能（如果有） -->
                                    <template v-if="(model.config?.features || []).length > 0">
                                        <span class="w-px h-3 bg-gray-200 dark:bg-gray-700 mx-1"></span>
                                        <template v-for="feature in (model.config?.features || [])" :key="feature">
                                            <el-tooltip :content="getLableName(feature)" placement="top">
                                                <el-icon class="hover:text-primary transition-colors" :size="16">
                                                    <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                                                    <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                                                    <ScienceOutlined v-else />
                                                </el-icon>
                                            </el-tooltip>
                                        </template>
                                    </template>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity shrink-0">
                            <el-button link style="font-size: 18px; color: var(--el-text-color-secondary)" @click="handleEditClick(model)">
                                <el-icon><SettingsOutlined /></el-icon>
                            </el-button>
                            <el-button type="danger" link style="font-size: 18px" @click="handleDeleteClick(model)">
                                <el-icon><RemoveCircleOutlineRound /></el-icon>
                            </el-button>
                        </div>
                    </li>
                </ul>
            </div>
        </template>
    </div>

    <el-dialog v-model="showProviderModal" :title="isProviderEditMode ? '编辑供应商' : '新建分组'" width="30%" align-center>
        <el-form ref="formRef" :label-width="80" :model="currentProviderEdit" :rules="providerRules" size="large"
            label-position="left">
            <el-form-item label="名字" prop="name">
                <el-input v-model="currentProviderEdit.name" placeholder="输入分组名字" :disabled="!isCustomProvider" />
            </el-form-item>
            <el-form-item label="协议类型" prop="protocol">
                <el-select v-model="currentProviderEdit.protocol" placeholder="请选择协议类型" style="width: 100%"
                    :disabled="!isCustomProvider">
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
                <el-input v-model="currentProviderEdit.apiKey" placeholder="api_key" type="password" show-password />
            </el-form-item>
            <!-- 提示：非自定义供应商的限制 -->
            <el-alert v-if="!isCustomProvider && isProviderEditMode" title="提示：从模板添加的供应商，名称、协议和API地址不可修改" type="info"
                :closable="false" show-icon class="mb-2" />
        </el-form>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="showProviderModal = false">取消</el-button>
                <el-button type="primary" @click="handleSaveProvider">确定</el-button>
            </span>
        </template>
    </el-dialog>

    <!-- 编辑/新增模型信息的模态框 -->
    <el-dialog v-model="showEditModal" :title="isEditMode ? '编辑模型信息' : '新增模型'" width="600px" align-center
        class="model-edit-dialog">
        <el-form ref="editFormRef" :model="editModelForm" :rules="editModelRules" label-position="left"
            label-width="120px" size="default">
            
            <div class="form-section">
                <el-form-item label="模型名称" prop="modelName">
                    <el-input v-model="editModelForm.modelName" placeholder="例如：gpt-4o, qwen-max" clearable />
                </el-form-item>

                <el-form-item label="模型类型" prop="modelType">
                    <el-radio-group v-model="editModelForm.modelType">
                        <el-radio-button value="text">
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><TextT24Regular /></el-icon> 对话 (Chat)</span>
                        </el-radio-button>
                        <el-radio-button value="embedding">
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><Group24Regular /></el-icon> 嵌入 (Embedding)</span>
                        </el-radio-button>
                    </el-radio-group>
                </el-form-item>
            </div>

            <!-- 对话模型配置 -->
            <div v-if="editModelForm.modelType === 'text'" class="transition-all">
                <el-form-item label="输入能力" prop="config.inputCapabilities" class="mb-3">
                    <el-checkbox-group v-model="editModelForm.config.inputCapabilities">
                        <el-checkbox-button value="text" disabled>
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><TextT24Regular /></el-icon> 文本</span>
                        </el-checkbox-button>
                        <el-checkbox-button value="image">
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><Image24Regular /></el-icon> 图像</span>
                        </el-checkbox-button>
                    </el-checkbox-group>
                </el-form-item>

                <el-form-item label="输出能力" prop="config.outputCapabilities" class="mb-3">
                    <el-checkbox-group v-model="editModelForm.config.outputCapabilities">
                        <el-checkbox-button value="text" disabled>
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><TextT24Regular /></el-icon> 文本</span>
                        </el-checkbox-button>
                        <el-checkbox-button value="image">
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><Image24Regular /></el-icon> 图像</span>
                        </el-checkbox-button>
                    </el-checkbox-group>
                </el-form-item>

                <el-form-item label="高级功能" prop="config.features" class="mb-4">
                    <el-checkbox-group v-model="editModelForm.config.features">
                        <el-checkbox-button value="tools">
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><WrenchScrewdriver24Regular /></el-icon> 工具调用</span>
                        </el-checkbox-button>
                        <el-checkbox-button value="thinking">
                            <span class="flex items-center"><el-icon class="mr-1 align-middle"><LightbulbFilament24Regular /></el-icon> 混合思考</span>
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
        <template #footer>
            <div class="dialog-footer flex justify-end gap-3">
                <el-button @click="showEditModal = false">取消</el-button>
                <el-button type="primary" @click="handleSaveModel" :loading="saving">保存更改</el-button>
            </div>
        </template>
    </el-dialog>

    <!-- 获取模型列表的模态框 -->
    <el-dialog v-model="showFetchModal" title="获取模型列表" width="600px" align-center class="model-edit-dialog">
        <div class="max-h-[60vh] overflow-y-auto px-1">
            <div class="p-2 mb-2 sticky top-0 bg-white dark:bg-gray-900 z-10">
                <el-input v-model="searchModelName" placeholder="搜索模型名称" clearable @input="handleSearchModel">
                    <template #prefix>
                        <el-icon><SearchOutlined /></el-icon>
                    </template>
                </el-input>
            </div>

            <div v-if="fetchingModels" class="flex justify-center items-center py-12">
                <el-icon class="is-loading text-primary" style="font-size: 32px;"><Loading /></el-icon>
            </div>
            <div v-else>
                <!-- 已添加的模型 -->
                <div v-if="filteredAddedModels.length > 0" class="mb-6">
                    <h3 class="text-xs font-bold text-green-600 uppercase tracking-wider mb-3 ml-1">已添加的模型</h3>
                    <ul class="rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                        <li v-for="model in filteredAddedModels" :key="model.id"
                            class="flex items-center justify-between py-3 px-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <div class="flex-1 min-w-0 mr-4">
                                <div class="font-medium text-gray-800 dark:text-gray-200 truncate">{{ model.modelName }}</div>
                                <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    <span class="px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium">
                                        {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                                    </span>
                                    <template v-for="feature in (model.config?.features || [])" :key="feature">
                                        <el-tooltip :content="getLableName(feature)" placement="top">
                                            <el-icon class="hover:text-primary transition-colors" :size="14">
                                                <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                                                <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                                                <ScienceOutlined v-else />
                                            </el-icon>
                                        </el-tooltip>
                                    </template>
                                </div>
                            </div>
                            <el-button type="danger" link size="small" @click="handleRemoveFromFetch(model)">
                                <el-icon><RemoveCircleTwotone /></el-icon>
                            </el-button>
                        </li>
                    </ul>
                </div>

                <!-- 可添加的模型 -->
                <div v-if="filteredAvailableModels.length > 0">
                    <h3 class="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3 ml-1">可添加的模型</h3>
                    <ul class="rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                        <li v-for="model in filteredAvailableModels" :key="model.modelName"
                            class="flex items-center justify-between py-3 px-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <div class="flex-1 min-w-0 mr-4">
                                <div class="font-medium text-gray-800 dark:text-gray-200 truncate">{{ model.modelName }}</div>
                                <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    <span class="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                                        {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                                    </span>
                                    <template v-for="feature in (model.config?.features || [])" :key="feature">
                                        <el-tooltip :content="getLableName(feature)" placement="top">
                                            <el-icon class="hover:text-primary transition-colors" :size="14">
                                                <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                                                <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                                                <ScienceOutlined v-else />
                                            </el-icon>
                                        </el-tooltip>
                                    </template>
                                </div>
                            </div>
                            <el-button link type="primary" size="small" @click="handleAddFromFetch(model)">
                                <el-icon><AddCircleTwotone /></el-icon>
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
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core' // 导入防抖函数'
import ModelsProviderList from './ModelsProviderList.vue'
import {
    SettingsOutlined, RemoveCircleOutlineRound, DeleteTwotone, AddCircleTwotone,
    RemoveCircleTwotone, SearchOutlined, ArrowBackIosFilled, PlusOutlined, CloudDownloadOutlined, ScienceOutlined
} from '@vicons/material'
import {
    TextT24Regular, LightbulbFilament24Regular, Image24Regular, WrenchScrewdriver24Regular, Group24Regular, ArrowRight24Regular
} from '@vicons/fluent'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { useStorage } from '@vueuse/core'

// Element Plus 组件导入
import {
    ElInput,
    ElFormItem,
    ElForm,
    ElButton,
    ElSpace,
    ElIcon,
    ElTag,
    ElDialog,
    ElSelect,
    ElOption,
    ElCheckbox,
    ElCheckboxGroup,
    ElInputNumber,
    ElAlert
} from 'element-plus'
import { Loading } from '@element-plus/icons-vue'

const { notify, confirm, prompt } = usePopup()
const currentProviderId = ref("");

// 使用响应式数据替代伪数据
const providers = ref([]);
const models = ref([]);
const showDetail = ref(false);

// 供应商模板相关
const providerTemplates = ref([]);

// 计算可用的模板（过滤掉已添加的）
const availableTemplates = computed(() => {
    // 使用 provider 字段来判断是否已添加
    const addedProviderTypes = new Set(providers.value.map(p => p.provider));
    return providerTemplates.value.filter(t => !addedProviderTypes.has(t.id));
});

// 添加用于编辑的临时数据
const currentProviderEdit = ref({
    name: "",
    apiUrl: "",
    apiKey: "",
    provider: "custom",
    protocol: "openai"  // 默认协议类型
});

// 判断是否为自定义供应商（只有 custom 类型才可编辑 name、protocol、apiUrl）
const isCustomProvider = computed(() => {
    return currentProviderEdit.value.provider === 'custom';
});

// 删除原来的防抖计时器
// let debounceTimer = null;

// 新增：判断是编辑模式还是新增模式
const isEditMode = ref(false);
const isProviderEditMode = ref(false);

// 获取模型列表相关状态
const showProviderModal = ref(false);
const showFetchModal = ref(false);
const fetchingModels = ref(false);
const fetchedModels = ref([]);


// 供应商表单验证规则
const providerRules = {
    name: {
        required: true,
        message: '请输入供应商名字',
        trigger: ['blur', 'input']
    },
    apiUrl: {
        required: true,
        message: '请输入API地址',
        trigger: ['blur', 'input']
    },
    apiKey: {
        required: false,
        message: '请输入API密钥',
        trigger: ['blur']
    }
};

// 初始化数据函数 - 模拟网络请求
const initData = async () => {
    const response = await apiService.fetchModels();
    response.items.forEach(provider => {
        models.value.push(...provider.models)
        delete provider.models
        providers.value.push(provider)
    })
};

const currentProvider = computed(() => {
    const provider = providers.value.find(p => p.id === currentProviderId.value);
    if (!provider) {
        return { name: "", apiUrl: "", apiKey: "" }
    }
    return provider;
});

const currentModels = computed(() => {
    return models.value.filter(m => m.providerId === currentProviderId.value);
});


const formRef = ref(null);

// 编辑模型相关的新增代码
const showEditModal = ref(false);
const editFormRef = ref(null);
const currentEditModelId = ref(null);

const editModelForm = ref({
    modelName: '',
    modelType: 'text',
    config: {
        inputCapabilities: ['text'],
        outputCapabilities: ['text'],
        features: [],
        contextWindow: null,
        maxOutputTokens: null,
        customParameters: {},
        vectorDimensions: null
    }
});

// 用于双向绑定自定义参数字符串
const customParamsStr = computed({
    get() {
        try {
            return JSON.stringify(editModelForm.value.config.customParameters, null, 2);
        } catch (e) {
            return '';
        }
    },
    set(val) {
        try {
            if (val.trim() === '') {
                editModelForm.value.config.customParameters = {};
            } else {
                editModelForm.value.config.customParameters = JSON.parse(val);
            }
        } catch (e) {
            // 解析失败时不更新，避免报错
        }
    }
});

const modelTypeOptions = [
    { label: '文本', value: 'text' },
    { label: '嵌入', value: 'embedding' }
];

const editModelRules = {
    modelName: { required: true, message: '请输入模型名字', trigger: 'blur' },
    modelType: { required: true, message: '请选择模型类型', trigger: 'change' },
    'config.contextWindow': {
        required: false,
        type: 'number',
        validator: (rule, value) => !value || value > 0,
        message: '请输入有效的上下文窗口长度',
        trigger: 'blur'
    },
    'config.maxOutputTokens': {
        required: false,
        type: 'number',
        validator: (rule, value) => !value || value > 0,
        message: '请输入有效的最大输出长度',
        trigger: 'blur'
    }
};

const getLableName = (type) => {
    switch (type) {
        case 'visual':
            return '视觉';
        case 'tools':
            return '工具调用';
        case 'thinking':
            return '混合思考';
        default:
            return type;
    }
}

// 使用 useDebounceFn 创建防抖函数
const debouncedProviderChange = useDebounceFn(async () => {
    try {
        // 验证表单
        await formRef.value?.validate();

        // 调用后台API更新供应商信息
        await apiService.updateProvider(currentProviderId.value, {
            name: currentProvider.value.name,
            apiKey: currentProvider.value.apiKey,
            apiUrl: currentProvider.value.apiUrl
        });

        // showNotification('success', '保存成功', '供应商信息已更新');
    } catch (errors) {
        // 验证失败，不保存
        console.log('表单验证失败，不保存数据');
    }
}, 200); // 200ms 防抖延迟

// 供应商信息变化处理（使用防抖）
const handleProviderChange = () => {
    debouncedProviderChange();
};

const handleCreateGroup = async () => {
    // 以新增模式打开编辑弹窗
    currentProviderId.value = null;
    // 初始化编辑表单数据
    currentProviderEdit.value = {
        name: "",
        apiUrl: "",
        apiKey: "",
        provider: "custom",  // 自定义供应商标记
        protocol: "openai"   // 默认协议
    };
    // 重置表单验证状态并打开编辑弹窗
    formRef.value?.clearValidate();
    isProviderEditMode.value = false;
    showProviderModal.value = true;
}


const handleSaveProvider = async () => {
    try {
        if (isProviderEditMode.value) {
            // 编辑模式
            const updateData = {
                name: currentProviderEdit.value.name,
                apiKey: currentProviderEdit.value.apiKey,
                apiUrl: currentProviderEdit.value.apiUrl,
                protocol: currentProviderEdit.value.protocol
            };

            // 只有自定义供应商才能修改 name、apiUrl、protocol
            if (!isCustomProvider.value) {
                delete updateData.name;
                delete updateData.apiUrl;
                delete updateData.protocol;
            }

            await apiService.updateProvider(currentProviderId.value, updateData);
            notify.success('更新成功', '供应商信息已更新', { duration: 2000 });

            // 更新列表
            const provider = providers.value.find(p => p.id === currentProviderId.value);
            if (provider) {
                provider.apiKey = currentProviderEdit.value.apiKey;
                // 只有自定义供应商才更新这些字段
                if (isCustomProvider.value) {
                    provider.name = currentProviderEdit.value.name;
                    provider.apiUrl = currentProviderEdit.value.apiUrl;
                    provider.protocol = currentProviderEdit.value.protocol;
                }
            }

            // 关闭弹窗
            showProviderModal.value = false;
        } else {
            const payload = {
                name: currentProviderEdit.value.name,
                apiUrl: currentProviderEdit.value.apiUrl,
                apiKey: currentProviderEdit.value.apiKey,
                provider: currentProviderEdit.value.provider || 'custom',  // 确保传递 provider 字段
                protocol: currentProviderEdit.value.protocol || 'openai'   // 传递协议类型
            };

            const provider = await apiService.createProvider(payload);
            providers.value.push(provider);
            notify.success('创建成功', '分组创建成功', { duration: 2000 });

            // 关闭弹窗
            showProviderModal.value = false;
        }
    } catch (error) {
        console.error('编辑分组失败:', error)
        notify.error('编辑失败', '分组编辑失败', { duration: 2000 });
    }
}

// 获取模型列表
const handleFetchModels = async () => {
    if (!currentProvider.value.apiUrl || !currentProvider.value.apiKey) {
        notify.error('配置错误', '请先配置API地址和API KEY', { duration: 2000 });
        return;
    }

    fetchingModels.value = true;
    showFetchModal.value = true;

    try {
        // 直接调用大语言模型API获取模型列表
        const apiModels = await fetchModelsFromAPI();

        // 从已添加的模型中继承config参数
        const enrichedModels = apiModels.map(apiModel => {
            // 查找当前供应商下是否已添加该模型
            const existingModel = currentModels.value.find(
                model => model.modelName === apiModel.modelName
            );

            if (existingModel) {
                // 如果已添加，则继承config
                return {
                    ...apiModel,
                    id: existingModel.id,
                    config: { ...existingModel.config }
                };
            } else {
                // 如果未添加，使用默认值或从API返回的数据
                return {
                    ...apiModel,
                    config: apiModel.config || { features: [] }
                };
            }
        });

        fetchedModels.value = enrichedModels;
        notify.success('获取成功', `已获取到 ${enrichedModels.length} 个模型`, { duration: 2000 });
    } catch (error) {
        fetchedModels.value = [];
        notify.error('获取失败', '获取模型列表时发生错误', { duration: 2000 });
        console.error('获取模型列表失败:', error);
    } finally {
        fetchingModels.value = false;
    }
};

const fetchModelsFromAPI = async () => {
    const data = await apiService.fetchRemoteModels(currentProvider.value.id)
    return data.items;
};

// 从获取列表中添加模型
const handleAddFromFetch = async (model) => {
    try {
        // 调用后台新增模型API
        const newModel = await apiService.createModel({
            ...model,
            providerId: currentProviderId.value
        });

        const currentModel = fetchedModels.value.find(m => m.modelName === model.modelName);
        if (currentModel) {
            // 如果已存在，则更新ID
            currentModel.id = newModel.id;
        }

        // 添加到本地数据
        models.value.push(newModel);

        // 触发响应式更新
        models.value = [...models.value];

        notify.success('添加成功', `模型 ${model.modelName} 已添加到列表`, { duration: 2000 });
    } catch (error) {
        notify.error('添加失败', '添加模型时发生错误', { duration: 2000 });
    }
};

// 从获取列表中移除模型
const handleRemoveFromFetch = async (model) => {
    try {
        // 调用后台移除模型API
        await apiService.deleteModel(model.id);

        // 从本地数据中移除
        const index = models.value.findIndex(m => m.modelName === model.modelName && m.providerId === currentProviderId.value);
        if (index >= 0) {
            models.value.splice(index, 1);
            models.value = [...models.value];
            notify.success('移除成功', `模型 ${model.modelName} 已从列表中移除`, { duration: 2000 });
        }
    } catch (error) {
        notify.error('移除失败', '移除模型时发生错误', { duration: 2000 });
    }
};

// 新增模型
const handleAddModel = () => {
    isEditMode.value = false;
    currentEditModelId.value = null;

    // 重置表单数据
    editModelForm.value = {
        modelName: '',
        modelType: 'text',
        config: {
            inputCapabilities: ['text'],
            outputCapabilities: ['text'],
            features: [],
            contextWindow: null,
            maxOutputTokens: null,
            customParameters: {},
            vectorDimensions: null
        }
    };

    showEditModal.value = true;
};

// 删除供应商
const handleDeleteProvider = async (provider) => {
    const result = await confirm("删除供应商", `确定要删除供应商"${provider.name}"吗？这将同时删除该供应商下的所有模型，操作不可恢复。`);

    if (!result) {
        return;
    }

    try {
        // 调用删除API
        await deleteProvider(provider.id);

        // 删除该供应商下的所有模型
        models.value = models.value.filter(m => m.provider_id !== provider.id);

        // 更新当前选中的供应商
        if (providers.value.length > 0) {
            currentProviderId.value = providers.value[0].id;
        } else {
            currentProviderId.value = "";
        }

        notify.success('删除成功', `供应商"${provider.name}"已删除`, { duration: 2000 });
    } catch (error) {
        notify.error('删除失败', '删除供应商时发生错误', { duration: 2000 });
    }
};

// 删除供应商的API调用
const deleteProvider = async (providerId) => {
    // 这里应该是实际的API调用
    await apiService.deleteProvider(providerId);

    console.log('删除供应商:', providerId);

    // 更新本地数据
    providers.value = providers.value.filter(p => p.id !== providerId);
};

// 新增模型API调用
const addModel = async (modelData) => {
    // 模拟API调用延迟
    await new Promise(resolve => setTimeout(resolve, 100));

    // 这里应该是实际的API调用
    const model = await apiService.createModel(
        {
            ...modelData,
            providerId: currentProviderId.value
        }
    );

    console.log('新增模型:', model);

    // 添加到本地数据
    models.value.push(model);

    // 触发响应式更新
    models.value = [...models.value];
};

// 加载会话列表
const loadModelsProvider = async () => {
    await initData();
    if (providers.value.length > 0) {
        currentProviderId.value = providers.value[0].id;
    }
}

const handleItemClick = (provider) => {
    // 清除防抖函数（如果有正在等待的执行）
    showDetail.value = true;
    currentProviderId.value = provider.id;
};

const handleEditClick = (model) => {
    isEditMode.value = true;
    currentEditModelId.value = model.id;
    // 填充表单数据
    const config = model.config || {};
    editModelForm.value = {
        modelName: model.modelName || '',
        modelType: model.modelType || 'text',
        config: {
            inputCapabilities: config.inputCapabilities || ['text'],
            outputCapabilities: config.outputCapabilities || ['text'],
            features: config.features || [],
            contextWindow: config.contextWindow || null,
            maxOutputTokens: config.maxOutputTokens || null,
            customParameters: config.customParameters || {},
            vectorDimensions: config.vectorDimensions || null
        }
    };
    showEditModal.value = true;
};

const handleSaveModel = async () => {
    try {
        await editFormRef.value?.validate();

        if (isEditMode.value) {
            // 编辑模式 - 更新模型数据
            const modelIndex = models.value.findIndex(m => m.id === currentEditModelId.value);
            if (modelIndex >= 0) {
                // 使用 Vue 的响应式更新方式
                models.value[modelIndex] = {
                    ...models.value[modelIndex],
                    ...editModelForm.value
                };

                // 强制触发响应式更新
                models.value = [...models.value];

                // 这里应该是实际的API调用
                await apiService.updateModel(currentEditModelId.value,
                    editModelForm.value);
            }
            notify.success('保存成功', '模型信息已更新');
        } else {
            // 新增模式 - 添加新模型
            await addModel(editModelForm.value);
            notify.success('添加成功', '模型已添加');
        }

        showEditModal.value = false;
    } catch (errors) {
        // 验证失败，不关闭模态框
        return false;
    }
};

const handleDeleteClick = async (model) => {
    const result = await confirm("删除模型", "确定要删除该模型吗？删除后将无法恢复。");
    if (!result) {
        return;
    }
    await apiService.deleteModel(model.id);
    // 使用响应式删除方式
    const index = models.value.findIndex(m => m.id === model.id);
    if (index >= 0) {
        models.value.splice(index, 1);
        // 强制触发响应式更新
        models.value = [...models.value];
        notify.success('删除成功', '模型已删除');
    }
}

// 组件卸载时清除计时器（现在由 useDebounceFn 自动处理）
onMounted(() => {
    loadModelsProvider()
    // 获取供应商模板列表用于网格展示
    apiService.getProviderTemplates().then(templates => {
        providerTemplates.value = templates;
    }).catch(error => {
        console.error('获取供应商模板失败:', error);
    });
})

// 添加搜索相关的响应式变量
const searchModelName = ref('')

// 添加搜索处理函数
const handleSearchModel = useDebounceFn((value) => {
    // 防抖处理，无需额外操作，只需依赖 computed 属性
}, 300)

// 计算过滤后的模型列表
const filteredFetchedModels = computed(() => {
    if (!searchModelName.value) {
        return fetchedModels.value
    }

    const searchTerm = searchModelName.value.toLowerCase()
    return fetchedModels.value.filter(model =>
        model.modelName.toLowerCase().includes(searchTerm)
    )
})

const filteredAddedModels = computed(() => {
    const currentModelNames = currentModels.value.map(m => m.modelName)
    return filteredFetchedModels.value.filter(model =>
        currentModelNames.includes(model.modelName)
    )
})

const filteredAvailableModels = computed(() => {
    const currentModelNames = currentModels.value.map(m => m.modelName)
    return filteredFetchedModels.value.filter(model =>
        !currentModelNames.includes(model.modelName)
    )
})

// 添加处理编辑供应商的方法
const handleEditProvider = (provider) => {
    // 设置当前供应商ID
    currentProviderId.value = provider.id;
    isProviderEditMode.value = true;
    // 初始化编辑表单数据
    currentProviderEdit.value = {
        name: provider.name || "",
        apiUrl: provider.apiUrl || "",
        apiKey: provider.apiKey || "",
        provider: provider.provider || "custom",  // 保留原有的 provider 字段
        protocol: provider.protocol || "openai"    // 保留或设置默认协议
    };
    formRef.value?.clearValidate();
    // 重置表单验证状态
    showProviderModal.value = true;

};

// 处理模板点击（从网格中添加）
const handleTemplateClick = async (template) => {
    const result = await confirm("添加供应商", `确定要添加供应商模板 "${template.name}" 吗？`);
    if (!result) return;

    try {
        const payload = {
            template_id: template.id,
            name: template.name,
            apiUrl: template.defaultApiUrl || "",
            apiKey: "",
            provider: template.id,  // 使用模板 id 作为 provider 标识符
            protocol: template.protocol || 'openai'  // 使用模板的协议或默认 openai
        };

        const provider = await apiService.createProvider(payload);
        providers.value.push(provider);

        // 如果返回的供应商包含模型，添加到模型列表
        if (provider.models && provider.models.length > 0) {
            models.value.push(...provider.models);
            notify.success('添加成功', `已添加 ${template.name}，自动创建 ${provider.models.length} 个模型`, { duration: 2000 });
        } else {
            notify.success('添加成功', `已添加 ${template.name}`, { duration: 2000 });
        }
    } catch (error) {
        console.error('添加分组失败:', error);
        notify.error('添加失败', '添加分组时发生错误', { duration: 2000 });
    }
};

// 添加从列表中删除供应商的方法
const handleDeleteProviderFromList = async (provider) => {
    const result = await confirm("删除供应商", `确定要删除供应商"${provider.name}"吗？这将同时删除该供应商下的所有模型，操作不可恢复。`);

    if (!result) {
        return;
    }

    try {
        // 调用删除API
        await deleteProvider(provider.id);

        // 删除该供应商下的所有模型
        models.value = models.value.filter(m => m.provider_id !== provider.id);

        // 更新当前选中的供应商
        if (providers.value.length > 0) {
            currentProviderId.value = providers.value[0].id;
        } else {
            currentProviderId.value = "";
        }

        notify.success('删除成功', `供应商"${provider.name}"已删除`, { duration: 2000 });
    } catch (error) {
        notify.error('删除失败', '删除供应商时发生错误', { duration: 2000 });
    }
};

</script>

<style scoped>
/* 统一输入框内容左对齐 */
:deep(.el-input__inner), :deep(.el-textarea__inner), :deep(.el-input-number__decrease), :deep(.el-input-number__increase) {
    text-align: left !important;
}

/* 优化 Button 组样式，使其更简约 */
:deep(.el-checkbox-button__inner), :deep(.el-radio-button__inner) {
    padding: 6px 12px;
    border-radius: 4px !important; /* 保持微圆角 */
}

/* 调整相邻按钮的间距，避免边框重叠导致的视觉过粗 */
:deep(.el-checkbox-button + .el-checkbox-button), 
:deep(.el-radio-button + .el-radio-button) {
    margin-left: 8px;
}
</style>
