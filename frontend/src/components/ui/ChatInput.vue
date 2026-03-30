<template>
    <div class="w-full flex flex-col items-center">
        <div class="p-[18px_12px_10px_12px] transition-all duration-300 min-h-[60px] w-full bg-white dark:bg-[#1e1e1e]"
            :class="styleClass">
            <!-- 文件列表显示区域 -->
            <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
                <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.display_name" :type="file.file_type"
                    :ext="file.file_extension" :size="file.file_size" :preview-url="file.preview_url" closable
                    @close="removeFile(file.id)"></FileItem>
            </div>

            <textarea class="message-input" v-model="inputContent" placeholder="Enter发送, Shift+Enter换行"
                @keydown="handleKeydown" @input="adjustTextareaHeight" ref="messageInputRef" rows="1"
                @focus="handleFocus" @blur="handleBlur"></textarea>

            <!-- 隐藏的文件输入框 -->
            <input type="file" ref="fileInputRef" style="display: none" multiple
                :accept="getFileExtensionsFromType('TEXT').join(',')" @change="handleFileSelect">
            <input type="file" ref="imageInputRef" style="display: none" multiple
                :accept="getFileExtensionsFromType('IMAGE').join(',')" @change="handleImageSelect">
            <div class="input-actions w-full flex justify-between">
                <div class="tools left-tools flex gap-2 items-center">
                    <slot name="buttons"></slot>
                    <template v-if="showButtons.thinkingButton">
                        <el-button round :type="localThinkingEnabled ? 'primary' : 'default'" plain
                            @click="toggleDeepThinking" :icon="Thinking2">
                            思考
                        </el-button>
                    </template>

                </div>
                <div class="right-actions">
                    <!-- 模型选择按钮 -->
                    <el-button @click="openModelDialog" plain type="primary"
                        class="model-selector-btn overflow-hidden flex items-center justify-center">
                        <div class="flex items-center gap-1.5" style="height:24px">
                            <OpenAI class="w-4 h-4 flex-shrink-0 text-[var(--color-primary)]" />
                            <span class="whitespace-nowrap text-sm font-medium"
                                :style="{ display: isMobile ? 'none' : 'inline-flex' }">{{ currentModelName }}</span>
                            <el-icon class="text-xs opacity-60">
                                <ArrowDropDownTwotone />
                            </el-icon>
                        </div>
                    </el-button>
                    <div class="tools right-tools">
                        <el-button v-if="showButtons.filesButton" class="tool-btn" title="上传文件"
                            @click="triggerFileInput" text>
                            <el-icon size="22">
                                <InsertDriveFileTwotone />
                            </el-icon>
                        </el-button>
                        <el-button v-if="showButtons.imagesButton" class="tool-btn" title="添加图片"
                            @click="triggerImageInput" text>
                            <el-icon size="22">
                                <ImageTwotone />
                            </el-icon>
                        </el-button>
                    </div>
                    <div class="send-actions">
                        <el-button v-if="!streaming" class="send-btn" type="primary" title="发送" @click="sendMessage"
                            circle :disabled="!inputContent.trim()" :icon="ArrowSend">
                        </el-button>
                        <el-button v-else class="send-btn stop-btn" title="停止生成" @click="abortResponse" circle
                            type="error" :icon="icon">

                        </el-button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 模型选择对话框 -->
    <el-dialog v-model="modelDialogVisible" title="模型设置" :width="isMobile ? '90%' : '600px'" :append-to-body="true"
        destroy-on-close>
        <el-tabs v-model="modelDialogTab">
            <!-- 模型选择标签页 -->
            <el-tab-pane name="model" label="模型选择">
                <div class="mb-4">
                    <el-input v-model="modelSearchText" placeholder="搜索模型..." clearable>
                        <template #prefix>
                            <el-icon>
                                <SearchFilled />
                            </el-icon>
                        </template>
                    </el-input>
                </div>
                <div class="model-list max-h-80 overflow-y-auto">
                    <template v-for="provider in filteredProviders" :key="provider.id">
                        <div class="provider-group mb-4">
                            <div class="provider-name text-sm font-medium text-gray-700 mb-2">
                                {{ provider.name }}
                            </div>
                            <div class="provider-models space-y-1">
                                <div v-for="model in getProviderModels(provider.id)" :key="model.id"
                                    class="model-item p-3 rounded-lg cursor-pointer border transition-all" :class="{
                                        'bg-blue-50 border-blue-300': tempModelId === model.id,
                                        'border-gray-200 hover:bg-gray-50': tempModelId !== model.id
                                    }" @click="selectModel(model.id)">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2 mb-1">
                                                <div class="font-medium text-sm truncate">{{ model.model_name }}</div>
                                                <!-- 特性标签 -->
                                                <div class="flex-shrink-0 flex gap-1">
                                                    <el-tag v-if="model.features?.includes('tools')" size="small"
                                                        type="info" class="h-4 text-[10px] px-1">
                                                        工具
                                                    </el-tag>
                                                    <el-tag v-if="model.features?.includes('thinking')" size="small"
                                                        type="warning" class="h-4 text-[10px] px-1">
                                                        混思
                                                    </el-tag>
                                                    <el-tag v-if="model.features?.includes('visual')" size="small"
                                                        type="success" class="h-4 text-[10px] px-1">
                                                        视觉
                                                    </el-tag>
                                                </div>
                                            </div>
                                            <div v-if="model.description" class="text-xs text-gray-500 truncate mt-0.5">
                                                {{ model.description }}
                                            </div>
                                        </div>
                                        <el-icon v-if="tempModelId === model.id" class="text-blue-500 flex-shrink-0"
                                            size="20">
                                            <CheckCircleFilled />
                                        </el-icon>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>
                    <div v-if="filteredModels.length === 0" class="text-center py-8 text-gray-400">
                        <el-icon size="48" class="mb-2">
                            <SearchFilled />
                        </el-icon>
                        <p>未找到匹配的模型</p>
                    </div>
                </div>
            </el-tab-pane>

            <!-- 高级设置标签页 -->
            <el-tab-pane name="advanced" label="高级设置">
                <el-form label-position="top" size="large">
                    <el-form-item label="上下文条数">
                        <el-slider-optional v-model="tempMaxMemoryLength" :min="2" :max="500" :step="1" show-input
                            optional-direction="max" optional-text="No Limit" />
                        <div class="text-xs text-gray-500 mt-2">
                            控制保留的历史消息条数，影响对话的连贯性和上下文理解能力
                        </div>
                    </el-form-item>
                </el-form>
            </el-tab-pane>
        </el-tabs>

        <template #footer>
            <div class="flex justify-end gap-3">
                <el-button @click="modelDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="applyModelSettings">应用</el-button>
            </div>
        </template>
    </el-dialog>
</template>


<script setup lang="ts">
// @ts-nocheck - ChatInput 组件复杂度高，临时使用@ts-nocheck
import { ref, watch, computed, nextTick, onUnmounted, onMounted, reactive } from 'vue'
import { ElIcon, ElButton, ElDialog, ElTabs, ElTabPane, ElInput, ElForm, ElFormItem, ElTag } from 'element-plus';
import FileItem from './FileItem.vue';
import { OpenAI } from "@/components/icons";
import {
    InsertDriveFileTwotone,
    ImageTwotone,
    ArrowDropDownTwotone,
    SearchFilled,
    CheckCircleFilled
} from "@vicons/material";
import { Thinking2, ArrowSend } from "@/components/icons";
import { usePopup } from '@/composables/usePopup';
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

const { confirm } = usePopup();

// 响应式数据
const isInputExpanded = ref(false);
const messageInputRef = ref(null);
const fileInputRef = ref(null);
const imageInputRef = ref(null);
let fileIdCounter = 0;
const focused = ref(false);
// 模型选择器相关
const modelDialogVisible = ref(false);
const modelDialogTab = ref('model');
const modelSearchText = ref('');
const tempMaxMemoryLength = ref(null);
const tempModelId = ref(null); // 临时选中的模型 ID
const models = ref([]);
const providers = ref([]);
const sessionId = ref(null);
// 常量定义
const FILE_TYPES = {
    TEXT: {
        extensions: [
            '.txt', '.md', '.js', '.ts', '.html', '.css', '.json', '.xml', '.csv', '.log',
            '.py', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.sql', '.sh',
            '.bat', '.yml', '.yaml', '.ini', '.conf', '.properties', '.vue', '.toml',
            '.env', '.cfg', '.config', '.reg', '.pem', '.tex', '.rst', '.adoc', '.org',
            '.swift', '.kt', '.scala', '.dart', '.ex', '.r', '.jl', '.ps1', '.vbs', '.fish',
            '.j2', '.ejs', '.hbs', '.lock', '.patch', '.diff', '.ics', '.vcf', '.srt',
            '.proto', '.graphql', '.sol', '.pdf'
        ],
        type: 'text'
    },
    IMAGE: {
        extensions: [
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico',
            '.tif', '.tiff', '.psd', '.ai', '.eps'
        ],
        type: 'image'
    }
};

const MIME_TO_EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp',
    'image/svg+xml': 'svg', 'image/webp': 'webp', 'text/plain': 'txt', 'text/html': 'html',
    'text/css': 'css', 'application/javascript': 'js', 'application/json': 'json',
    'text/csv': 'csv', 'application/xml': 'xml'
};

// 配置
const showButtons = reactive({
    thinkingButton: false,
    webSearchButton: true,
    filesButton: true,
    imagesButton: false,
    tokensButton: true,
});

const props = defineProps({
    value: { type: String, default: '' },
    files: { type: Array, default: () => [] },
    streaming: { type: Boolean, default: false },
    webSearchEnabled: { type: Boolean, default: false },
    thinkingEnabled: { type: Boolean, default: false },
    shadow: { type: Boolean, default: true },
    buttons: { type: Object, default: () => [] },
    clean: { type: Boolean, default: false },
    border: { type: Boolean, default: true },
    round: { type: Boolean, default: true },
    class: { type: String, default: '' },
    sessionId: { type: [String, Number], default: null },
    config: {
        type: Object,
        default: () => ({
            modelId: null,
            maxMemoryLength: null
        })
    },
});

// 计算属性
const styleClass = computed(() => {
    const classes = [];
    if (isInputExpanded.value) {
        classes.push('expanded');
    }
    if (!props.clean) {
        if (props.round) classes.push('rounded-[12px]');
        if (focused.value) {
            if (props.shadow) classes.push('shadow-[0_2px_32px_rgba(0,0,0,0.11)]');
            if (props.border) classes.push('border border-gray-200 dark:border-gray-700');
        } else {
            if (props.border) classes.push('border border-gray-300 dark:border-gray-700');
        }
    }
    return classes.join(' ') + ' ' + props.class;
});

const localWebSearchEnabled = computed({
    get: () => props.webSearchEnabled,
    set: (value) => emit('update:webSearchEnabled', value)
});

const localThinkingEnabled = computed({
    get: () => props.thinkingEnabled,
    set: (value) => emit('update:thinkingEnabled', value)
});

const inputContent = computed({
    get: () => props.value,
    set: (value) => emit('update:value', value)
});

const uploadFiles = computed({
    get: () => props.files,
    set: (value) => emit('update:files', value)
});

// 当前选中的模型
const currentModel = computed(() => {
    if (props.config?.modelId) {
        const model = models.value.find(m => m.id === props.config.modelId);
        return model;
    }
    return null;
});

// 根据模型特性动态控制按钮显示
watch(() => currentModel.value?.features, (features) => {
    // 思考按钮：当模型支持 thinking 时显示
    showButtons.thinkingButton = features?.includes('thinking') || false;
    // 图像按钮：当模型支持 visual 时显示
    showButtons.imagesButton = features?.includes('visual') || false;
}, { immediate: true });

const currentModelName = computed(() => {
    const model = currentModel.value;
    return model ? model.model_name.split("/").pop() : "请选择模型";
});

// 过滤后的模型列表（支持搜索）
const filteredModels = computed(() => {
    if (!modelSearchText.value) return models.value;
    const searchText = modelSearchText.value.toLowerCase();
    return models.value.filter(model =>
        model.model_name?.toLowerCase().includes(searchText) ||
        model.description?.toLowerCase().includes(searchText)
    );
});

// 按供应商分组的过滤后模型列表
const filteredProviders = computed(() => {
    if (!models.value.length || !providers.value.length) return [];

    const filtered = filteredModels.value;
    return providers.value.map(provider => ({
        ...provider,
        models: filtered.filter(model => model.provider_id === provider.id)
    })).filter(provider => provider.models.length > 0);
});

// 获取指定供应商的模型列表
const getProviderModels = (providerId) => {
    const provider = filteredProviders.value.find(p => p.id === providerId);
    return provider ? provider.models : [];
};

const emit = defineEmits([
    'update:value', 'update:webSearchEnabled', 'update:thinkingEnabled',
    'send', 'abort', 'tokens-statistic', 'files-change',
    'toggle-web-search', 'toggle-thinking', 'focus', 'blur',
    'update:modelId', 'config-change'
]);

// 工具函数
const getFileExtension = (fileName) => {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).toUpperCase() : 'FILE';
};

const getFileNameWithoutExtension = (fileName) => {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
};

const getFileExtensionFromType = (mimeType) => {
    return MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'file';
};

const isFileType = (file, fileType) => {
    const fileName = file.name.toLowerCase();
    return FILE_TYPES[fileType].extensions.some(ext => fileName.endsWith(ext));
};

const getFileExtensionsFromType = (type) => {
    return FILE_TYPES[type].extensions;
}

const createFileObject = (file, fileType, isPasted = false) => {
    const isImage = fileType === 'IMAGE';
    const previewUrl = isImage ? URL.createObjectURL(file) : '';
    const timestamp = Date.now();

    return {
        id: fileIdCounter++,
        file_name: file.name || `pasted-${fileType.toLowerCase()}-${timestamp}.${getFileExtensionFromType(file.type)}`,
        file_size: file.size,
        file_extension: isPasted ? getFileExtensionFromType(file.type) : getFileExtension(file.name),
        file_type: FILE_TYPES[fileType].type,
        display_name: file.name ? getFileNameWithoutExtension(file.name) : `pasted-${fileType.toLowerCase()}-${timestamp}`,
        file: file,
        preview_url: previewUrl,
    };
};

const revokeImagePreviewUrl = (file) => {
    if (file?.file_type === 'image' && file.preview_url?.startsWith('blob:')) {
        URL.revokeObjectURL(file.preview_url);
        file.previewUrl = null;
    }
};

// 打开模型对话框
const openModelDialog = () => {
    modelDialogTab.value = 'model';
    modelSearchText.value = '';
    // 初始化临时值为当前值
    tempModelId.value = props.config?.modelId || null;
    tempMaxMemoryLength.value = props.config?.maxMemoryLength || null;
    modelDialogVisible.value = true;
};

// 选择模型（仅更新临时状态，不关闭对话框）
const selectModel = (modelId) => {
    tempModelId.value = modelId;
};

// 应用模型设置
const applyModelSettings = () => {
    // 构建配置变更对象
    const configChanges = {};

    // 检查模型 ID 是否有变化
    if (tempModelId.value !== props.config?.modelId) {
        configChanges.modelId = tempModelId.value;
    }

    // 检查上下文条数是否有变化
    if (tempMaxMemoryLength.value !== props.config?.maxMemoryLength && tempMaxMemoryLength.value !== null) {
        configChanges.maxMemoryLength = tempMaxMemoryLength.value;
    }

    // 只有当有配置变更时才发送事件
    if (Object.keys(configChanges).length > 0) {
        console.log('Applying model settings:', configChanges);
        emit('config-change', configChanges);
    }

    modelDialogVisible.value = false;
};

// 加载模型列表
const loadModels = async () => {
    try {
        const { apiService } = await import('@/services/ApiService');
        const response = await apiService.fetchModels();
        response.items.forEach(provider => {
            models.value.push(...provider.models);
            delete provider.models;
            providers.value.push(provider);
        });
        if (models.value.length > 0 && !props.modelId) {
            // 如果没有传入 modelId，默认选择第一个
            emit('update:modelId', models.value[0].id);
        }
    } catch (error) {
        console.error('获取模型列表失败:', error);
    }
};

// 文件处理函数
const checkFileConflict = async (newFileType) => {
    const currentFileType = uploadFiles.value[0]?.file_type;
    const conflictType = newFileType === 'image' ? '文件' : '图片';

    if (currentFileType && currentFileType !== newFileType) {
        const confirmed = await confirm(`覆盖${conflictType}`, `暂不支持同时上传图片和文件，是否要覆盖全部${conflictType}？`);
        if (!confirmed) return false;

        uploadFiles.value.forEach(revokeImagePreviewUrl);
        uploadFiles.value = [];
    }
    return true;
};

const processFiles = async (files, fileType) => {
    if (files.length === 0) return;

    const normalizedFileType = fileType.toUpperCase();
    if (!(await checkFileConflict(FILE_TYPES[normalizedFileType].type))) return;

    for (const file of files) {
        if (isFileType(file, normalizedFileType)) {
            uploadFiles.value.push(createFileObject(file, normalizedFileType));
        }
    }
};

// 事件处理函数
const handleFileSelect = (event) => {
    processFiles(Array.from(event.target.files), 'TEXT');
    event.target.value = '';
};

const handleImageSelect = (event) => {
    processFiles(Array.from(event.target.files), 'IMAGE');
    event.target.value = '';
};

const handlePaste = async (event) => {
    const clipboardData = event.clipboardData;
    if (!clipboardData?.items) return;

    // 立即阻止默认粘贴行为，避免浏览器自动插入内容
    event.preventDefault();

    const items = Array.from(clipboardData.items);
    let pastedText = '';
    const filesToProcess = [];

    // 提取所有文件项（包括可能的图片）
    for (const item of items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) filesToProcess.push(file);
        }
    }

    // 提取文本内容（异步）
    const textItem = items.find(item => item.kind === 'string' && item.type.startsWith('text/'));
    if (textItem) {
        pastedText = await new Promise((resolve) => {
            textItem.getAsString(resolve);
        });
    }

    // Step 3: 判断文本长度并决定如何处理
    const MAX_TEXT_LENGTH = 1000;
    if (pastedText && pastedText.length > MAX_TEXT_LENGTH) {
        // 超长文本 → 转为 .txt 文件
        const blob = new Blob([pastedText], { type: 'text/plain' });
        const file = new File([blob], `pasted_text_${Date.now()}.txt`, { type: 'text/plain' });
        filesToProcess.push(file);
    } else if (pastedText) {
        // 短文本 → 手动插入到 textarea，保留光标位置
        const textarea = messageInputRef.value;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const currentValue = inputContent.value || '';
            const newValue = currentValue.slice(0, start) + pastedText + currentValue.slice(end);

            // 更新绑定值
            inputContent.value = newValue;

            // 恢复光标位置（需 nextTick 确保 DOM 已更新）
            nextTick(() => {
                textarea.setSelectionRange(start + pastedText.length, start + pastedText.length);
                textarea.focus();
            });
        }
    }

    // 处理文件（优先图片，否则文本类文件）
    if (filesToProcess.length > 0) {
        const imageFiles = filesToProcess.filter(file => isFileType(file, 'IMAGE'));
        const textFiles = filesToProcess.filter(file => isFileType(file, 'TEXT'));

        if (imageFiles.length > 0) {
            await processFiles(imageFiles, 'IMAGE');
        } else if (textFiles.length > 0) {
            await processFiles(textFiles, 'TEXT');
        }
        // TODO：如果既不是图片也不是支持的文本类型，会被忽略（可选加提示）
    }
};

const removeFile = (fileId) => {
    const index = uploadFiles.value.findIndex(file => file.id === fileId);
    if (index !== -1) {
        revokeImagePreviewUrl(uploadFiles.value[index]);
        uploadFiles.value.splice(index, 1);
    }
};

// UI 交互函数
const triggerFileInput = () => fileInputRef.value.click();
const triggerImageInput = () => imageInputRef.value.click();

const sendMessage = () => {
    if (!inputContent.value.trim()) {
        return;
    }
    emit('send', {
        text: inputContent.value,
        files: uploadFiles.value
    });
};

const handleKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

const adjustTextareaHeight = () => {
    const textarea = messageInputRef.value;
    if (!textarea) return;

    textarea.style.height = "auto";
    let height = Math.min(textarea.scrollHeight, 240);
    if (height < 45) height = 45;
    textarea.style.height = height + "px";
    isInputExpanded.value = textarea.scrollHeight > 60;
};

const handleWebSearch = () => {
    localWebSearchEnabled.value = !localWebSearchEnabled.value;
    emit('toggle-web-search')
}

const handleTokensStatistic = () => {
    emit('tokens-statistic')
}

const abortResponse = () => {
    emit('abort')
}

const toggleDeepThinking = () => {
    localThinkingEnabled.value = !localThinkingEnabled.value;
    emit('toggle-thinking')
}

const handleFocus = () => {
    focused.value = true;
    emit('focus');
};

const handleBlur = () => {
    focused.value = false;
    emit('blur');
};

// 生命周期和监听器
watch(() => props.config?.modelId, async () => {
    await nextTick();
    // 移除按钮宽度更新逻辑
}, { immediate: true });

watch(() => props.sessionId, (newSessionId) => {
    sessionId.value = newSessionId;
}, { immediate: true });

watch(() => props.buttons, (value) => {
    // 外部传入的按钮配置只影响非模型特性控制的按钮
    Object.keys(showButtons).forEach(key => {
        // thinkingButton 和 imagesButton 由模型特性控制，不受外部 props 影响
        if (key !== 'thinkingButton' && key !== 'imagesButton' && key in value) {
            showButtons[key] = value[key];
        }
    });
}, { immediate: true });

watch(() => props.files, (newFiles, oldFiles) => {
    oldFiles?.forEach(oldFile => {
        if (!newFiles.some(newFile => newFile.id === oldFile.id)) {
            revokeImagePreviewUrl(oldFile);
        }
    });
}, { deep: true });

watch(inputContent, () => {
    nextTick(adjustTextareaHeight);
}, { immediate: true });

onMounted(() => {
    document.addEventListener('paste', handlePaste);
    adjustTextareaHeight();
    loadModels();

    // 清理事件监听器
    onUnmounted(() => {
        document.removeEventListener('paste', handlePaste);
        uploadFiles.value.forEach(revokeImagePreviewUrl);
    });
});
</script>
<style scoped>
.message-input {
    width: 100%;
    height: auto;
    border: none;
    resize: none;
    outline: none;
    font-size: var(--size-text-base);
    line-height: 1.8;
    padding: 0 8px;
    background: transparent;
    /* color: #333; */
    overflow-y: auto;
    margin-bottom: 10px;
    box-sizing: border-box;
    transition: height 0.2s ease;
    min-height: 45px;
}


.left-tools {
    display: flex;
    align-items: center;
}

:deep(.left-tools .el-button--primary.is-plain) {
    --el-button-hover-bg-color: var(--el-color-primary-light-8) !important;
    --el-button-hover-text-color: var(--el-color-primary) !important;
    --el-button-active-bg-color: var(--el-color-primary-light-7) !important;
}

:deep(.el-button+.el-button) {
    margin-left: 0;
}

.right-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.right-tools {
    display: flex;
    align-items: center;
}


.tool-btn {
    color: #888;
    cursor: pointer;
    font-size: 14px;
    height: 28px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.left-tools .tool-btn {}

.right-tools .tool-btn {
    padding: 0 5px;
}

/* 深度思考按钮激活状态样式 */
.tool-btn.active {
    border-color: var(--color-primary);
    background-color: var(--color-primary-0f);
    color: var(--color-primary);
}

/* 模型选择器按钮样式 */
.model-selector-btn {
    transition: all 0.3s ease-in-out;
    overflow: hidden;
    height: 32px;
    padding: 6px 12px;
    border-color: transparent;
    background-color: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
}

.model-selector-btn:hover {
    background-color: var(--el-color-primary-light-9);
    border-color: transparent;
    color: var(--el-color-primary);
}

.model-selector-btn:active {
    background-color: var(--el-color-primary-light-8);
}

/* 模型选择器对话框样式 */
:deep(.model-item) {
    transition: all 0.2s;
}

:deep(.model-item:hover) {
    border-color: var(--el-color-primary-light-5);
}

:deep(.provider-group) {
    margin-bottom: 1rem;
}

:deep(.provider-name) {
    color: var(--el-text-color-secondary);
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
}

/* 移动端特性标签隐藏 */
@media (max-width: 768px) {
    :deep(.model-item .el-tag) {
        display: none;
    }
}

/* 移动端适配 */
@media (max-width: 768px) {
    .model-selector-btn {
        display: none !important;
    }
}
</style>