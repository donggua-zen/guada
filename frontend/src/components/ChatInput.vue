<template>
    <div class="w-full flex flex-col items-center">
        <div class="rounded-[22px] p-[18px_10px_12px_10px] bg-white relative shadow-[0_2px_16px_rgba(0,0,0,0.1)] transition-all duration-300 min-h-[60px] max-w-[900px] w-full border border-[rgb(230,232,238)]"
            :class="{ expanded: isInputExpanded }">
            <!-- 文件列表显示区域 -->
            <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
                <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.display_name"
                    :type="file.file_extension" :size="file.file_size" closable @close="removeFile(file.id)"></FileItem>
            </div>

            <textarea class="message-input" v-model="inputContent" placeholder="输入消息..." @keydown="handleKeydown"
                @input="adjustTextareaHeight" ref="messageInputRef" rows="1"></textarea>

            <!-- 隐藏的文件输入框 -->
            <input type="file" ref="fileInputRef" style="display: none" multiple
                accept=".txt,.md,.js,.ts,.html,.css,.json,.xml,.csv,.log,.py,.java,.cpp,.c,.go,.rs,.php,.rb,.sql,.sh,.bat,.yml,.yaml,.ini,.conf,.properties"
                @change="handleFileSelect">

            <div class="input-actions w-full flex justify-between">
                <div class="tools left-tools">
                    <template v-if="showThinkingButton">
                        <n-button class="tool-btn" id="deep-thinking-btn" :class="{ active: localThinkingEnabled }"
                            :title="localThinkingEnabled ? '关闭深度思考' : '深度思考'" @click="toggleDeepThinking" text>
                            <template #icon>
                                <n-icon size="18">
                                    <Thinking2 />
                                </n-icon>
                            </template>
                            思考
                        </n-button>
                        <span class="mr-1"></span>
                    </template>
                    <n-button class="tool-btn" :class="{ active: localWebSearchEnabled }" title="联网搜索"
                        @click="handleWebSearch" text>
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
                        <n-button class="tool-btn" title="上传文件" @click="triggerFileInput" text>
                            <template #icon>
                                <n-icon size="22">
                                    <InsertDriveFileTwotone />
                                </n-icon>
                            </template>
                        </n-button>
                        <n-button class="tool-btn" title="添加图片" @click="handleImageUpload" text>
                            <template #icon>
                                <n-icon size="22">
                                    <ImageTwotone />
                                </n-icon>
                            </template>
                        </n-button>
                        <n-button class="tool-btn" title="tokens统计" @click="handleTokensStatistic" text>
                            <template #icon>
                                <n-icon size="22">
                                    <DataThresholdingTwotone />
                                </n-icon>
                            </template>
                        </n-button>
                    </div>
                    <div class="send-actions">
                        <n-button v-if="!streaming" class="send-btn" title="发送" @click="sendMessage"
                            :disabled="!inputContent.trim() && uploadFiles.length === 0" circle type="primary"
                            size="small">
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
        <div class="ai-disclaimer text-xs text-gray-400 text-center mt-2">
            内容由AI生成，仅供参考
        </div>
    </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, defineEmits } from 'vue'
import { NButton, NIcon } from 'naive-ui'
import FileItem from './FileItem.vue';

// 导入 xicons 图标
import {
    InsertDriveFileTwotone,
    ImageTwotone,
    DataThresholdingTwotone,
} from "@vicons/material";

import { Thinking2, Network, ArrowSend, Stop } from "@/components/icons";

const isInputExpanded = ref(false);
const messageInputRef = ref(null);
const fileInputRef = ref(null);

// 文件列表数据
const fileList = ref([]);
let fileIdCounter = 0;

const props = defineProps({
    value: {
        type: String,
        default: ''
    },
    files: {
        type: Array,
        default: () => []
    },
    streaming: {
        type: Boolean,
        default: false
    },
    webSearchEnabled: {
        type: Boolean,
        default: false
    },
    thinkingEnabled: {
        type: Boolean,
        default: false
    },
    showThinkingButton: {
        type: Boolean,
        default: false
    }
})

const localWebSearchEnabled = computed({
    get() {
        return props.webSearchEnabled;
    },
    set(value) {
        emit('update:webSearchEnabled', value)
    }
})

const localThinkingEnabled = computed({
    get() {
        return props.thinkingEnabled;
    },
    set(value) {
        emit('update:thinkingEnabled', value)
    }
})

const emit = defineEmits(['update:value', 'update:webSearchEnabled', 'update:thinkingEnabled', 'send', 'abort', 'tokens-statistic', 'files-change', 'toggle-web-search', 'toggle-thinking'])

const inputContent = computed(
    {
        get() {
            return props.value;
        },
        set(value) {
            emit('update:value', value)
        }
    }
)

const uploadFiles = computed({
    get() {
        return props.files;
    },
    set(value) {
        emit('update:files', value)
    }
})

const sendMessage = () => {
    emit('send', {
        text: inputContent.value,
        files: fileList.value
    })
}

const handleKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

// 触发文件选择
const triggerFileInput = () => {
    fileInputRef.value.click();
};

// 处理文件选择
const handleFileSelect = (event) => {
    const files = event.target.files;
    if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            // 检查文件类型是否为文本类型
            if (isTextFile(file)) {
                console.log('file', file);
                uploadFiles.value.push({
                    id: fileIdCounter++,
                    file_name: file.name,
                    file_size: file.size,
                    file_extension: getFileExtension(file.name),
                    file_type: file.type,
                    display_name: getFileNameWithoutExtension(file.name),
                    file: file,
                });
            }
        }
        // 触发文件变化事件
        // emit('files-change', fileList.value);
        // 清空input值，允许重复选择同一文件
        event.target.value = '';
    }
};

// 检查是否为文本文件
const isTextFile = (file) => {
    const textExtensions = ['.txt', '.md', '.js', '.ts', '.html', '.css', '.json', '.xml', '.csv', '.log', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.sql', '.sh', '.bat', '.yml', '.yaml', '.ini', '.conf', '.properties'];
    const fileName = file.name.toLowerCase();
    return textExtensions.some(ext => fileName.endsWith(ext));
};

// 移除文件
const removeFile = (fileId) => {
    const index = uploadFiles.value.findIndex(file => file.id === fileId);
    if (index !== -1) {
        uploadFiles.value.splice(index, 1);
    }
};

// 获取不包含扩展名的文件名
const getFileNameWithoutExtension = (fileName) => {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
};

// 获取文件扩展名
const getFileExtension = (fileName) => {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).toUpperCase() : 'FILE';
};


const handleImageUpload = () => {
    console.log("图片上传功能");
}

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

// 调整文本区域高度
const adjustTextareaHeight = () => {
    const textarea = messageInputRef.value;
    if (!textarea) return;

    // 重置高度为auto以获取正确的内容高度
    textarea.style.height = "auto";
    // 计算内容高度
    const height = Math.min(textarea.scrollHeight, 240); // 限制最大高度为120px
    // 设置新高度
    textarea.style.height = height + "px";

    // 根据高度决定是否展开输入区域
    isInputExpanded.value = textarea.scrollHeight > 60;
};

watch(inputContent, (newVal) => {
    nextTick(() => {
        adjustTextareaHeight();
    });
}, { immediate: true })

</script>

<style scoped>
.message-input {
    width: 100%;
    height: auto;
    border: none;
    resize: none;
    outline: none;
    font-size: 16px;
    line-height: 1.8;
    padding: 0 8px;
    background: transparent;
    /* color: #333; */
    overflow-y: auto;
    margin-bottom: 10px;
    box-sizing: border-box;
    transition: height 0.2s ease;
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
    border: none;
    color: #777;
    cursor: pointer;
    font-size: 14px;
    height: 28px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
    border-radius: 28px;
}

.right-tools .tool-btn {
    padding: 0 5px;
}

.tool-btn:hover {
    color: #4a90e2;
}

/* 深度思考按钮激活状态样式 */
.tool-btn.active {
    background-color: var(--secondary-color);
    color: var(--primary-color);
}
</style>