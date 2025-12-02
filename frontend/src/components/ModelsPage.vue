<template>
    <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-position="'left'">
        <template #sidebar>
            <ModelsProviderList :items="providers" :selectedId="currentProviderId" @select="handleSelectProvider"
                @createGroup="handleCreateGroup">
            </ModelsProviderList>
        </template>
        <template #content>
            <div class="flex-1 p-[20px] sm:container mx-auto">
                <div class="flex items-center mb-3">
                    <span class="font-bold text-lg mr-2">{{ currentProvider.name }}</span>
                    <n-button type="error" text style="font-size: 24px" @click="handleDeleteProvider(currentProvider)">
                        <n-icon>
                            <DeleteTwotone />
                        </n-icon>
                    </n-button>
                </div>
                <n-divider title-placement="left">
                    供应商/分组信息
                </n-divider>
                <n-form ref="formRef" :label-width="80" :model="currentProvider" :rules="providerRules" size="large"
                    label-placement="left">
                    <n-form-item label="名字" path="name">
                        <n-input v-model:value="currentProvider.name" placeholder="输入分组名字"
                            @update:value="handleProviderChange" />
                    </n-form-item>
                    <n-form-item label="API地址" path="api_url">
                        <n-input v-model:value="currentProvider.api_url" placeholder="api_url"
                            @update:value="handleProviderChange" />
                    </n-form-item>

                    <!-- 使用 Grid 布局将 API KEY 和按钮放在同一行 -->
                    <n-grid :cols="24" :x-gap="12">
                        <n-gi :span="18">
                            <n-form-item label="API KEY" path="api_key">
                                <n-input v-model:value="currentProvider.api_key" placeholder="api_key"
                                    @update:value="handleProviderChange" />
                            </n-form-item>
                        </n-gi>
                        <n-gi :span="6">
                            <n-form-item label=" ">
                                <n-button attr-type="button" @click="handleValidateClick">
                                    验证
                                </n-button>
                            </n-form-item>
                        </n-gi>
                    </n-grid>
                </n-form>
                <n-divider title-placement="left">
                    模型列表
                </n-divider>
                <div class="flex w-full">
                    <div class="flex flex-1 justify-start items-center">
                        <n-space>
                            <n-button @click="handleAddModel" strong secondary>手动添加</n-button>
                            <n-button @click="handleFetchModels" strong secondary>获取模型列表</n-button>
                        </n-space>
                    </div>
                </div>
                <div class="mt-4 rounded border px-3 py-1 border-gray-200">
                    <ul>
                        <li v-for="model in currentModels" :key="model.id"
                            class="flex items-center py-2 border-b border-gray-200 last:border-b-0">
                            <div class="font-bold">{{ model.model_name }}</div>
                            &nbsp;
                            &nbsp;
                            <n-space>
                                <n-tag :bordered="false" type="success" size="small">{{ model.model_type }}</n-tag>
                                <n-tag v-for="feature in model.features" :bordered="false" type="info" size="small">{{
                                    getLableName(feature) }}</n-tag>
                            </n-space>
                            <div class="flex flex-1 justify-end items-center">
                                <n-button text style="font-size: 24px" @click="handleEditClick(model)">
                                    <n-icon>
                                        <SettingsOutlined />
                                    </n-icon>
                                </n-button>
                                &nbsp;
                                <n-button type="error" text style="font-size: 24px" @click="handleDeleteClick(model)">
                                    <n-icon>
                                        <RemoveCircleOutlineRound />
                                    </n-icon>
                                </n-button>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>
        </template>
    </SidebarLayout>

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
            <div v-if="fetchingModels" class="flex justify-center items-center py-8">
                <n-spin size="large" />
            </div>
            <div v-else>
                <!-- 已添加的模型 -->
                <div v-if="addedModels.length > 0">
                    <h3 class="font-bold text-lg mb-3 text-green-600">已添加的模型</h3>
                    <ul>
                        <li v-for="model in addedModels" :key="model.id"
                            class="flex items-center py-3 border-b border-gray-200 last:border-b-0">
                            <div class="flex-1">
                                <div class="font-bold text-lg">{{ model.model_name }}</div>
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
                            <n-button type="error" text @click="handleRemoveFromFetch(model)">
                                <n-icon>
                                    <RemoveCircleTwotone />
                                </n-icon>
                                <span class="ml-1">移除</span>
                            </n-button>
                        </li>
                    </ul>
                </div>

                <!-- 可添加的模型 -->
                <div v-if="availableModels.length > 0">
                    <h3 class="font-bold text-lg mb-3 mt-6 text-blue-600">可添加的模型</h3>
                    <ul>
                        <li v-for="model in availableModels" :key="model.id"
                            class="flex items-center py-3 border-b border-gray-200 last:border-b-0">
                            <div class="flex-1">
                                <div class="font-bold text-lg">{{ model.model_name }}</div>
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
                            <n-button type="primary" @click="handleAddFromFetch(model)">
                                <n-icon>
                                    <AddCircleTwotone />
                                </n-icon>
                                <span class="ml-1">添加</span>
                            </n-button>
                        </li>
                    </ul>
                </div>

                <div v-if="fetchedModels.length === 0" class="text-center py-8 text-gray-500">
                    暂无模型数据
                </div>
            </div>
        </div>
    </n-modal>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core' // 导入防抖函数
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import ModelsProviderList from '@/components/ModelsProviderList.vue'
import {
    NInput, NFormItem, NForm, NButton, NSpace, NIcon, NTag, NGrid, NGi,
    NModal, NSelect, NCheckbox, NCheckboxGroup, NInputNumber, NSpin, NDivider
} from 'naive-ui'
import { apiService } from '@/services/ApiService'
import { SettingsOutlined, RemoveCircleOutlineRound, DeleteTwotone, AddCircleTwotone, RemoveCircleTwotone } from '@vicons/material'
import { usePopup } from '@/composables/usePopup'
import { useStorage } from '@vueuse/core'

const { notify, confirm, prompt } = usePopup()
const currentProviderId = ref("");

// 使用响应式数据替代伪数据
const providers = ref([]);
const models = ref([]);

// 删除原来的防抖计时器
// let debounceTimer = null;

// 新增：判断是编辑模式还是新增模式
const isEditMode = ref(false);

// 获取模型列表相关状态
const showFetchModal = ref(false);
const fetchingModels = ref(false);
const fetchedModels = ref([]);

const sidebarVisible = useStorage('modelsPage_sidebarVisible', true); // 控制侧边栏显示状态

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

// 计算已添加和可添加的模型
const addedModels = computed(() => {
    const currentModelIds = currentModels.value.map(m => m.model_name);
    return fetchedModels.value.filter(model => currentModelIds.includes(model.model_name));
});

const availableModels = computed(() => {
    const currentModelIds = currentModels.value.map(m => m.model_name);
    return fetchedModels.value.filter(model => !currentModelIds.includes(model.model_name));
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
    try {
        const result = await prompt('创建分组', {
            placeholder: '创建模型组',
        })

        if (result) {
            const title = result;
            const provider = await apiService.createProvider({
                name: title,
                api_url: "",
                api_key: ""
            });
            providers.value.push(provider);
            currentProviderId.value = providers.value[providers.value.length - 1].id;
            notify.success('创建成功', '分组创建成功', { duration: 2000 });
        }
    } catch (error) {
        console.error('创建会话失败:', error)
        notify.error('创建失败', '分组创建成功', { duration: 2000 });
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

// 模拟从大语言模型API获取模型列表
const fetchModelsFromAPI = async () => {
    // 这里应该是实际的大语言模型API调用
    let apiUrl = currentProvider.value.api_url;
    if (apiUrl.includes('https://dashscope.aliyuncs.com')) {
        apiUrl = apiUrl.replace('https://dashscope.aliyuncs.com', '/proxy/aliyun');
    }
    const response = await fetch(apiUrl + '/models', {
        headers: {
            'Authorization': `Bearer ${currentProvider.value.api_key}`,
            'Content-Type': 'application/json'
        }
    });
    const data = await response.json();
    return data.data.map(model => ({
        model_name: model.id,
        type: 'text', // 根据实际情况获取
        features: []  // 根据实际情况获取
    }));
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

const handleSelectProvider = (providerId) => {
    // 清除防抖函数（如果有正在等待的执行）
    console.log(debouncedProviderChange);

    currentProviderId.value = providerId;
    // 重置表单验证状态
    formRef.value?.restoreValidation();
}

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
</script>

<style scoped></style>