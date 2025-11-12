<template>
    <div class="input-wrapper" :class="{ expanded: isInputExpanded }">
        <!-- 文件列表显示区域 -->
        <div class="file-list flex flex-wrap gap-2 mb-3" v-if="uploadFiles.length > 0">
            <FileItem v-for="file in uploadFiles" :key="file.id" :name="file.display_name" :type="file.file_extension"
                :size="file.file_size" closable @close="removeFile(file.id)"></FileItem>
        </div>

        <textarea class="message-input" v-model="inputContent" placeholder="输入消息..." @keydown="handleKeydown"
            @input="adjustTextareaHeight" ref="messageInputRef" rows="1"></textarea>

        <!-- 隐藏的文件输入框 -->
        <input type="file" ref="fileInputRef" style="display: none" multiple
            accept=".txt,.md,.js,.ts,.html,.css,.json,.xml,.csv,.log,.py,.java,.cpp,.c,.go,.rs,.php,.rb,.sql,.sh,.bat,.yml,.yaml,.ini,.conf,.properties"
            @change="handleFileSelect">

        <div class="input-actions">
            <div class="tools">
                <n-button class="tool-btn" title="上传文件" @click="triggerFileInput" text>
                    <template #icon>
                        <n-icon size="22">
                            <InsertDriveFileTwotone />
                        </n-icon>
                    </template>
                </n-button>
                <n-button class="tool-btn" title="联网搜索" @click="handleWebSearch" text>
                    <template #icon>
                        <n-icon size="22">
                            <ScreenSearchDesktopTwotone />
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
                <n-button class="tool-btn" id="deep-thinking-btn" style="display:none"
                    :class="{ active: isDeepThinking }" :title="isDeepThinking ? '关闭深度思考' : '深度思考'"
                    @click="toggleDeepThinking" text>
                    思考
                </n-button>
            </div>

            <div class="send-actions">
                <n-button v-if="!streaming" class="send-btn" title="发送" @click="sendMessage"
                    :disabled="!inputContent.trim() && uploadFiles.length === 0" circle type="primary" size="small">
                    <template #icon>
                        <n-icon>
                            <ArrowUpOutline />
                        </n-icon>
                    </template>
                </n-button>
                <n-button v-else class="send-btn stop-btn" title="停止生成" @click="abortResponse" circle type="error"
                    size="small">
                    <template #icon>
                        <n-icon>
                            <StopTwotone />
                        </n-icon>
                    </template>
                </n-button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick, defineEmits } from 'vue'
import { NButton, NIcon } from 'naive-ui'
import FileItem from './FileItem.vue';
// 导入 xicons 图标
import {
    ArrowUpOutline,
} from "@vicons/ionicons5";

import {
    StopTwotone,
    InsertDriveFileTwotone,
    ScreenSearchDesktopTwotone,
    ImageTwotone,
    DataThresholdingTwotone,
    CloseOutlined,
} from "@vicons/material";

const isInputExpanded = ref(false);
const messageInputRef = ref(null);
const fileInputRef = ref(null);
const isDeepThinking = ref(false);

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
})

const emit = defineEmits(['update:value', 'send', 'abort', 'tokens-statistic', 'files-change'])

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
    console.log("联网搜索功能");
}

const handleTokensStatistic = () => {
    emit('tokens-statistic')
}

const abortResponse = () => {
    emit('abort')
}

const toggleDeepThinking = () => {
    //emit('event:toggle-deep-thinking')
}

// 调整文本区域高度
const adjustTextareaHeight = () => {
    const textarea = messageInputRef.value;
    if (!textarea) return;

    // 重置高度为auto以获取正确的内容高度
    textarea.style.height = "auto";
    // 计算内容高度
    const height = Math.min(textarea.scrollHeight, 120); // 限制最大高度为120px
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
.input-wrapper {
    border: none;
    border-radius: 12px;
    padding: 18px 15px 12px 15px;
    background-color: white;
    position: relative;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    transition: box-shadow 0.3s ease;
    min-height: 60px;
    max-width: 900px;
    width: 100%;
    border: 1px solid rgb(230, 232, 238);
}

.input-wrapper.expanded {
    border-radius: 12px;
}

.message-input {
    width: 100%;
    min-height: 24px;
    border: none;
    resize: none;
    outline: none;
    font-size: 16px;
    line-height: 1.8;
    padding: 0;
    background: transparent;
    /* color: #333; */
    overflow-y: auto;
    margin-bottom: 10px;
    box-sizing: border-box;
    transition: height 0.2s ease;
}

.input-actions {
    display: flex;
    justify-content: space-between;
    position: static;
    bottom: auto;
    left: auto;
    right: auto;
    width: 100%;
}

.tools {
    display: flex;
    align-items: flex-end;
}

.send-actions {
    display: flex;
    gap: 8px;
    align-items: flex-end;
}

.tool-btn {
    background: none;
    border: none;
    color: #777;
    cursor: pointer;
    font-size: 22px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    transition: all 0.2s;
}

.tool-btn:hover {
    background-color: #e6f0fa;
    color: #4a90e2;
}

/* 深度思考按钮激活状态样式 */
#deep-thinking-btn.active {
    background-color: #e6f0fa;
    color: #4a90e2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
}
</style>