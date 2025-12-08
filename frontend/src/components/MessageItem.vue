<template>
  <div class="message" :class="messageClass">
    <div class="hidden  w-[40px] h-[40px] rounded-full flex items-center justify-center shrink-0 self-start"
      :class="avatarClass">
      <Avatar v-if="!isAssistant" :src="avatar" :round="true" type="user"></Avatar>
      <Avatar v-else :src="avatar" :round="true" type="assistant"></Avatar>
    </div>

    <div class="message-content">
      <div v-if="isAssistant" class="text-xs text-gray-400 mb-3">
        <div class="flex items-center">
          <div class="mr-2 flex items-center">
            <div class="w-5.5 h-5.5 mr-2">
              <Avatar :src="avatar" :round="false" type="assistant"></Avatar>
            </div>
            <span class="text-lg text-gray-450">{{
              currentModelName
            }}</span>
          </div>
          <div class="flex items-center">
            <div class="inline-block h-3 w-3 flex flex-shrink-0 items-center justify-center mr-1 relative top-[1px]">
              <AccessTimeTwotone />
            </div><span class="" :title="currentContentTime.full">{{ currentContentTime.firendly }}</span>
          </div>
        </div>
      </div>
      <div class="message-card">
        <div v-if="hasThinking" class="thinking-section" :class="{ 'thinking-expanded': isExpanded }">
          <div
            class="inline-flex justify-between items-center text-sm text-gray-700 cursor-pointer font-medium py-1 transition-colors duration-200 mb-1"
            @click="toggleExpand">
            <div class="flex items-center inline-flex">
              <!-- <n-icon size="18" class="text-green-700 mr-1">
                <Thinking />
              </n-icon> -->
              <span class="text-gray-500">{{ thinkingLabel }}</span>
            </div>
            <n-icon :component="ArrowRightTwotone" class="transition-transform duration-300 ml-2" size="10"
              :class="[isExpanded ? 'rotate-90' : 'rotate-0']"></n-icon>
          </div>
          <div class="thinking-content transition-all duration-500 ease-in-out overflow-hidden text-gray-500"
            :class="isExpanded ? 'max-h-1500 opacity-100' : 'max-h-0 opacity-0'">
            <div class="border-l-2 border-gray-200 pl-4 mb-2  markdown-text" v-html="debouncedThinkingFormattedText">
            </div>
          </div>
        </div>

        <div class="message-text markdown-text" v-html="debouncedFormattedText">
        </div>

        <n-alert v-if="metadata && metadata.finish_reason == 'error'" title="API请求错误" type="error">
          {{ metadata.error }}
        </n-alert>
        <div v-if="state.is_streaming" class="assistant-loading flex items-center text-gray-500">
          <n-icon size="16" class="mr-2 relative top-[1px]">
            <Loading />
          </n-icon>
          {{ state.is_web_searching ? '搜索中...' : '回答中...' }}
        </div>

      </div>
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mt-3 ml-auto" v-if="message.files && message.files.length > 0">
        <fileItem v-for="file, index in message.files" :key="file.id" :name="file.display_name" :type="file.file_type"
          :ext="file.file_extension" :size="file.file_size" :preview-url="file.preview_url"
          :clickable="file.file_type === 'image'" @click="handleImageClick(index)"></fileItem>
      </div>
      <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-400 items-center" v-if="!state.is_streaming"
        :class="[isAssistant ? 'justify-start' : 'justify-end', message.is_streaming ? 'opacity-0' : 'opacity-100']">
        <!-- 保留的按钮：generate, regenerate, copy -->
        <template v-if="!isAssistant && props.allowGenerate">
          <div class="message-action-button" @click="handleAction('generate')">
            <n-icon :component="ArrowDownwardTwotone" size="15" />
          </div>
        </template>

        <template v-if="isAssistant && props.isLast">
          <div class="message-action-button" @click="handleAction('regenerate')">
            <n-icon :component="RefreshFilled" size="15" />
          </div>
        </template>

        <div class="message-action-button" @click="handleAction('copy')">
          <n-icon :component="ContentCopyTwotone" size="15" />
        </div>

        <!-- 更多按钮下拉菜单 -->
        <n-dropdown trigger="click" :options="moreOptions" @select="handleMoreAction">
          <div class="message-action-button">
            <n-icon :component="MoreVertOutlined" size="15" />
          </div>
        </n-dropdown>

        <!-- 内容切换按钮（如果需要） -->
        <template v-if="isLast && message.contents.length > 1">
          <div class="message-action-button" @click="switchContent('prev')" :disabled="!hasPrevContent">
            <n-icon :component="ArrowLeftTwotone" size="15" />
          </div>
          <div class="text-gray-400 hover:text-blue-500 transition-colors duration-200 flex items-center py-1 px-2">
            {{ getCurrentIndex(message.contents) }} / {{ message.contents.length }}
          </div>
          <div class="message-action-button" @click="switchContent('next')" :disabled="!hasNextContent">
            <n-icon :component="ArrowRightTwotone" size="15" />
          </div>
        </template>
      </div>
    </div>
  </div>
  <n-image-group v-model:show="showImageViewer" v-model:current="currentPreViewIndex" :src-list="previewList" />
</template>

<script setup>
import { computed, ref, watch, onUnmounted, onMounted } from "vue";
import { Marked } from "marked";
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js';
import { NAlert, NIcon, NImageGroup, NDropdown } from "naive-ui";
import { useDebounceFn } from "@vueuse/core";
import Avatar from "./ui/Avatar.vue";
import {
  EditTwotone,
  DeleteTwotone,
  ContentCopyTwotone,
  ArrowDownwardTwotone,
  RefreshFilled,
  ArrowBackIosNewTwotone as ArrowLeftTwotone,
  ArrowForwardIosTwotone as ArrowRightTwotone,
  MoreVertOutlined,
  CloudUploadTwotone,
  AccessTimeTwotone,
} from "@vicons/material";

import { Loading, Thinking } from "@/components/icons";
import fileItem from "./ui/FileItem.vue";
import { usePopup } from "@/composables/usePopup";
import { formatTime } from '@/utils'
const { toast } = usePopup();

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  avatar: String,
  isLast: {
    type: Boolean,
    default: false
  },
  allowGenerate: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits([
  "switch", // 添加switch事件
  "delete", "edit", "copy", "generate", "regenerate",
  "renderComplete" // 渲染完成
]);

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);
// 在 markdown 渲染上下文中无法使用 Vue 组件，所以我们直接使用 SVG 字符串
const coypysvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
  <path fill="currentColor" d="M8 7h11v14H8z" opacity=".3"/>
  <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
</svg>`
const renderer = {
  code(code) {
    const lang = code.lang || 'text';
    return `
      <div class="custom-code-block">
        <div class="code-header">
          <span class="code-language">${lang}</span>
          <button class="copy-code-button" onclick="window.handleCopyCode(this)"><i role="img">${coypysvg}</i></button>
        </div>
        <pre class="hljs language-${lang}"><code class="hljs language-${lang}">${code.text}</code></pre>
      </div>
    `;
  }
};

// 设置自定义渲染器
marked.use({ renderer, breaks: true });

const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);
const isExpanded = ref(false);

const previewList = computed(() => {
  const files = props.message.files || [];
  return files.map(file => file.url || file.preview_url);
})

const isAssistant = computed(() => props.message.role === "assistant");
const messageClass = computed(() =>
  isAssistant.value ? "assistant-message-container" : "user-message-container"
);
const avatarClass = computed(() =>
  isAssistant.value ? "assistant-avatar" : "user-avatar"
);

const hasThinking = computed(
  () => isAssistant.value && getCurrentContent(props.message.contents).reasoning_content
);

const metadata = computed(() => {
  const content = getCurrentContent(props.message.contents);
  return content.meta_data;
});

const state = computed(() => {
  if (isAssistant.value) {
    return props.message.state || {
      is_streaming: false,
      is_thinking: false,
      is_web_searching: false,
    }
  }
  return {
    is_streaming: false,
    is_thinking: false,
    is_web_searching: false,
  }
});

const currentModelName = computed(() => {
  const modelName = metadata.value?.model_name;
  return modelName
    ? modelName.split("/").pop()
    : "unknown"
});

const currentContentTime = computed(() => {
  const content = getCurrentContent(props.message.contents);
  return {
    firendly: formatTime(content.created_at, 'friendly'),
    full: formatTime(content.created_at, 'full')
  };
})

const thinkingLabel = computed(() => {
  return state.value.is_thinking ? "思考中..." : "已深度思考"
});

// 计算是否有上一个/下一个内容
const hasPrevContent = computed(() => {
  const currentIndex = getCurrentIndex(props.message.contents) - 1;
  return currentIndex > 0;
});

const hasNextContent = computed(() => {
  const currentIndex = getCurrentIndex(props.message.contents) - 1;
  return currentIndex < props.message.contents.length - 1;
});

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

// 主内容消抖处理
const currentMarkdownContent = ref("");
const debouncedMarkdownUpdate = useDebounceFn((content) => {
  currentMarkdownContent.value = content;
}, 50, { maxWait: 150 });

// 思考内容消抖处理
const currentThinkingContent = ref("");
const debouncedThinkingUpdate = useDebounceFn((content) => {
  currentThinkingContent.value = content;
}, 50, { maxWait: 150 });

// 监听主内容变化
watch(
  () => getCurrentContent(props.message.contents).content,
  (newContent, oldContent) => {
    if (props.message.is_streaming) {
      debouncedMarkdownUpdate(newContent);
      // 只在内容有实质性变化时触发渲染完成
      if (newContent.length > oldContent?.length) {
        emit("renderComplete");
      }
    } else {
      currentMarkdownContent.value = newContent;
    }
  },
  { immediate: true }
);

// 监听思考内容变化
watch(
  () => getCurrentContent(props.message.contents).reasoning_content,
  (newContent) => {
    if (props.message.is_streaming) {
      debouncedThinkingUpdate(newContent);
      emit("renderComplete");
    } else {
      currentThinkingContent.value = newContent;
    }
  },
  { immediate: true }
);

// 消抖后的主内容渲染
const debouncedFormattedText = computed(() => {
  if (!currentMarkdownContent.value) return "";
  try {
    return marked.parse(currentMarkdownContent.value.trim());
  } catch (error) {
    console.error("Markdown解析错误:", error);
    return currentMarkdownContent.value;
  }
});

// 消抖后的思考内容渲染
const debouncedThinkingFormattedText = computed(() => {
  if (!currentThinkingContent.value) return "";
  try {
    return marked.parse(currentThinkingContent.value.trim());
  } catch (error) {
    console.error("思考内容Markdown解析错误:", error);
    return currentThinkingContent.value;
  }
});

// 更多按钮的选项
const moreOptions = computed(() => {
  const options = [
    {
      label: '编辑内容',
      key: 'edit',
      icon: () => h(NIcon, { component: EditTwotone, size: 15 })
    },
    {
      label: '删除消息',
      key: 'delete',
      icon: () => h(NIcon, { component: DeleteTwotone, size: 15 })
    }
  ];
  return options;
});

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

const handleAction = (action) => {
  emit(action, props.message);
};

const handleMoreAction = (key) => {
  emit(key, props.message);
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

const showThinking = () => {
  isExpanded.value = true;
};

const hideThinking = () => {
  isExpanded.value = false;
};

const handleImageClick = (index) => {
  currentPreViewIndex.value = index;
  showImageViewer.value = true;
};

const getCurrentIndex = (messageContents) => {
  if (!messageContents || messageContents.length === 0) {
    return 1;
  }
  const currentIndex = messageContents.findIndex(content => content.is_current);
  return currentIndex !== -1 ? currentIndex + 1 : 1;
};

// 注册全局复制代码函数
const registerGlobalCopyFunction = () => {
  window.handleCopyCode = function (button) {
    const codeBlock = button.closest('.custom-code-block').querySelector('code');
    if (!codeBlock) return;
    const text = codeBlock.textContent;

    navigator.clipboard.writeText(text).then(() => {
      toast.success("代码已复制到剪贴板");
    }).catch(err => {
      console.error('复制失败:', err);
      toast.error("复制失败");
    });
  };
};

onMounted(() => {
  registerGlobalCopyFunction();
});

onUnmounted(() => {
  // 清理全局函数
  if (typeof window.handleCopyCode !== 'undefined') {
    delete window.handleCopyCode;
  }
});

defineExpose({ showThinking, hideThinking, switchContent, });
</script>

<script>
import { h } from 'vue';

export default {
  components: {
    NDropdown
  }
}
</script>

<style scoped>
@reference "tailwindcss";

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
  font-size: 16px;
  letter-spacing: 1px;
  transition: all 0.3s ease;
}

/* 用户消息气泡特定样式 */
.user-message-container .message-card {
  /* margin-left: auto; */
  background-color: var(--user-bubble-bg);
  color: var(--user-bubble-text-color);
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid var(--user-bubble-border-color);
  margin-left: auto;
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
  line-height: 1.7;
  color: inherit;
  font-size: 16px;
  max-width: 100%;
  vertical-align: middle;
}

/* 加载动画 */
.assistant-loading {
  font-size: 14px;
  margin-top: 8px;
}

/* 重用的消息操作按钮样式 */
.message-action-button {
  @apply cursor-pointer flex items-center gap-1 py-1 px-2 rounded bg-gray-100 mr-1 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 active:scale-95 transition-transform duration-100;
}
</style>

<style>
.markdown-text p {
  margin-top: 10px;
  margin-bottom: 0;
}

.markdown-text :first-child {
  margin-top: 0;
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
  /* list-style: decimal-leading-zero; */
  /* list-style-position: inside; */
  list-style: none;
  counter-reset: item;
  margin-top: 8px;
}

.markdown-text ul {
  list-style: none;
  padding-left: 0;
  display: flex;
  align-items: flex-start;
  width: 100%;
  flex-direction: column;
  margin-top: 8px;
}

.markdown-text ol>li,
.markdown-text ul>li {
  position: relative;
  margin-bottom: 8px;
  margin-top: 0;
}

.markdown-text ul>li {
  padding-left: 14px;
}

.markdown-text ol>li {
  flex-wrap: wrap;
  counter-increment: item;
  padding-left: 3ch;
  /* 预留3个字符宽度 */
  position: relative;
}

.markdown-text ol>li:before {
  content: counter(item) ".";
  text-align: right;
  color: #666;
  min-width: 14px;
  display: inline-block;
  padding-right: 5px;
  display: inline-block;
  width: 2.5ch;
  position: absolute;
  left: 0;
}

/* 其他子元素保持正常流 */
ol>*:not(li) {
  display: block;
  margin: 1em 0;
}

.markdown-text ul>li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 0.7em;
  width: 4px;
  height: 4px;
  background-color: #555;
  border-radius: 50%;
}

.markdown-text ul>li:last-child {
  margin-bottom: 0;
}

.markdown-text ul>li:empty {
  display: none;
}

.markdown-text ul>li ul {
  margin-top: 8px;
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
  /* padding: 1em; */
  overflow: auto;
  margin-top: 1rem;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.markdown-text blockquote {
  border-left: 4px solid #dfe2e5;
  margin: 1em 0 0;
  padding-left: 1em;
}

/* 表格样式优化 - 添加滚动条支持 */
.markdown-text table {
  border-collapse: collapse;
  margin-bottom: 1em;
  max-width: 100%;
  display: block;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}


/* .markdown-text table tr:first-child { 
  border-top: none;
} */

.markdown-text table th,
.markdown-text table td {
  border: 1px solid #dfe2e5;
  vertical-align: top;
  padding: 0.5em;
  min-width: 100px;
  max-width: 580px;
}

.markdown-text table th:last-child,
.markdown-text table td:last-child {
  padding-right: 0;
}


.markdown-text table th {
  background-color: #f6f8fa;
  /* font-weight: 600; */
  text-align: center;
  position: sticky;
  left: 0;
  z-index: 1;
}

.markdown-text table tr:nth-child(even) {
  /* background-color: #f6f8fa; */
}

.markdown-text hr {
  height: 1px;
  background-color: #eaecef;
  border: none;
  margin: 1.2em 0;
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
/* 全局样式：确保 v-html 中的代码高亮生效 */
@import 'highlight.js/styles/foundation.css';

/* 确保 hljs 样式正常工作 */
.custom-code-block pre.hljs {
  margin: 0;
  border-radius: 0;
  border: none;
  background: #fafafb !important;
}

.custom-code-block code.hljs {
  background: transparent !important;
  display: block;
  overflow-x: auto;
}

/* 代码块容器样式 */
.custom-code-block {
  position: relative;
  margin: 1em 0;
  border-radius: 14px;
  overflow: hidden;
  background: #f3f4f6;
  border: 1px solid #e3e3e7;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f3f3f5;
  color: #222;
  font-size: 0.8em;
}

.code-language {
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
}

.copy-code-button {
  color: #666;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 15px;
}

.copy-code-button:hover {
  color: #333;
}

.copy-code-button svg {
  width: 15px;
  height: 15px;
}

.copy-code-button:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
