<template>
    <div class="flex-1"> <template v-if="!showDetail">
            <ModelsProviderList :items="providers" @item-click="handleItemClick" @createGroup="handleCreateGroup"
                @item-edit="handleEditProvider" @item-delete="handleDeleteProviderFromList">
            </ModelsProviderList>
        </template>
        <template v-else>

            <div class="flex items-center mb-6">
                <UiButton text style="font-size: 24px" @click="showDetail = false">
                    <n-icon size="16">
                        <ArrowBackIosFilled />
                    </n-icon>
                    <span class="font-bold text-lg mr-2">{{ currentProvider.name }}</span>
                </UiButton>

                <UiButton text style="font-size: 24px" @click="handleEditProvider(currentProvider)">
                    <n-icon>
                        <SettingsOutlined />
                    </n-icon>
                </UiButton>
            </div>
            <div class="flex w-full">
                <div class="flex flex-1 justify-start items-center">
                    <n-space>
                        <UiButton @click="handleAddModel" strong secondary>手动添加</UiButton>
                        <UiButton @click="handleFetchModels" strong secondary>获取模型列表</UiButton>
                    </n-space>
                </div>
            </div>
            <div class="mt-4 rounded border px-3 py-1 border-gray-200 dark:border-gray-700">
                <ul>
                    <li v-for="model in currentModels" :key="model.id"
                        class="flex items-center py-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                        <div class="font-bold dark:font-normal">{{ model.model_name }}</div>
                        &nbsp;
                        &nbsp;
                        <n-space>
                            <n-tag :bordered="false" type="success" size="small">{{ model.model_type }}</n-tag>
                            <n-tag v-for="feature in model.features" :bordered="false" type="info" size="small">{{
                                getLableName(feature) }}</n-tag>
                        </n-space>
                        <div class="flex flex-1 justify-end items-center">
                            <UiButton text style="font-size: 24px" @click="handleEditClick(model)">
                                <n-icon>
                                    <SettingsOutlined />
                                </n-icon>
                            </UiButton>
                            &nbsp;
                            <UiButton type="error" text style="font-size: 24px" @click="handleDeleteClick(model)">
                                <n-icon>
                                    <RemoveCircleOutlineRound />
                                </n-icon>
                            </UiButton>
                        </div>
                    </li>
                </ul>
            </div>
        </template>
    </div>

    <n-modal v-model:show="showProviderModal" preset="dialog" title="编辑供应商" positive-text="确定" negative-text="取消"
        @positive-click="handleSaveProvider">
        <n-form ref="formRef" :label-width="80" :model="currentProviderEdit" :rules="providerRules" size="large"
            label-placement="left">
            <n-form-item label="名字" path="name">
                <n-input v-model:value="currentProviderEdit.name" placeholder="输入分组名字" />
            </n-form-item>
            <n-form-item label="API地址" path="api_url">
                <n-input v-model:value="currentProviderEdit.api_url" placeholder="api_url" />
            </n-form-item>
            <n-form-item label="API KEY" path="api_key">
                <n-input v-model:value="currentProviderEdit.api_key" placeholder="api_key" type="password"
                    show-password-on="click" />
            </n-form-item>
        </n-form>
    </n-modal>

    <!-- 编辑/新增模型信息的模态框 -->
    <n-modal v-model:show="showEditModal" :preset="isEditMode ? 'dialog' : 'dialog'"
        :title="isEditMode ? '编辑模型信息' : '新增模型'" positive-text="保存" negative-text="取消" @positive-click="handleSaveModel">
        <n-form ref="editFormRef" :model="editModelForm" :rules="editModelRules" label-placement="left"
            label-width="120px" size="large">
            <n-form-item label="模型名字" path="model_name">
                <n-input v-model:value="editModelForm.model_name" placeholder="请输入模型名字" />
            </n-form-item>

            <n-form-item label="模型类型" path="model_type">
                <n-select v-model:value="editModelForm.model_type" :options="modelTypeOptions" placeholder="请选择模型类型" />
            </n-form-item>

            <n-form-item label="模型能力" path="features">
                <n-checkbox-group v-model:value="editModelForm.features">
                    <n-space>
                        <n-checkbox value="visual" label="视觉" />
                        <n-checkbox value="tools" label="工具" />
                        <n-checkbox value="thinking" label="混合思考" />
                    </n-space>
                </n-checkbox-group>
            </n-form-item>

            <n-form-item label="最大上下文" path="max_tokens">
                <n-input-number v-model:value="editModelForm.max_tokens" placeholder="请输入最大上下文长度" style="width: 100%"
                    :min="1" />
            </n-form-item>

            <n-form-item label="最大输出长度" path="max_output_tokens">
                <n-input-number v-model:value="editModelForm.max_output_tokens" placeholder="请输入最大输出长度"
                    style="width: 100%" :min="1" />
            </n-form-item>
        </n-form>
    </n-modal>

    <!-- 获取模型列表的模态框 -->
    <n-modal v-model:show="showFetchModal" preset="dialog" title="获取模型列表" :show-footer="false"
        style="width: 90%; max-width: 800px">
        <div class="max-h-[60vh] overflow-y-auto">
            <div class="p-4">
                <n-input v-model:value="searchModelName" placeholder="搜索模型名称" clearable
                    @update:value="handleSearchModel">
                    <template #prefix>
                        <n-icon>
                            <SearchOutlined />
                        </n-icon>
                    </template>
                </n-input>
            </div>

            <div v-if="fetchingModels" class="flex justify-center items-center py-8">
                <n-spin size="large" />
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
                                    <n-tag :bordered="false" type="success" size="small">{{ model.model_type }}</n-tag>
                                    <n-space class="ml-2">
                                        <n-tag v-for="feature in model.features" :bordered="false" type="info"
                                            size="small">
                                            {{ getLableName(feature) }}
                                        </n-tag>
                                    </n-space>
                                </div>
                            </div>
                            <UiButton type="error" text @click="handleRemoveFromFetch(model)">
                                <n-icon>
                                    <RemoveCircleTwotone />
                                </n-icon>
                                <span class="ml-1">移除</span>
                            </UiButton>
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
                                    <n-tag :bordered="false" type="success" size="small">{{ model.model_type }}</n-tag>
                                    <n-space class="ml-2">
                                        <n-tag v-for="feature in model.features" :bordered="false" type="info"
                                            size="small">
                                            {{ getLableName(feature) }}
                                        </n-tag>
                                    </n-space>
                                </div>
                            </div>
                            <UiButton text type="primary" @click="handleAddFromFetch(model)" size="small">
                                <AddCircleTwotone />
                                <span class="ml-1">添加</span>
                            </UiButton>
                        </li>
                    </ul>
                </div>

                <div v-if="filteredFetchedModels.length === 0" class="text-center py-8 text-gray-500">
                    暂无匹配的模型数据
                </div>
            </div>
        </div>
    </n-modal>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core' // 导入防抖函数
import { UiButton } from "../ui";
import ModelsProviderList from './ModelsProviderList.vue'
import {
    NInput, NFormItem, NForm, NButton, NSpace, NIcon, NTag, NGrid, NGi,
    NModal, NSelect, NCheckbox, NCheckboxGroup, NInputNumber, NSpin, NDivider
} from 'naive-ui'
import { apiService } from '../../services/ApiService'
import {
    SettingsOutlined, RemoveCircleOutlineRound, DeleteTwotone, AddCircleTwotone,
    RemoveCircleTwotone, SearchOutlined, ArrowBackIosFilled
} from '@vicons/material'
import { usePopup } from '../../composables/usePopup'
import { useStorage } from '@vueuse/core'

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
    const data = await apiService.fetchModels();
    providers.value = data.providers;
    models.value = data.models;
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