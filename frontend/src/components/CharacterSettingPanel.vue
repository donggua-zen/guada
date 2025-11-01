<template>
    <div class="flex flex-col h-full">
        <div class="settings-header" v-if="!isCharacterMode">
            <h2>智能体设置</h2>
        </div>
        <div class="flex-1" :class="{ 'p-3': !isCharacterMode }">
            <n-tabs type="segment" ref="tabsInstRef" v-model:value="tabsValue">
                <!-- 基础设置 -->
                <n-tab-pane name="basic" tab="基础" display-directive="show">
                    <div class="py-5">
                        <n-form ref="basicFormRef" :model="characterForm" :rules="basicRules" label-placement="top"
                            label-width="80px" size="large">
                            <!-- 头像设置 -->
                            <n-form-item label="头像设置">
                                <div class="avatar-upload-container">
                                    <div class="avatar-preview">
                                        <Avatar :src="characterForm.avatar_url"></Avatar>
                                    </div>
                                    <div class="avatar-upload-actions">
                                        <n-button @click="triggerAvatarUpload" size="medium">
                                            <template #icon>
                                                <n-icon>
                                                    <UploadOutlined />
                                                </n-icon>
                                            </template>
                                            上传头像
                                        </n-button>
                                        <n-button @click="removeAvatar" v-if="characterForm.avatar_url" size="medium">
                                            <template #icon>
                                                <n-icon>
                                                    <DeleteOutlined />
                                                </n-icon>
                                            </template>
                                            移除
                                        </n-button>
                                    </div>
                                    <input ref="avatarInput" type="file" accept="image/*" style="display: none"
                                        @change="handleAvatarUpload">
                                </div>
                            </n-form-item>

                            <!-- 角色标题 -->
                            <n-form-item label="角色标题" path="title">
                                <n-input v-model:value="characterForm.title" placeholder="请输入角色标题" />
                            </n-form-item>

                            <!-- 角色描述 -->
                            <n-form-item label="角色描述" path="description">
                                <n-input v-model:value="characterForm.description" type="textarea" placeholder="请输入角色描述"
                                    :autosize="{ minRows: 3, maxRows: 5 }" />
                            </n-form-item>
                        </n-form>
                    </div>
                </n-tab-pane>

                <!-- 提示词 -->
                <n-tab-pane name="prompt" tab="提示词" display-directive="show">
                    <div class="py-5">
                        <n-form ref="promptFormRef" :model="characterForm" :rules="promptRules" label-placement="top"
                            label-width="80px" size="large">
                            <!-- 角色名称 -->
                            <n-form-item label="角色名称">
                                <n-input v-model:value="characterForm.assistant_name" placeholder="请输入角色名称" />
                            </n-form-item>

                            <!-- 职业设定 -->
                            <n-form-item label="职业设定">
                                <n-input v-model:value="characterForm.assistant_identity" placeholder="请输入职业设定" />
                            </n-form-item>

                            <!-- 详细设定 -->
                            <n-form-item label="详细设定" path="system_prompt">
                                <n-input v-model:value="characterForm.system_prompt" type="textarea"
                                    placeholder="请输入详细设定" :autosize="{ minRows: 5, maxRows: 8 }" />
                            </n-form-item>
                        </n-form>
                    </div>
                </n-tab-pane>

                <!-- 模型设置 -->
                <n-tab-pane name="model" tab="模型" v-if="!isCharacterMode" display-directive="show">
                    <div class="py-5">
                        <n-form ref="modelFormRef" :model="characterForm" :rules="modelRules" label-placement="top"
                            label-width="80px" size="large">
                            <!-- 模型选择 -->
                            <n-form-item label="模型选择">

                                <n-select v-model:value="characterForm.model_id" :options="modelOptions"
                                    placeholder="请选择模型"
                                    :fallback-option="(value) => ({ label: `请选择模型`, value:'' })" />
                            </n-form-item>

                            <!-- 温度设置 -->
                            <n-form-item label="温度">
                                <n-slider v-model:value="characterForm.model_temperature" :min="0" :max="2"
                                    :step="0.1" />
                                <n-input-number v-model:value="characterForm.model_temperature" :min="0" :max="2"
                                    :step="0.1" style="margin-left: 12px; width: 140px;" />
                            </n-form-item>

                            <!-- Top P -->
                            <n-form-item label="Top P">
                                <n-slider v-model:value="characterForm.model_top_p" :min="0" :max="1" :step="0.1" />
                                <n-input-number v-model:value="characterForm.model_top_p" :min="0" :max="1" :step="0.1"
                                    style="margin-left: 12px; width: 140px;" />
                            </n-form-item>

                            <!-- 最大长度 -->
                            <n-form-item label="最大长度">
                                <n-input-number v-model:value="characterForm.model_max_tokens" :min="100" :max="4096"
                                    :step="100" placeholder="默认2048" style="width: 200px;" />
                            </n-form-item>

                            <!-- 频率惩罚 -->
                            <n-form-item label="频率惩罚">
                                <n-slider v-model:value="characterForm.model_frequency_penalty" :min="0" :max="2"
                                    :step="0.1" />
                                <n-input-number v-model:value="characterForm.model_frequency_penalty" :min="0" :max="2"
                                    :step="0.1" style="margin-left: 12px; width: 140px;" />
                            </n-form-item>
                        </n-form>
                    </div>
                </n-tab-pane>

                <!-- 记忆设置 -->
                <n-tab-pane name="memory" tab="记忆" display-directive="show">
                    <div class="py-5">
                        <n-form ref="memoryFormRef" :model="characterForm" :rules="memoryRules" label-placement="top"
                            size="large">
                            <!-- 记忆类型 -->
                            <n-form-item label="记忆类型">
                                <n-select v-model:value="characterForm.memory_type" :options="memoryOptions"
                                    placeholder="请选择记忆类型" />
                            </n-form-item>

                            <!-- 最大记忆长度 -->
                            <n-form-item label="最大记忆长度">
                                <n-input-number v-model:value="characterForm.max_memory_length" :min="0" :max="10000"
                                    placeholder="默认值" style="width: 200px;" />
                                <span style="margin-left: 8px; color: #999;">条消息</span>
                            </n-form-item>

                            <!-- 短期记忆长度 -->
                            <n-form-item label="短期记忆长度">
                                <n-input-number v-model:value="characterForm.short_term_memory_length" :min="0"
                                    :max="1000" placeholder="默认值" style="width: 200px;" />
                                <span style="margin-left: 8px; color: #999;">条消息</span>
                            </n-form-item>
                        </n-form>
                    </div>
                </n-tab-pane>
            </n-tabs>
        </div>
        <div class="footer p-5">
            <n-button block type="primary" @click="handleSave" size="large">
                <template #icon>
                    <n-icon>
                        <SaveOutlined />
                    </n-icon>
                </template>
                保存全部设置
            </n-button>
        </div>
    </div>
    <!-- 头像裁剪模态框 -->
    <n-modal v-model:show="showCropModal" preset="card" title="裁剪头像" style="width: 600px;">
        <div class="modal-body">
            <cropper ref="cropperAvatar" :src="cropImageSrc" :stencil-props="{
                aspectRatio: 1,
                movable: true,
                resizable: true
            }" :resize-image="{
                adjustStencil: false
            }" @change="handleCropChange" :output-type="'png'" :output-size="{ width: 500, height: 500 }" />
        </div>
        <template #footer>
            <n-space justify="end">
                <n-button @click="closeCropModal">取消</n-button>
                <n-button type="primary" @click="cropAvatar">确认裁剪</n-button>
            </n-space>
        </template>
    </n-modal>

</template>

<script setup>
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import {
    NTabs,
    NTabPane,
    NForm,
    NFormItem,
    NInput,
    NSelect,
    NButton,
    NIcon,
    NSlider,
    NInputNumber,
    NSpace,
    useMessage,
    NModal,
} from 'naive-ui'
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
import {
    UserOutlined,
    UploadOutlined,
    DeleteOutlined,
    SaveOutlined,
    CloseOutlined
} from '@vicons/antd'

import { apiService } from '../services/llmApi'
import { required } from '@vuelidate/validators'
import Avatar from '../components/Avatar.vue'


const message = useMessage()

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
            avatar_url: '',
            settings: {
                assistant_name: '',
                assistant_identity: '',
                system_prompt: '',
                model_id: '',
                memory_type: '',
                model_temperature: 0.7,
                model_max_tokens: 2048,
                model_top_p: 0.9,
                model_frequency_penalty: 0.5,
                max_memory_length: 1000,
                short_term_memory_length: 100
            }
        })
    }
})

// Emits
const emit = defineEmits(['update:data', 'saved'])

// 响应式数据
const isCharacterMode = ref(false)
const loading = ref(false)
const showCropModal = ref(false)
const cropImageSrc = ref('')
const cropFile = ref(null)
const cropperAvatar = ref(null)
const avatarInput = ref(null)

// 模型数据
const models = ref([]);
const providers = ref([]);

// 抽屉宽度响应式
const drawerWidth = ref(600)

// 表单引用
const tabsInstRef = ref(null)
const basicFormRef = ref(null)
const promptFormRef = ref(null)
const modelFormRef = ref(null)
const memoryFormRef = ref(null)

const tabsValue = ref('basic')

// 表单数据
const characterForm = reactive({
    id: '',
    title: '',
    description: '',
    avatar_url: '',
    avatar_file: null,
    assistant_name: '',
    assistant_identity: '',
    system_prompt: '',
    model_id: '',
    memory_type: '',
    model_temperature: 0.7,
    model_max_tokens: 2048,
    model_top_p: 0.9,
    model_frequency_penalty: 0.5,
    max_memory_length: 1000,
    short_term_memory_length: 100
})

// 验证规则
const basicRules = {
    title: [
        { required: true, message: '请输入角色标题', trigger: ['input', 'blur'] },
        { min: 4, max: 20, message: '标题长度在4-20个字符之间', trigger: ['input', 'blur'] }
    ]
}

const promptRules = {
    system_prompt: [
        { required: true, message: '请输入详细设定', trigger: ['input', 'blur'] },
        { min: 8, max: 4000, message: '详细设定长度在8-4000个字符之间', trigger: ['input', 'blur'] }
    ]
}

const modelRules = {
    model_id: [
        { required: true, message: '请选择模型', trigger: ['change'] },
    ],
}

const memoryRules = {
    memory_type: [
        { required: true, message: '请选择记忆类型', trigger: ['change'] },
    ]
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
            model.provider_id === provider.id && model.model_type === 'text'
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
                    label: model.model_name,
                    value: model.id,
                    key: model.id
                })
            })
        }
    })
    console.log(options);
    return options
})

// 响应式调整抽屉宽度
// const updateDrawerWidth = () => {
//     const width = window.innerWidth
//     if (width < 768) {
//         drawerWidth.value = '90%'
//     } else if (width < 1200) {
//         drawerWidth.value = 400
//     } else {
//         drawerWidth.value = 400
//     }
// }

// 监听props.show变化
watch(() => props.simple, (newVal) => {
    isCharacterMode.value = newVal;
    console.log("style:" + newVal);
}, { immediate: true })

watch(() => props.data, (newVal) => {

    characterForm.avatar_file = null;
    if (characterForm.avatar_url && characterForm.avatar_url.startsWith('blob:')) {
        URL.revokeObjectURL(characterForm.avatar_url);
        characterForm.avatar_url = '';
    }

    characterForm.id = newVal.id || '';
    characterForm.title = newVal.title || '';
    characterForm.description = newVal.description || '';
    characterForm.avatar_url = newVal.avatar_url || '';
    //if (newVal.settings) {
    characterForm.assistant_name = newVal.settings?.assistant_name || '';
    characterForm.assistant_identity = newVal.settings?.assistant_identity || '';
    characterForm.system_prompt = newVal.settings?.system_prompt || '';
    characterForm.model_id = newVal.settings?.model_id || '';
    characterForm.memory_type = newVal.settings?.memory_type || 'sliding_window';
    if (!isCharacterMode.value) {
        characterForm.model_temperature = newVal.settings?.model_temperature || 0.7;
        characterForm.model_max_tokens = newVal.settings?.model_max_tokens || 2048;
        characterForm.model_top_p = newVal.settings?.model_top_p || 0.9;
        characterForm.model_frequency_penalty = newVal.settings?.model_frequency_penalty || 0.5;
        characterForm.max_memory_length = newVal.settings?.max_memory_length || 1000;
        characterForm.short_term_memory_length = newVal.settings?.short_term_memory_length || 100;
    }
    //}

}, { immediate: true })

const loadModels = async () => {
    try {
        const response = await apiService.getModels()

        models.value = response.models || []
        providers.value = response.providers || []

    } catch (error) {
        console.error('获取模型列表失败:', error)
        PopupService.toast('获取模型列表失败', 'error')
    }
}

// 生命周期
onMounted(async () => {
    if (!isCharacterMode.value)
        loadModels();
})

onUnmounted(() => {
    // window.removeEventListener('resize', updateDrawerWidth)
    if (characterForm.avatar_url && characterForm.avatar_url.startsWith('blob:')) {
        URL.revokeObjectURL(characterForm.avatar_url);
    }
})

// 方法
const handleClose = () => {

}

const triggerAvatarUpload = () => {
    avatarInput.value.click()
}

const handleAvatarUpload = (event) => {
    const file = event.target.files[0]
    if (file) {
        if (!file.type.startsWith('image/')) {
            message.error('请选择图片文件')
            return
        }

        if (file.size > 5 * 1024 * 1024) {
            message.error('图片大小不能超过5MB')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            cropImageSrc.value = e.target.result
            cropFile.value = file
            showCropModal.value = true
        }
        reader.readAsDataURL(file)
    }

    // 清空input，允许重复选择同一文件
    event.target.value = ''
}

const handleCropChange = ({ coordinates, canvas }) => {
    console.log('裁剪坐标:', coordinates)
}

const cropAvatar = () => {
    if (!cropperAvatar.value) return

    const { canvas } = cropperAvatar.value.getResult()

    canvas.toBlob((blob) => {
        // 创建新文件对象
        const croppedFile = new File([blob], cropFile.value.name, {
            type: cropFile.value.type,
        })

        // 创建预览URL
        const previewUrl = URL.createObjectURL(croppedFile)
        if (characterForm.avatar_url && characterForm.avatar_url.startsWith('blob:')) {
            URL.revokeObjectURL(characterForm.avatar_url);
        }
        characterForm.avatar_url = previewUrl;
        characterForm.avatar_file = croppedFile;
        console.log('裁剪后的图片:', previewUrl);
        // 关闭模态框
        closeCropModal()

        message.success('头像上传成功')
    }, cropFile.value.type, 0.9)
}

const closeCropModal = () => {
    showCropModal.value = false
    cropImageSrc.value = ''
    cropFile.value = null
}

const removeAvatar = () => {
    characterForm.avatar_url = ''
    message.success('头像已移除')
}

const handleSave = async () => {
    try {
        // 并行验证所有表单
        var formValidates = [
            basicFormRef.value?.validate(),
            promptFormRef.value?.validate(),
            memoryFormRef.value?.validate()
        ]
        if (!isCharacterMode.value) {
            formValidates.push(modelFormRef.value?.validate())
        }
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
            // message.error('请检查表单填写是否正确')

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
            'avatar_url': characterForm.avatar_url.startsWith('blob:') ? props.data.avatar_url : characterForm.avatar_url,
            'avatar_file': characterForm.avatar_file,
            'identity': characterForm.identity,
            'settings': {
                'assistant_name': characterForm.assistant_name,
                'assistant_identity': characterForm.assistant_identity,
                'system_prompt': characterForm.system_prompt,
                'memory_type': characterForm.memory_type,
                'max_memory_length': characterForm.max_memory_length,
                'short_term_memory_length': characterForm.short_term_memory_length,
            }
        }
        if (!props.simple) {
            finalData['settings']['model_id'] = characterForm.model_id;
            finalData['settings']['model_temperature'] = characterForm.model_temperature;
            finalData['settings']['model_top_p'] = characterForm.model_top_p;
            finalData['settings']['model_frequency_penalty'] = characterForm.model_frequency_penalty;
        }
        emit('update:data', finalData)
        // message.success('保存成功')
        // handleClose()
    } catch (errors) {
        if (errors) {
            message.error('请检查表单填写是否正确' + errors.toString())
        } else {
            message.error('保存失败')
        }
    } finally {
        loading.value = false
    }
}
</script>

<style scoped>
/* .settings-header {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
} */
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
</style>