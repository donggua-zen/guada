<template>
    <div class="w-full flex flex-col items-center">
        <div class="p-[18px_15px_12px_15px] bg-white transition-all duration-300 min-h-[60px] w-full "
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
                <div class="tools left-tools">
                    <slot name="buttons"></slot>
                    <template v-if="showButtons.thinkingButton">
                        <n-button class="tool-btn" id="deep-thinking-btn" :class="{ active: localThinkingEnabled }"
                            :title="localThinkingEnabled ? '关闭深度思考' : '深度思考'" @click="toggleDeepThinking" text>
                            <template #icon>
                                <n-icon size="18">
                                    <Thinking2 />
                                </n-icon>
                            </template>
                            思考
                        </n-button>
                        <span class="mr-2.5"></span>
                    </template>
                    <n-button v-if="showButtons.webSearchButton" class="tool-btn"
                        :class="{ active: localWebSearchEnabled }" title="联网搜索" @click="handleWebSearch" text>
                        <template #icon>
                            <n-icon size="18">
                                <Network />
                            </n-icon>
                        </template>
                        网络
                    </n-button>
                </div>
                <div class="right-actions">
                    <div class="tools right-tools">
                        <n-button v-if="showButtons.filesButton" class="tool-btn" title="上传文件" @click="triggerFileInput"
                            text>
                            <template #icon>
                                <n-icon size="22">
                                    <InsertDriveFileTwotone />
                                </n-icon>
                            </template>
                        </n-button>
                        <n-button v-if="showButtons.imagesButton" class="tool-btn" title="添加图片"
                            @click="triggerImageInput" text>
                            <template #icon>
                                <n-icon size="22">
                                    <ImageTwotone />
                                </n-icon>
                            </template>
                        </n-button>
                        <n-button v-if="showButtons.tokensButton" class="tool-btn" title="tokens统计"
                            @click="handleTokensStatistic" text>
                            <template #icon>
                                <n-icon size="22">
                                    <DataThresholdingTwotone />
                                </n-icon>
                            </template>
                        </n-button>
                    </div>
                    <div class="send-actions">
                        <n-button v-if="!streaming" class="send-btn" title="发送" @click="sendMessage"
                            :disabled="!inputContent.trim()" circle type="primary" size="small">
                            <template #icon>
                                <n-icon>
                                    <ArrowSend />
                                </n-icon>
                            </template>
                        </n-button>
                        <n-button v-else class="send-btn stop-btn" title="停止生成" @click="abortResponse" circle
                            type="error" size="small">
                            <template #icon>
                                <n-icon>
                                    <Stop />
                                </n-icon>
                            </template>
                        </n-button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>


<script setup>
import { ref, watch, computed, nextTick, defineEmits, onUnmounted, onMounted } from 'vue'
import { NButton, NIcon } from 'naive-ui'
import FileItem from './FileItem.vue';
import {
    InsertDriveFileTwotone,
    ImageTwotone,
    DataThresholdingTwotone,
} from "@vicons/material";
import { Thinking2, Network, ArrowSend, Stop } from "@/components/icons";
import { reactive } from 'vue';
import { usePopup } from '@/composables/usePopup';

const { confirm } = usePopup();

// 响应式数据
const isInputExpanded = ref(false);
const messageInputRef = ref(null);
const fileInputRef = ref(null);
const imageInputRef = ref(null);
let fileIdCounter = 0;

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
            '.proto', '.graphql', '.sol'
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
    imagesButton: true,
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
});

// 计算属性
const styleClass = computed(() => {
    const classes = [];
    if (isInputExpanded.value) {
        classes.push('expanded');
    }
    if (!props.clean) {
        // if (props.shadow) classes.push('shadow-[0_2px_16px_rgba(0,0,0,0.1)]');
        if (props.shadow) classes.push('shadow-[0_6px_30px_0_rgba(0,0,0,.08)]');
        if (props.border) classes.push('border border-[rgb(230,232,238)]');
        if (props.round) classes.push('rounded-[22px]');
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

const emit = defineEmits([
    'update:value', 'update:webSearchEnabled', 'update:thinkingEnabled',
    'send', 'abort', 'tokens-statistic', 'files-change',
    'toggle-web-search', 'toggle-thinking', 'focus', 'blur'
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
    if (!event.clipboardData?.items) return;

    const items = event.clipboardData.items;
    const files = [];

    for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
            const file = items[i].getAsFile();
            if (file) files.push(file);
        }
    }

    if (files.length > 0) {
        event.preventDefault();

        // 优先处理图片文件
        const imageFiles = files.filter(file => isFileType(file, 'IMAGE'));
        const textFiles = files.filter(file => isFileType(file, 'TEXT'));

        if (imageFiles.length > 0) {
            await processFiles(imageFiles, 'IMAGE');
        } else if (textFiles.length > 0) {
            await processFiles(textFiles, 'TEXT');
        }
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
    emit('focus');
};

const handleBlur = () => {
    emit('blur');
};

// 生命周期和监听器
watch(() => props.buttons, (value) => {
    Object.keys(showButtons).forEach(key => {
        showButtons[key] = key in value ? value[key] : true;
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
});

onUnmounted(() => {
    document.removeEventListener('paste', handlePaste);
    uploadFiles.value.forEach(revokeImagePreviewUrl);
});
</script>
<style scoped>
.message-input {
    width: 100%;
    height: auto;
    border: none;
    resize: none;
    outline: none;
    font-size: 15px;
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

.right-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.right-tools {
    display: flex;
    align-items: center;
    gap: 4px;
}

.send-actions {
    display: flex;
    align-items: center;
}


.tool-btn {
    background: none;
    color: #777;
    cursor: pointer;
    font-size: 14px;
    height: 28px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    border-radius: 28px;
}

.left-tools .tool-btn {
    border: 1px solid rgba(0, 0, 0, 0.1);
}

.right-tools .tool-btn {
    padding: 0 5px;
}

.tool-btn:hover {
    color: #4a90e2;
}

/* 深度思考按钮激活状态样式 */
.tool-btn.active {
    border-color: var(--primary-color);
    background-color: var(--secondary-color);
    color: var(--primary-color);
}
</style>