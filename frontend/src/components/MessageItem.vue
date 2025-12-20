<template>
  <div v-if="!streamingState.is_placeholder" class="message" :class="messageClass" ref="rootRef">
    <div class="message-content">
      <div v-if="isAssistant" class="text-xs text-gray-400 mb-3">
        <div class="flex items-center">
          <div class="mr-5 flex items-center">
            <div class="w-5.5 h-5.5 mr-2 relative top-[0px]">
              <Avatar :src="avatar" :round="false" type="assistant"></Avatar>
            </div>
            <span class="text-[1.3em] text-gray-500 font-">{{
              currentModelName
            }}</span>
          </div>
          <div class="flex items-center">
            <div class="inline-block h-3 w-3 flex flex-shrink-0 items-center justify-center mr-1 relative">
              <AccessTimeTwotone />
            </div><span class="" :title="currentContentTime.full">{{ currentContentTime.firendly }}</span>
          </div>
        </div>
      </div>
      <div class="message-card">
        <!-- 优化后的思考框部分 -->
        <div v-if="hasThinking" class="thinking-section" :class="{ 'thinking-expanded': isExpanded }">
          <div
            class="inline-flex justify-between items-center text-sm text-gray-700 cursor-pointer font-medium py-1 transition-colors duration-200 mb-1"
            @click="toggleExpand">
            <div class="flex items-center inline-flex">
              <span class="text-gray-500">{{ thinkingLabel }}</span>
            </div>
            <el-icon :class="['transition-transform duration-300 ml-2', isExpanded ? 'rotate-90' : 'rotate-0']"
              size="10">
              <ArrowRightTwotone />
            </el-icon>
          </div>
          <div class="thinking-container" :class="{ expanded: isExpanded }">
            <div @click="handleClick"
              class="thinking-content markdown-text py-0 border-l-2 pl-4 border-gray-200 dark:border-gray-700 mb-2 text-gray-500 dark:text-gray-400"
              v-html="debouncedThinkingFormattedText">
            </div>
          </div>
        </div>

        <div class="message-text markdown-text" @click="handleClick" v-html="debouncedFormattedText">
        </div>

        <el-alert v-if="metadata && metadata.finish_reason == 'error'" title="API请求错误" type="error" :closable="false">
          {{ metadata.error }}
        </el-alert>
        <div v-if="streamingState.is_streaming" class="assistant-loading flex items-center text-gray-500"
          style="position: sticky;top:0;">
          <el-icon size="16" class="mr-2 relative top-[0px]">
            <Loading />
          </el-icon>
          {{ streamingState.is_web_searching ? '搜索中...' : '回答中...' }}
        </div>

      </div>
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mt-3 ml-auto" v-if="message.files && message.files.length > 0">
        <FileItem v-for="file, index in message.files" :key="file.id" :name="file.display_name" :type="file.file_type"
          :ext="file.file_extension" :size="file.file_size" :preview-url="file.preview_url"
          :clickable="file.file_type === 'image'" @click="handleImageClick(index)"></FileItem>
      </div>
      <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-500 items-center"
        v-if="!streamingState.is_streaming"
        :class="[isAssistant ? 'justify-start' : 'justify-end', message.is_streaming ? 'opacity-0' : 'opacity-100']">


        <div class="message-action-button" @click="handleAction('copy')">
          <el-icon :size="16">
            <ContentCopyTwotone />
          </el-icon>
        </div>

        <template v-if="!isAssistant && props.allowGenerate">
          <div class="message-action-button" @click="handleAction('generate')">
            <el-icon :size="16">
              <ArrowDownwardTwotone />
            </el-icon>
          </div>
        </template>

        <template v-if="isAssistant && props.isLast">
          <div class="message-action-button" @click="handleAction('regenerate')">
            <el-icon :size="16">
              <RefreshFilled />
            </el-icon>
          </div>
        </template>

        <!-- 内容切换按钮（如果需要） -->
        <template v-if="isLast && message.contents.length > 1">
          <div class="message-action-button" @click="switchContent('prev')" :disabled="!hasPrevContent">
            <el-icon :size="16">
              <ArrowLeftTwotone />
            </el-icon>
          </div>
          <div class="text-gray-700 transition-colors duration-200 flex items-center py-1 px-2">
            {{ getCurrentIndex(message.contents) }} / {{ message.contents.length }}
          </div>
          <div class="message-action-button" @click="switchContent('next')" :disabled="!hasNextContent">
            <el-icon :size="16">
              <ArrowRightTwotone />
            </el-icon>
          </div>
        </template>

        <!-- 更多按钮下拉菜单 -->
        <el-dropdown trigger="click" @command="handleMoreAction">
          <div class="message-action-button">
            <el-icon :size="16">
              <MoreVertOutlined />
            </el-icon>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="edit">
                <div class="flex items-center">
                  <el-icon class="mr-2">
                    <EditTwotone />
                  </el-icon>
                  编辑内容
                </div>
              </el-dropdown-item>
              <el-dropdown-item command="delete">
                <div class="flex items-center">
                  <el-icon class="mr-2">
                    <DeleteTwotone />
                  </el-icon>
                  删除消息
                </div>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

      </div>
    </div>
  </div>
  <el-image-viewer v-if="showImageViewer" v-model:visible="showImageViewer" :url-list="previewList"
    :initial-index="currentPreViewIndex" @close="showImageViewer = false" :teleported="true"/>
</template>

<script setup>
import { computed, ref, watch, onUnmounted, onMounted, h, nextTick } from "vue";
import { ElAlert, ElIcon, ElImageViewer, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { useDebounceFn } from "@vueuse/core";
import {
  EditTwotone,
  DeleteTwotone,
  ContentCopyTwotone,
  ArrowDownwardTwotone,
  RefreshFilled,
  ArrowBackIosNewTwotone as ArrowLeftTwotone,
  ArrowForwardIosTwotone as ArrowRightTwotone,
  MoreVertOutlined,
  AccessTimeTwotone,
} from "@vicons/material";

import { Loading } from "./icons";
import { FileItem, Avatar } from "./ui";
import { usePopup } from "../composables/usePopup";
import { formatTime } from '../utils'
import { useMarkdown } from "../composables/useMarkdown";

const { marked } = useMarkdown()

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
  "render-complete"
]);


const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);
const isExpanded = ref(false);
const rootRef = ref(null);

const previewList = computed(() => {
  const files = props.message.files || [];
  return files.map(file => file.url || file.preview_url);
})

const isAssistant = computed(() => props.message.role === "assistant");
const messageClass = computed(() =>
  isAssistant.value ? "assistant-message-container" : "user-message-container"
);
// const avatarClass = computed(() =>
//   isAssistant.value ? "assistant-avatar" : "user-avatar"
// );

const hasThinking = computed(
  () => isAssistant.value && getCurrentContent(props.message.contents).reasoning_content
);

const metadata = computed(() => {
  const content = getCurrentContent(props.message.contents);
  return content.meta_data;
});


// 优化：使用更精确的依赖
const state = computed(() =>
  isAssistant.value ? props.message.state : null
);

const streamingState = computed(() => ({
  is_streaming: state.value?.is_streaming ?? false,
  is_thinking: state.value?.is_thinking ?? false,
  is_web_searching: state.value?.is_web_searching ?? false,
  is_placeholder: props.message.contents.filter(content => content.is_current).length == 0
}));

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
  return streamingState.value.is_thinking ? "思考中..." : "已深度思考"
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
const debouncedMarkdownUpdate = useDebounceFn(async (content) => {
  currentMarkdownContent.value = content;
  emit("render-complete");
}, 50, { maxWait: 150 });

// 思考内容消抖处理
const currentThinkingContent = ref("");
const debouncedThinkingUpdate = useDebounceFn(async (content) => {
  currentThinkingContent.value = content;
  emit("render-complete");
}, 50, { maxWait: 150 });

// 处理流式内容更新的通用函数
const processStreamingContent = (content, oldContent, updateFunction) => {
  if (!content) {
    content = ""
  }
  updateFunction(content);
};

// 监听主内容变化
watch(
  () => getCurrentContent(props.message.contents).content,
  (newContent, oldContent) => {
    if (props.message.state?.is_streaming) {
      processStreamingContent(newContent, oldContent, debouncedMarkdownUpdate);
    } else {
      currentMarkdownContent.value = newContent;
    }
  },
  { immediate: true }
);

// 监听思考内容变化
watch(
  () => getCurrentContent(props.message.contents).reasoning_content,
  (newContent, oldContent) => {
    if (props.message.state?.is_streaming) {
      processStreamingContent(newContent, oldContent, debouncedThinkingUpdate);
    } else {
      currentThinkingContent.value = newContent;
    }
  },
  { immediate: true }
);

watch(
  () => props.message?.state?.is_thinking,
  (newState, oldState) => {
    if (newState) {
      showThinking();
    } else {
      hideThinking();
    }
  }
)

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

const handleClick = (event) => {
  if (event.target.closest('.copy-code-button')) {
    const button = event.target.closest('.copy-code-button')
    const codeBlock = button.closest('.custom-code-block')
    const codeElement = codeBlock?.querySelector('code')

    if (codeElement) {
      navigator.clipboard.writeText(codeElement.textContent).then(() => {
        toast.success("代码已复制到剪贴板")
      }).catch(err => {
        console.error('复制失败:', err)
        toast.error("复制失败")
      })
    }
  }
}


defineExpose({ el: rootRef, showThinking, hideThinking, switchContent, });
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
  font-size: var(--size-text-base);
  letter-spacing: 1px;
  transition: all 0.3s ease;
  max-width: 100%;
}

/* 用户消息气泡特定样式 */
.user-message-container .message-card {
  background-color: var(--color-bubble-user-bg);
  color: var(--color-bubble-user-text);
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid var(--color-bubble-user-border);
  margin-left: auto;
}

/* AI消息气泡特定样式 */
.assistant-message-container .message-card {
  background: var(--color-bubble-assitant-bg);
  color: var(--color-bubble-assitant-text);
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
  max-width: 100%;
  vertical-align: middle;
}

/* 加载动画 */
.assistant-loading {
  font-size: var(--size-text-sm);
  margin-top: 8px;
}

/* 重用的消息操作按钮样式 */
.message-action-button {
  @apply cursor-pointer flex items-center gap-1 py-1 px-1 rounded mr-1 hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}

/* 优化后的思考框样式 - 使用CSS Grid方案 */
.thinking-container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: grid-template-rows;
  overflow: hidden;
}

.thinking-container.expanded {
  grid-template-rows: 1fr;
}

.thinking-content {
  min-height: 0;
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  transition-delay: 0s;
}

.thinking-container.expanded .thinking-content {
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0.1s;
}

/* 优化性能：减少重排 */
.thinking-content>* {
  transform: translateZ(0);
}

</style>

<style>
@import "@/assets/markdown.css";
/* 全局样式：确保 v-html 中的代码高亮生效 */
@import 'highlight.js/styles/foundation.css';
</style>