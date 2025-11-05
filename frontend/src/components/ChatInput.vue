<template>
    <div class="input-wrapper" :class="{ expanded: isInputExpanded }">
        <textarea class="message-input" v-model="inputContent" placeholder="输入消息..." @keydown="handleKeydown"
            @input="adjustTextareaHeight" ref="messageInputRef" rows="1"></textarea>

        <div class="input-actions">
            <div class="tools">
                <n-button class="tool-btn" title="上传文件" @click="handleFileUpload" text>
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
                    :disabled="!inputContent.trim()" circle type="primary" size="small">
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
import { defineComponent, ref, watch, computed, onMounted, onBeforeUnmount, nextTick, defineEmits } from 'vue'
import { useRouter } from 'vue-router'
import { useRoute } from 'vue-router'
import { NButton, NIcon } from 'naive-ui'
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
} from "@vicons/material";

const isInputExpanded = ref(false);
const messageInputRef = ref(null);


const props = defineProps({
    value: {
        type: String,
        default: ''
    },
    streaming: {
        type: Boolean,
        default: false
    },
})

const emit = defineEmits(['update:value', 'send', 'abort', 'tokens-statistic'])

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

const sendMessage = () => {
    emit('send', inputContent.value)
}

const handleKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

const handleFileUpload = () => {
    console.log("文件上传功能");
}

const handleImageUpload = () => {
    console.log("图片上传功能");
}

const handleWebSearch = () => {
    console.log("联网搜索功能");
}

const handleTokensStatistic = () => {
    emit('event:tokens-statistic')
}

const abortResponse = () => {
    emit('event:abort')
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
    max-width: 800px;
    width: 100%;
    border: 1px solid rgb(230, 232, 238);
}

.input-wrapper.expanded {
    border-radius: 12px;
}

.message-input {
    width: 100%;
    min-height: 24px;
    max-height: 120px;
    border: none;
    resize: none;
    outline: none;
    font-size: 16px;
    line-height: 1.5;
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