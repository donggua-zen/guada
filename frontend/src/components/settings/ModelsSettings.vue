<template>
    <div class="flex-1"> <template v-if="!showDetail">
            <ModelsProviderList :items="providers" @item-click="handleItemClick" @createGroup="handleCreateGroup"
                @item-edit="handleEditProvider" @item-delete="handleDeleteProviderFromList">
            </ModelsProviderList>
        </template>
        <template v-else>

            <div class="flex items-center mb-6">
                <el-button link style="font-size: 24px" @click="showDetail = false">
                    <el-icon>
                        <ArrowBackIosFilled />
                    </el-icon>
                    <span class="font-bold text-lg mr-2">{{ currentProvider.name }}</span>
                </el-button>

                <el-button link style="font-size: 24px" @click="handleEditProvider(currentProvider)">
                    <el-icon>
                        <SettingsOutlined />
                    </el-icon>
                </el-button>
            </div>
            <div class="flex w-full">
                <div class="flex flex-1 justify-start items-center">
                    <el-space>
                        <el-button @click="handleAddModel">手动添加</el-button>
                        <el-button @click="handleFetchModels">获取模型列表</el-button>
                    </el-space>
                </div>
            </div>
            <div class="mt-4 rounded border px-3 py-1 border-gray-200 dark:border-gray-700">
                <ul>
                    <li v-for="model in currentModels" :key="model.id"
                        class="flex items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                        <div class="font-bold dark:font-normal">{{ model.model_name }}</div>
                        &nbsp;
                        &nbsp;
                        <el-space>
                            <el-tag type="success">{{ model.model_type }}</el-tag>
                            <el-tag v-for="feature in model.features" type="info">{{
                                getLableName(feature) }}</el-tag>
                        </el-space>
                        <div class="flex flex-1 justify-end items-center">
                            <el-button link style="font-size: 24px" @click="handleEditClick(model)">
                                <el-icon>
                                    <SettingsOutlined />
                                </el-icon>
                            </el-button>
                            &nbsp;
                            <el-button type="danger" link style="font-size: 24px" @click="handleDeleteClick(model)">
                                <el-icon>
                                    <RemoveCircleOutlineRound />
                                </el-icon>
                            </el-button>
                        </div>
                    </li>
                </ul>
            </div>
        </template>
    </div>

    <el-dialog v-model="showProviderModal" title="编辑供应商" width="30%" align-center>
        <el-form ref="formRef" :label-width="80" :model="currentProviderEdit" :rules="providerRules" size="large"
            label-position="left">
            <el-form-item label="名字" prop="name">
                <el-input v-model="currentProviderEdit.name" placeholder="输入分组名字" />
            </el-form-item>
            <el-form-item label="API地址" prop="api_url">
                <el-input v-model="currentProviderEdit.api_url" placeholder="api_url" />
            </el-form-item>
            <el-form-item label="API KEY" prop="api_key">
                <el-input v-model="currentProviderEdit.api_key" placeholder="api_key" type="password" show-password />
            </el-form-item>
        </el-form>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="showProviderModal = false">取消</el-button>
                <el-button type="primary" @click="handleSaveProvider">确定</el-button>
            </span>
        </template>
    </el-dialog>

    <!-- 编辑/新增模型信息的模态框 -->
    <el-dialog v-model="showEditModal" :title="isEditMode ? '编辑模型信息' : '新增模型'" width="30%" align-center>
        <el-form ref="editFormRef" :model="editModelForm" :rules="editModelRules" label-position="left"
            label-width="120px" size="large">
            <el-form-item label="模型名字" prop="model_name">
                <el-input v-model="editModelForm.model_name" placeholder="请输入模型名字" />
            </el-form-item>

            <el-form-item label="模型类型" prop="model_type">
                <el-select v-model="editModelForm.model_type" placeholder="请选择模型类型" style="width: 100%">
                    <el-option v-for="option in modelTypeOptions" :key="option.value" :label="option.label"
                        :value="option.value" />
                </el-select>
            </el-form-item>

            <el-form-item label="模型能力" prop="features">
                <el-checkbox-group v-model="editModelForm.features">
                    <el-space>
                        <el-checkbox label="visual" value="visual">视觉</el-checkbox>
                        <el-checkbox label="tools" value="tools">工具</el-checkbox>
                        <el-checkbox label="thinking" value="thinking">混合思考</el-checkbox>
                    </el-space>
                </el-checkbox-group>
            </el-form-item>

            <el-form-item label="最大上下文" prop="max_tokens">
                <el-input-number v-model="editModelForm.max_tokens" placeholder="请输入最大上下文长度" style="width: 100%"
                    :min="1" controls-position="right" />
            </el-form-item>

            <el-form-item label="最大输出长度" prop="max_output_tokens">
                <el-input-number v-model="editModelForm.max_output_tokens" placeholder="请输入最大输出长度" style="width: 100%"
                    :min="1" controls-position="right" />
            </el-form-item>
        </el-form>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="showEditModal = false">取消</el-button>
                <el-button type="primary" @click="handleSaveModel">保存</el-button>
            </span>
        </template>
    </el-dialog>

    <!-- 获取模型列表的模态框 -->
    <el-dialog v-model="showFetchModal" title="获取模型列表" width="50%" align-center>
        <div class="max-h-[60vh] overflow-y-auto">
            <div class="p-4">
                <el-input v-model="searchModelName" placeholder="搜索模型名称" clearable @input="handleSearchModel">
                    <template #prefix>
                        <el-icon>
                            <SearchOutlined />
                        </el-icon>
                    </template>
                </el-input>
            </div>

            <div v-if="fetchingModels" class="flex justify-center items-center py-8">
                <el-icon class="is-loading" style="font-size: 24px;">
                    <!-- <Loading /> -->
                </el-icon>
            </div>
            <div v-else>
                <!-- 已添加的模型 -->
                <div v-if="filteredAddedModels.length > 0">
                    <h3 class="font-bold text-lg mb-3 text-green-600">已添加的模型</h3>
                    <ul>
                        <li v-for="model in filteredAddedModels" :key="model.id"
                            class="flex items-center py-3 border-b border-gray-200 last:border-b-0">
                            <div class="flex-1">
                                <div class="font-bold text-base">{{ model.model_name }}</div>
                                <div class="flex items-center mt-2">
                                    <el-tag type="success">{{ model.model_type }}</el-tag>
                                    <el-space class="ml-2">
                                        <el-tag v-for="feature in model.features" type="info">
                                            {{ getLableName(feature) }}
                                        </el-tag>
                                    </el-space>
                                </div>
                            </div>
                            <el-button type="danger" link @click="handleRemoveFromFetch(model)">
                                <el-icon>
                                    <RemoveCircleTwotone />
                                </el-icon>
                                <span class="ml-1">移除</span>
                            </el-button>
                        </li>
                    </ul>
                </div>

                <!-- 可添加的模型 -->
                <div v-if="filteredAvailableModels.length > 0">
                    <h3 class="font-bold text-lg mb-3 mt-6 text-blue-600">可添加的模型</h3>
                    <ul>
                        <li v-for="model in filteredAvailableModels" :key="model.id"
                            class="flex items-center py-3 border-b border-gray-200 last:border-b-0">
                            <div class="flex-1">
                                <div class="font-bold text-base">{{ model.model_name }}</div>
                                <div class="flex items-center mt-2">
                                    <el-tag type="success">{{ model.model_type }}</el-tag>
                                    <el-space class="ml-2">
                                        <el-tag v-for="feature in model.features" type="info">
                                            {{ getLableName(feature) }}
                                        </el-tag>
                                    </el-space>
                                </div>
                            </div>
                            <el-button link type="primary" @click="handleAddFromFetch(model)" size="small">
                                <el-icon>
                                    <AddCircleTwotone />
                                </el-icon>
                                <span class="ml-1">添加</span>
                            </el-button>
                        </li>
                    </ul>
                </div>

                <div v-if="filteredFetchedModels.length === 0" class="text-center py-8 text-gray-500">
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
    RemoveCircleTwotone, SearchOutlined, ArrowBackIosFilled
} from '@vicons/material'
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
    ElInputNumber
} from 'element-plus'

const { notify, confirm, prompt } = usePopup()
const currentProviderId = ref("");

// 使用响应式数据替代伪数据
const providers = ref([]);
const models = ref([]);
const showDetail = ref(false);

// 添加用于编辑的临时数据
const currentProviderEdit = ref({
    name: "",
    api_url: "",
    api_key: ""
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
    api_url: {
        required: true,
        message: '请输入API地址',
        trigger: ['blur', 'input']
    },
    api_key: {
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
        return { name: "", api_url: "", api_key: "" }
    }
    return provider;
});

const currentModels = computed(() => {
    return models.value.filter(m => m.provider_id === currentProviderId.value);
});


const formRef = ref(null);

// 编辑模型相关的新增代码
const showEditModal = ref(false);
const editFormRef = ref(null);
const currentEditModelId = ref(null);

const editModelForm = ref({
    model_name: '',
    type: 'text',
    features: [],
    max_tokens: null,
    max_output_tokens: null
});

const modelTypeOptions = [
    { label: '文本', value: 'text' },
    { label: '嵌入', value: 'embedding' }
];

const editModelRules = {
    model_name: { required: true, message: '请输入模型名字', trigger: 'blur' },
    type: { required: true, message: '请选择模型类型', trigger: 'change' },
    max_tokens: {
        required: false,
        type: 'number',
        validator: (rule, value) => value > 0 || value === null,
        message: '请输入有效的最大上下文长度',
        trigger: 'blur'
    },
    max_output_tokens: {
        required: false,
        type: 'number',
        validator: (rule, value) => value > 0 || value === null,
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
            api_key: currentProvider.value.api_key,
            api_url: currentProvider.value.api_url
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
        name: "新分组",
        api_url: "",
        api_key: ""
    };
    // 重置表单验证状态并打开编辑弹窗
    formRef.value?.restoreValidation();
    isProviderEditMode.value = false;
    showProviderModal.value = true;
}


const handleSaveProvider = async () => {
    try {
        if (isProviderEditMode.value) {
            // 编辑模式
            await apiService.updateProvider(currentProviderId.value, {
                name: currentProviderEdit.value.name,
                api_key: currentProviderEdit.value.api_key,
                api_url: currentProviderEdit.value.api_url
            })
            notify.success('更新成功', '供应商信息已更新', { duration: 2000 });
            //更新列表
            const provider = providers.value.find(p => p.id === currentProviderId.value);
            provider.name = currentProviderEdit.value.name;
            provider.api_url = currentProviderEdit.value.api_url;
            provider.api_key = currentProviderEdit.value.api_key;
        } else {
            const provider = await apiService.createProvider({
                name: currentProviderEdit.value.name,
                api_url: currentProviderEdit.value.api_url,
                api_key: currentProviderEdit.value.api_key
            });
            providers.value.push(provider); notify.success('创建成功', '分组创建成功', { duration: 2000 });
        }
    } catch (error) {
        console.error('编辑分组失败:', error)
        notify.error('编辑失败', '分组编辑失败', { duration: 2000 });
    }
}

// 获取模型列表
const handleFetchModels = async () => {
    if (!currentProvider.value.api_url || !currentProvider.value.api_key) {
        notify.error('配置错误', '请先配置API地址和API KEY', { duration: 2000 });
        return;
    }

    fetchingModels.value = true;
    showFetchModal.value = true;

    try {
        // 直接调用大语言模型API获取模型列表
        const apiModels = await fetchModelsFromAPI();

        // 从已添加的模型中继承features和type参数
        const enrichedModels = apiModels.map(apiModel => {
            // 查找当前供应商下是否已添加该模型
            const existingModel = currentModels.value.find(
                model => model.model_name === apiModel.model_name
            );

            if (existingModel) {
                // 如果已添加，则继承features和type
                return {
                    ...apiModel,
                    id: existingModel.id,
                    model_type: existingModel.model_type,
                    features: [...existingModel.features]
                };
            } else {
                // 如果未添加，使用默认值或从API返回的数据
                return {
                    ...apiModel,
                    model_type: apiModel.model_type || 'text', // 使用API返回的类型或默认text
                    features: apiModel.features || [] // 使用API返回的features或空数组
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
            provider_id: currentProviderId.value
        });

        const currentModel = fetchedModels.value.find(m => m.model_name === model.model_name);
        if (currentModel) {
            // 如果已存在，则更新ID
            currentModel.id = newModel.id;
        }

        // 添加到本地数据
        models.value.push(newModel);

        // 触发响应式更新
        models.value = [...models.value];

        notify.success('添加成功', `模型 ${model.model_name} 已添加到列表`, { duration: 2000 });
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
        const index = models.value.findIndex(m => m.model_name === model.model_name && m.provider_id === currentProviderId.value);
        if (index >= 0) {
            models.value.splice(index, 1);
            models.value = [...models.value];
            notify.success('移除成功', `模型 ${model.model_name} 已从列表中移除`, { duration: 2000 });
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
        model_name: '',
        model_type: 'text',
        features: [],
        max_tokens: null,
        max_output_tokens: null
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
            provider_id: currentProviderId.value
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
    editModelForm.value = {
        model_name: model.model_name || '',
        model_type: model.model_type || 'text',
        features: model.features ? [...model.features] : [],
        max_tokens: model.max_tokens || null,
        max_output_tokens: model.max_output_tokens || null
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
        model.model_name.toLowerCase().includes(searchTerm)
    )
})

const filteredAddedModels = computed(() => {
    const currentModelIds = currentModels.value.map(m => m.model_name)
    return filteredFetchedModels.value.filter(model =>
        currentModelIds.includes(model.model_name)
    )
})

const filteredAvailableModels = computed(() => {
    const currentModelIds = currentModels.value.map(m => m.model_name)
    return filteredFetchedModels.value.filter(model =>
        !currentModelIds.includes(model.model_name)
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
        api_url: provider.api_url || "",
        api_key: provider.api_key || ""
    };

    // 重置表单验证状态
    formRef.value?.restoreValidation();
    showProviderModal.value = true;
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

<style scoped></style>
