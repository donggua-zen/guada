<template>
  <div class="message" :class="messageClass">
    <div class="w-[45px] h-[45px] rounded-full flex items-center justify-center shrink-0 self-start"
      :class="avatarClass">
      <Avatar v-if="!isAssistant" src="" :round="true" type="user"></Avatar>
      <Avatar v-else :src="avatar" :round="true" type="assistant"></Avatar>
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
              <n-icon size="18" class="text-green-700 mr-1">
                <Thinking />
              </n-icon>
              <span class="text-gray-600">{{ thinkingLabel }}</span>
            </div>
            <i class="fa-angle-down fas transition-transform duration-300 ml-2"
              :class="[isExpanded ? 'rotate-0' : '-rotate-90']"></i>
          </div>
          <div class="thinking-content transition-all duration-500 ease-in-out overflow-hidden text-gray-500"
            :class="isExpanded ? 'max-h-1500 opacity-100' : 'max-h-0 opacity-0'">
            <div class="border-l-2 border-gray-200 pl-4 mb-2  markdown-text"
              v-html="formattedText(getCurrentContent(message.contents).reasoning_content)"></div>
          </div>
        </div>

        <div class="message-text markdown-text" v-html="formattedText(getCurrentContent(message.contents).content)">
        </div>
        <n-alert v-if="message.meta_data && message.meta_data.finish_reason == 'error'" title="API请求错误" type="error">
          {{ message.meta_data.error }}
        </n-alert>
        <div v-if="message.is_streaming" class="assistant-loading flex items-center text-gray-500">
          <n-icon size="16" class="mr-2">
            <Loading />
          </n-icon>
          回答中...
        </div>
      </div>

      <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-400 items-center"
        :class="[isAssistant ? 'justify-start' : 'justify-end', message.is_streaming ? 'opacity-0' : 'opacity-100']">
        <div v-for="action in availableActions" :key="action.name"
          class="cursor-pointer flex items-center gap-1 py-1 px-2 rounded bg-gray-100 mr-1 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 active:scale-95 transition-transform duration-100"
          @click="handleAction(action.name)">
          <n-icon :component="action.icon" size="15" />
        </div>
        <template v-if="isLast && message.contents.length > 1">
          <div
            class="cursor-pointer flex items-center gap-1 py-1 px-2 rounded bg-gray-100 mr-1 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 active:scale-95 transition-transform duration-100"
            @click="switchContent('prev')" :disabled="!hasPrevContent">
            <n-icon :component="ArrowLeftTwotone" size="15" />
          </div>
          <div class="text-gray-400 hover:text-blue-500 transition-colors duration-200 flex items-center py-1 px-2">
            {{ getCurrentIndex(message.contents) }} / {{ message.contents.length }}
          </div>
          <div
            class="cursor-pointer flex items-center gap-1 py-1 px-2 rounded bg-gray-100 mr-1 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 active:scale-95 transition-transform duration-100"
            @click="switchContent('next')" :disabled="!hasNextContent">
            <n-icon :component="ArrowRightTwotone" size="15" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { marked } from "marked";
import { NAlert, NIcon, NButton } from "naive-ui";
import Avatar from "./Avatar.vue";
import {
  InsertDriveFileTwotone,
  EditTwotone,
  DeleteTwotone,
  ContentCopyTwotone,
  ArrowDownwardTwotone,
  RefreshFilled,
  ArrowBackIosNewTwotone as ArrowLeftTwotone,
  ArrowForwardIosTwotone as ArrowRightTwotone
} from "@vicons/material";

import { Loading, Thinking } from "@/components/icons";
import fileItem from "../components/FileItem.vue";

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  avatar: String,
  isLast: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits([
  "switch", // 添加switch事件
  "delete", "edit", "copy", "generate", "regenerate"
]);

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
  () => isAssistant.value && getCurrentContent(props.message.contents).reasoning_content
);

const thinkingLabel = ref("已深度思考");

// 计算是否有上一个/下一个内容
const hasPrevContent = computed(() => {
  const currentIndex = getCurrentIndex(props.message.contents) - 1;
  return currentIndex > 0;
});

const hasNextContent = computed(() => {
  const currentIndex = getCurrentIndex(props.message.contents) - 1;
  return currentIndex < props.message.contents.length - 1;
});

const formattedText = ((text) => {
  if (!text) return "";
  return marked.parse(text.trim());
})

const availableActions = computed(() => {
  const baseActions = [
    { name: "delete", icon: DeleteTwotone, text: "删除" },
    { name: "edit", icon: EditTwotone, text: "编辑" },
    { name: "copy", icon: ContentCopyTwotone, text: "复制" },
  ];

  if (!isAssistant.value && props.isLast) {
    baseActions.unshift({
      name: "generate",
      icon: ArrowDownwardTwotone,
      text: "重答",
    });
  }

  if (isAssistant.value && props.isLast) {
    baseActions.unshift({
      name: "regenerate",
      icon: RefreshFilled,
      text: "重新生成",
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

const switchContent = (direction) => {
  const contents = props.message.contents;
  const currentIndex = contents.findIndex(content => content.is_current);

  if (currentIndex === -1) return;

  let newIndex;
  if (direction === 'prev' && currentIndex > 0) {
    newIndex = currentIndex - 1;
  } else if (direction === 'next' && currentIndex < contents.length - 1) {
    newIndex = currentIndex + 1;
  } else {
    return;
  }

  // 通过事件通知父组件切换内容
  emit('switch', props.message, contents[newIndex]);
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

const getCurrentIndex = (messageContents) => {
  if (!messageContents || messageContents.length === 0) {
    return 1;
  }
  const currentIndex = messageContents.findIndex(content => content.is_current);
  return currentIndex !== -1 ? currentIndex + 1 : 1;
};

const getCurrentContent = (messageContents) => {
  if (!messageContents || messageContents.length === 0) {
    return {
      content: "",
      reasoning_content: "",
    };
  }
  const content = messageContents.find(c => c.is_current);
  if (content) {
    return content;
  }
  return messageContents[messageContents.length - 1];
};

defineExpose({ startThinking, stopThinking, switchContent });

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

/* 消息文本格式化 */
.message-text {
  line-height: 1.8;
  color: inherit;
  font-size: 16px;
  max-width: 100%;
  vertical-align: middle;
}

.ai-meta {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}

/* 加载动画 */
.assistant-loading {
  font-size: 14px;
  margin-top: 8px;
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

/* 表格样式优化 - 添加滚动条支持 */
.markdown-text table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1em;
  max-width: 100%;
  display: block;
  overflow-x: auto;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
}

.markdown-text table th,
.markdown-text table td {
  border: 1px solid #dfe2e5;
  padding: 0.5em 1em;
  white-space: nowrap;
  min-width: 100px;
}

.markdown-text table th {
  background-color: #f6f8fa;
  font-weight: 600;
  position: sticky;
  left: 0;
  z-index: 1;
}

.markdown-text table tr:nth-child(even) {
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

/* 表格容器样式，确保表格不会撑破容器 */
.markdown-text {
  overflow-wrap: break-word;
  word-wrap: break-word;
  max-width: 100%;
}

/* 响应式表格样式 */
@media (max-width: 768px) {
  .markdown-text table {
    font-size: 14px;
  }
  
  .markdown-text table th,
  .markdown-text table td {
    padding: 0.3em 0.5em;
    min-width: 80px;
  }
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