<template>
  <div class="message" :class="messageClass">
    <div class="avatar" :class="avatarClass">
      <Avatar v-if="!isAssistant" src="" :round="true"></Avatar>
      <Avatar v-else :src="avatar" :round="true"></Avatar>
    </div>

    <div class="message-content">
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mb-3" v-if="message.files && message.files.length > 0">
        <fileItem v-for="file in message.files" :key="file.id" :name="file.display_name" :type="file.file_extension"
          :size="file.file_size"></fileItem>
      </div>

      <div class="message-card">
        <div v-if="showThinking" class="thinking-section" :class="{ 'thinking-expanded': isExpanded }">
          <div
            class="inline-flex justify-between items-center text-sm text-gray-700 cursor-pointer font-medium bg-gray-50 rounded-lg py-1 px-2 transition-colors duration-200 mb-1"
            @click="toggleExpand">
            <div class="flex items-center inline-flex">
              <i class="fas fa-lightbulb text-yellow-400 mr-2"></i>
              <span class="text-gray-600">{{ thinkingLabel }}</span>
            </div>
            <i class="fa-angle-down fas transition-transform duration-300 ml-2"
              :class="[isExpanded ? 'rotate-0' : '-rotate-90']"></i>
          </div>
          <div class="thinking-content transition-all duration-500 ease-in-out overflow-hidden text-gray-500"
            :class="isExpanded ? 'max-h-500 opacity-100' : 'max-h-0 opacity-0'">
            <div class="border-l-2 border-gray-200 pl-4 mb-2  markdown-text" v-html="formattedReasoning"></div>
          </div>
        </div>

        <div class="message-text markdown-text" v-html="formattedContent"></div>
        <n-alert v-if="message.meta_data && message.meta_data.finish_reason == 'error'" title="API请求错误" type="error">
          {{ message.meta_data.error }}
        </n-alert>
        <div v-if="message.is_streaming" class="assistant-loading">
          回答中...
        </div>
      </div>

      <div class="message-actions" :class="message.is_streaming ? 'opacity-0' : 'opacity-100'">
        <div v-for="action in availableActions" :key="action.name" class="message-action"
          @click="handleAction(action.name)">
          <n-icon :component="action.icon" size="15"
            class="text-gray-400 hover:text-blue-500 transition-colors duration-200" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { marked } from "marked";
import { NAlert, NIcon } from "naive-ui";
import Avatar from "./Avatar.vue";
import {
  InsertDriveFileTwotone,
  EditTwotone,
  DeleteTwotone,
  ContentCopyTwotone,
  ArrowDownwardTwotone
} from "@vicons/material";
import fileItem from "../components/FileItem.vue";

const props = defineProps({
  message: Object,
  avatar: String,
  isLast: {
    type: Boolean,
    default: false
  }
});

const isExpanded = ref(false);
const isThinking = ref(false);
const isAssistant = computed(() => props.message.role === "assistant");
const messageClass = computed(() =>
  isAssistant.value ? "assistant-message-container" : "user-message-container"
);
const avatarClass = computed(() =>
  isAssistant.value ? "assistant-avatar" : "user-avatar"
);

const showThinking = computed(
  () => isAssistant.value && props.message.reasoning_content
);

const thinkingLabel = ref("已深度思考");


const formattedText = ((text) => {
  return text;
})

const formattedContent = computed(() =>
  marked.parse(formattedText(props.message.content || "")).trim()
);

const formattedReasoning = computed(() =>
  marked.parse(formattedText(props.message.reasoning_content || "")).trim()
);

const availableActions = computed(() => {
  const baseActions = [
    { name: "delete", icon: DeleteTwotone, text: "删除" },
    { name: "edit", icon: EditTwotone, text: "编辑" },
    { name: "copy", icon: ContentCopyTwotone, text: "复制" },
  ];

  if (!isAssistant.value && props.isLast) {
    baseActions.unshift({
      name: "regenerate",
      icon: ArrowDownwardTwotone,
      text: "重答",
    });
  }

  return baseActions;
});

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

const handleAction = (action) => {
  emit(action, props.message);
};

const startThinking = () => {
  console.log("startThinking called");
  isThinking.value = true;
  isExpanded.value = true;
  thinkingLabel.value = "正在思考...";
};

const stopThinking = () => {
  console.log("stopThinking called");
  isThinking.value = false;
  thinkingLabel.value = "已深度思考";
};

defineExpose({ startThinking, stopThinking });
const emit = defineEmits(["delete", "edit", "copy", "regenerate"]);

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
</script>

<style scoped>
/* 消息样式 */
.message {
  display: flex;
  gap: 15px;
  width: 100%;
  margin-top: 20px;
  margin-bottom: 25px;
  animation: fadeInUp 0.3s ease;
}

.avatar {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: flex-start;
}

/* 新增卡片式设计 */
.message-card {
  line-height: 1.5;
  font-size: 16px;
  letter-spacing: 1px;
  transition: all 0.3s ease;
}

/* 用户消息气泡特定样式 */
.user-message-container .message-card {
  margin-left: auto;
  background-color: var(--user-bubble-bg);
  color: var(--user-bubble-text-color);
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid var(--user-bubble-border-color);
}

/* AI消息气泡特定样式 */
.assistant-message-container .message-card {
  background: var(--assitant-bubble-bg);
  color: var(--assitant-bubble-text-color);
  border: 1px solid var(--assistant-bubble-border-color);
  margin-right: auto;
  width: 100%;
  padding: 0;
  box-shadow: none;
  border: none;
}

.message-content {
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
}

/* 修复用户消息对齐问题 */
.message.user-message-container {
  flex-direction: row-reverse;
}

.message.assistant-message-container {
  justify-content: flex-start;
}

.message.user-message-container .message-content {
  align-items: flex-start;
}

.message.assistant-message-container .message-content {
  align-items: flex-start;
  width: 100%;
}

.message-actions {
  display: flex;
  gap: 0;
  font-size: 14px;
  width: 100%;
  justify-content: flex-end;
  margin-top: 12px;
  transition: opacity 0.3s ease;
}

.user-message-container .message-actions {
  justify-content: flex-end;
}

.assistant-message-container .message-actions {
  justify-content: flex-start;
}

/* 消息文本格式化 */
.message-text {
  line-height: 1.8;
  color: inherit;
  font-size: 16px;
  max-width: 100%;
  vertical-align: middle;
}

.message-action {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 4px;
  background: #efefef;
  margin-right: 5px;
  font-size: 14px;
}

.message-action:hover {
  background-color: #f0f7ff;
}


.ai-meta {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}

/* 加载动画 */
.assistant-loading {
  color: #999;
  font-size: 14px;
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.fa-spin {
  animation: fa-spin 1s infinite linear;
}
</style>

<style>
.markdown-text p {
  margin-top: 0;
  margin-bottom: 10px;
}

.markdown-text :last-child {
  margin: 0;
}

.markdown-text h1,
.markdown-text h2,
.markdown-text h3,
.markdown-text h4,
.markdown-text h5,
.markdown-text h6 {
  margin-top: 1.2em;
  margin-bottom: 0.8em;
  font-weight: 600;
  line-height: 1.5;
  font-size: 16px;
  color: inherit;
}

.markdown-text h1 {
  font-size: 18px;
  padding-bottom: 0.5em;
}

.markdown-text h2 {
  padding-bottom: 0.5em;
}

.markdown-text h3 {}

.markdown-text h4 {}

.markdown-text h5 {}

.markdown-text h6 {
  color: #6a737d;
}

.markdown-text a {
  color: #0366d6;
  text-decoration: none;
}

.markdown-text a:hover {
  text-decoration: underline;
}

.markdown-text ol {
  list-style: decimal;
  padding-left: 20px;
}

.markdown-text ul {
  list-style: none;
  padding-left: 0;
}

.markdown-text ul li {
  position: relative;
  padding-left: 16px;
}

.markdown-text ul li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 0.7em;
  width: 5px;
  height: 5px;
  background-color: #444;
  border-radius: 50%;
}

.markdown-text code {
  background-color: #f6f8fa;
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.markdown-text pre {
  background-color: #fff;
  border-radius: 5px;
  padding: 1em;
  overflow: auto;
  margin-top: 1rem;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.markdown-text pre code {
  background: none;
  padding: 0;
}

.markdown-text blockquote {
  border-left: 4px solid #dfe2e5;
  margin: 0 0 1em;
  padding-left: 1em;
}

.markdown-text table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1em;
  max-width: 100%;
  overflow-x: auto;
}

.markdown-text th,
.markdown-text td {
  border: 1px solid #dfe2e5;
  padding: 0.5em 1em;
}

.markdown-text th {
  background-color: #f6f8fa;
  font-weight: 600;
}

.markdown-text tr:nth-child(even) {
  background-color: #f6f8fa;
}

.markdown-text hr {
  height: 1px;
  background-color: #eaecef;
  border: none;
  margin: 1.5em 0;
}

.markdown-text img {
  max-width: 100%;
  height: auto;
  border-radius: 3px;
}

.markdown-text strong {
  font-weight: 600;
}

.markdown-text em {
  font-style: italic;
}
</style>

<style>
.typewriter-char {
  opacity: 0;
  animation: charFadeIn 0.2s ease-in forwards;
}

@keyframes charFadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>