<template>
  <div v-if="!streamingState.isPlaceholder" class="message-item" :class="messageClass" ref="rootRef"
    :data-message-id="message.id">
    <!-- 如果消息内容为空,显示提示信息 -->
    <div v-if="turns.length === 0" class="message-item__wrapper">
      <div class="text-gray-400 text-sm italic">消息内容为空(数据异常)</div>
    </div>
    <div v-else class="message-item__wrapper">
      <div v-if="isAssistant" class="text-xs text-gray-400 mb-3">
        <div class="flex items-center">
          <div class="mr-5 flex items-center">
            <Avatar class="w-5.5 h-5.5 mr-2 relative top-0" :src="modelAvatarPath" :round="false" type="assistant"
              :name="currentModelName"></Avatar>
            <span class="text-[1.3em] text-gray-500 font-">{{
              currentModelName
            }}</span>
          </div>
          <div class="flex items-center">
            <div class="inline-block h-3 w-3 shrink-0 items-center justify-center mr-1 relative">
              <AccessTimeTwotone />
            </div><span class="" :title="currentContentTime.full">{{ currentContentTime.firendly }}</span>
          </div>
        </div>
      </div>
      <div class="message-item__card">
        <template v-for="(turn, index) in turns" :key="turn.id">
          <!-- 使用拆分后的思考框组件 -->
          <MessageThinkingSection v-if="turn.reasoningContent" :reasoning-content="turn.reasoningContent"
            :is-thinking="turn.state?.isThinking || false" :is-streaming="turn.state?.isStreaming || false"
            :thinking-duration-ms="turn.metadata?.thinkingDurationMs" :meta-data="turn.metadata"
            @click="handleThinkingClick" @render-complete="handleRenderComplete" />

          <MarkdownContent v-if="turn.content" class="message-item__text markdown-text" @click="handleClick"
            @render-complete="handleRenderComplete" :content="turn.content" :debounced="turn.state?.isStreaming" />

          <!-- 使用拆分后的工具调用组件 -->
          <MessageToolCalls v-if="turn.additionalKwargs && turn.additionalKwargs.toolCalls"
            :tool-calls="turn.additionalKwargs.toolCalls" :tool-responses="turn.additionalKwargs.toolCallsResponse"
            :is-streaming="turn.state?.isStreaming || false" />
        </template>
        <el-alert v-if="metadata && metadata.finishReason == 'error'" title="API 请求错误" type="error" :closable="false">
          {{ metadata.error }}
        </el-alert>

        <!-- Token 消耗显示区域 -->
        <div v-if="isAssistant && tokenUsage && !streamingState.isStreaming" class="token-usage-section mt-2">
          <div class="flex items-center gap-3 text-xs text-gray-400">
            <el-icon size="13" class="text-gray-400">
              <InsightsTwotone />
            </el-icon>
            <span class="text-gray-500">Tokens:</span>
            <span class="token-item">
              <span class="text-gray-400 dark:text-gray-300 text-xs">Prompt</span>&nbsp;<span
                class="text-gray-500 dark:text-gray-300">{{ formatTokenNumber(tokenUsage.promptTokens)
                }}</span>
            </span>
            <span class="token-item">
              <span class="text-gray-400 dark:text-gray-300">Completion</span>&nbsp;<span
                class="text-gray-500 dark:text-gray-300">{{
                  formatTokenNumber(tokenUsage.completionTokens) }}</span>
            </span>
            <span class="token-item">
              <span class="text-gray-400 dark:text-gray-300">Total</span>&nbsp;<span
                class="text-gray-500 dark:text-gray-300">{{
                  formatTokenNumber(tokenUsage.totalTokens) }}</span>
            </span>
          </div>
        </div>

        <div v-if="streamingState.isStreaming" class="assistant-loading flex items-center text-gray-500"
          style="position: sticky;top:0;">
          <el-icon size="16" class="mr-2 relative top-0">
            <Loading />
          </el-icon>
          回答中
        </div>

      </div>
      <!--知识库-->
      <div class="knowledge-base flex flex-wrap gap-2 mt-3 ml-auto"
        v-if="message.role === 'user' && turns.length > 0 && turns[0].metadata?.referencedKbs && turns[0].metadata?.referencedKbs.length > 0">
        <div v-for="kb, index in turns[0].metadata?.referencedKbs" :key="kb.id">
          <div
            class="knowledge-base-item rounded-md px-2 py-1 bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs flex items-center gap-1">
            <MenuBookOutlined class="w-4 h-4" />
            {{ kb.name }}
          </div>
        </div>
      </div>
      <!-- 文件列表显示区域 -->
      <div class="file-list flex flex-wrap gap-2 mt-3 ml-auto" v-if="message.files && message.files.length > 0">
        <FileItem v-for="file, index in message.files" :key="file.id" :name="file.displayName" :type="file.fileType"
          :ext="file.fileExtension" :size="file.fileSize" :preview-url="file.previewUrl"
          :clickable="file.fileType === 'image'" @click="handleImageClick(index as number)"></FileItem>
      </div>

      <!-- 使用拆分后的操作按钮组件 -->
      <MessageActions v-if="!streamingState.isStreaming" :is-assistant="isAssistant" :is-last="isLast"
        :allow-generate="allowGenerate" :content-versions="contentVersions" :current-version-index="currentVersionIndex"
        @copy="handleCopy" @generate="handleGenerate" @regenerate="handleRegenerate" @switch-version="switchContent"
        @edit="handleEdit" @delete="handleDelete" />
    </div>
  </div>
  <el-image-viewer v-if="showImageViewer" v-model:visible="showImageViewer" :url-list="previewList"
    :initial-index="currentPreViewIndex" @close="showImageViewer = false" :teleported="true" />
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from "vue";
import { ElAlert, ElIcon, ElImageViewer } from "element-plus";
import { useDebounceFn } from "@vueuse/core";
import {
  AccessTimeTwotone,
  InsightsTwotone,
  MenuBookOutlined,
} from "@vicons/material";

// @ts-ignore - icons 组件尚未迁移到 TypeScript
import { Loading } from "../icons";
// @ts-ignore - UI 组件尚未迁移到 TypeScript
import { FileItem, Avatar } from "../ui";
import { usePopup } from "../../composables/usePopup";
import { formatTime } from '../../utils';
import { getCurrentTurns, getContentVersions } from '@/utils/messageUtils';
import { getModelDisplayName, getModelAvatarPath } from '@/utils/modelUtils';

// 导入拆分后的子组件
import MessageThinkingSection from './message-item/MessageThinkingSection.vue';
import MessageToolCalls from './message-item/MessageToolCalls.vue';
import MessageActions from './message-item/MessageActions.vue';


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

// 类型化 emit 定义
const emit = defineEmits<{
  switch: [message: any, content: any]
  delete: [message: any]
  edit: [message: any]
  copy: [message: any]
  generate: [message: any]
  regenerate: [message: any]
  'render-complete': [message: any]
}>();

// ============================================
// 🔹 响应式数据
// ============================================
const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);
const rootRef = ref<HTMLElement | null>(null);

// ============================================
// 🔹 ResizeObserver + 图片加载监听机制
// ============================================
let resizeObserver: ResizeObserver | null = null;

const debouncedEmitRenderComplete = useDebounceFn(() => {
  emit('render-complete', props.message);
}, 200);

const waitForImagesLoaded = async (): Promise<void> => {
  if (!rootRef.value) return;

  const images = Array.from(rootRef.value.querySelectorAll('img'));

  if (images.length === 0) {
    return;
  }

  console.log(`[MessageItem] Waiting for ${images.length} image(s) to load`);

  const promises = images.map(img => {
    if (img.complete) {
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      const onLoad = () => {
        console.log('[MessageItem] Image loaded:', img.src);
        resolve();
      };

      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', () => {
        console.warn('[MessageItem] Image failed to load:', img.src);
        resolve();
      }, { once: true });
    });
  });

  await Promise.all(promises);
  console.log('[MessageItem] All images loaded');
};



watch(
  () => props.message.files,
  async (newFiles) => {
    if (newFiles && newFiles.length > 0) {
      await nextTick();
    }
  },
  { immediate: true }
);

const previewList = computed(() => {
  const files = props.message.files || [];
  return files.map((file: any) => file.url || file.previewUrl);
})

const isAssistant = computed(() => props.message.role === "assistant");
const messageClass = computed(() =>
  isAssistant.value ? "message-item--assistant" : "message-item--user"
);
// const avatarClass = computed(() =>
//   isAssistant.value ? "assistant-avatar" : "user-avatar"
// );

const turns = computed(() => {
  return getCurrentTurns(props.message as any);
});

// const hasThinking = computed(
//   () => isAssistant.value && getCurrentContent(props.message.contents).reasoningContent
// );

const metadata = computed(() => {
  const content = turns.value[turns.value.length - 1];
  // 确保返回一个对象，即使 metadata 为 null/undefined
  return content?.metadata || {};
});

const state = computed(() =>
  isAssistant.value ? props.message.state : null
);

const streamingState = computed(() => ({
  isStreaming: state.value?.isStreaming ?? false,
  isThinking: state.value?.isThinking ?? false,
  isWebSearching: state.value?.isWebSearching ?? false,
  isPlaceholder: false
}));

const currentModelName = computed(() => {
  const modelName = metadata.value?.modelName;
  return modelName ? getModelDisplayName(modelName) : "unknown";
});

// 模型头像路径
const modelAvatarPath = computed(() => {
  const modelName = metadata.value?.modelName;
  if (!modelName) return undefined;

  // 尝试从 modelName 中提取 provider 信息
  // 如果 modelName 包含 "/"，则前半部分可能是 provider
  const parts = modelName.split("/");
  const providerName = parts.length > 1 ? parts[0] : undefined;

  return getModelAvatarPath(modelName, providerName) || undefined;
});

const currentContentTime = computed(() => {
  const content = turns.value[0];
  // 如果 turns 为空，返回默认时间
  if (!content) {
    return {
      firendly: '',
      full: ''
    };
  }
  return {
    firendly: formatTime(content.createdAt || '', 'friendly'),
    full: formatTime(content.createdAt || '', 'full')
  };
});

const tokenUsage = computed(() => {
  if (!isAssistant.value || !turns.value || turns.value.length === 0) {
    return null;
  }

  const lastTurn = turns.value[turns.value.length - 1];
  return lastTurn?.metadata?.usage || null;
});

const contentVersions = computed(() => {
  return getContentVersions(props.message as any);
});

const currentVersionIndex = computed(() => {
  if (!props.message.currentTurnsId) return 0;
  return contentVersions.value.findIndex(version => version === props.message.currentTurnsId);
});

const handleRenderComplete = () => {
  // Markdown 渲染完成后立即触发
};





const handleAction = (action: 'switch' | 'delete' | 'edit' | 'copy' | 'generate' | 'regenerate') => {
  emit(action as any, props.message);
};

// 具体的事件处理函数
const handleCopy = () => handleAction('copy');
const handleGenerate = () => handleAction('generate');
const handleRegenerate = () => handleAction('regenerate');
const handleEdit = () => handleAction('edit');
const handleDelete = () => handleAction('delete');

// 思考框点击处理（无参数）
const handleThinkingClick = () => {
  // 创建一个模拟的 MouseEvent 对象，或者调用 handleClick 的逻辑
  // 由于 handleClick 主要是处理代码复制，这里可以不做任何操作
  // 如果需要，可以在这里添加思考框特定的点击逻辑
};

const switchContent = (direction: 'prev' | 'next') => {
  const currentIndex = currentVersionIndex.value;

  if (currentIndex === -1) return;

  let newIndex;
  if (direction === 'prev' && currentIndex > 0) {
    newIndex = currentIndex - 1;
  } else if (direction === 'next' && currentIndex < contentVersions.value.length - 1) {
    newIndex = currentIndex + 1;
  } else {
    return;
  }

  emit('switch', props.message, contentVersions.value[newIndex]);
};



const handleImageClick = (index: number) => {
  currentPreViewIndex.value = index;
  showImageViewer.value = true;
};

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  console.log('[MessageItem] Component unmounted, cleanup completed');
});

const handleClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (target.closest('.copy-code-button')) {
    const button = target.closest('.copy-code-button') as HTMLElement;
    const codeBlock = button.closest('.custom-code-block');
    const codeElement = codeBlock?.querySelector('code');

    if (codeElement) {
      navigator.clipboard.writeText(codeElement.textContent).then(() => {
        toast.success("代码已复制到剪贴板");
      }).catch(err => {
        console.error('复制失败:', err);
        toast.error("复制失败");
      });
    }
  }
};

const formatTokenNumber = (num: number | null): string => {
  if (!num && num !== 0) return '0';

  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  } else {
    return num.toString();
  }
};

defineExpose({
  el: rootRef
});
</script>

<style scoped>
@reference "tailwindcss";

/* 消息样式 - BEM Block */
.message-item {
  display: flex;
  gap: 15px;
  width: 100%;
  margin-top: 20px;
  margin-bottom: 25px;
  content-visibility: auto;
  contain-intrinsic-size: auto 200px;
}

.message-item:last-child {
 min-height: 260px;
}

/* 消息卡片 - BEM Element */
.message-item__card {
  font-size: var(--size-text-base);
  letter-spacing: 1px;
  transition: all 0.3s ease;
  max-width: 100%;
}

/* 用户消息气泡特定样式 - BEM Modifier */
.message-item--user .message-item__card {
  background-color: var(--color-bubble-user-bg);
  color: var(--color-bubble-user-text);
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid var(--color-bubble-user-border);
  margin-left: auto;
}

/* AI消息气泡特定样式 - BEM Modifier */
.message-item--assistant .message-item__card {
  background: var(--color-bubble-assitant-bg);
  color: var(--color-bubble-assitant-text);
  border: 1px solid var(--assistant-bubble-border-color);
  margin-right: auto;
  width: 100%;
  padding: 0;
  box-shadow: none;
  border: none;
}

/* 修复用户消息对齐问题 - BEM Modifier */
.message-item.message-item--user {
  flex-direction: row-reverse;
}

.message-item.message-item--assistant {
  justify-content: flex-start;
}

.message-item.message-item--user .message-item__wrapper {
  align-items: flex-start;
}

.message-item.message-item--assistant .message-item__wrapper {
  align-items: flex-start;
  width: 100%;
}

/* 消息文本格式化 - BEM Element */
.message-item__text {
  line-height: 1.8;
  color: inherit;
  max-width: 100%;
  vertical-align: middle;
  font-size: var(--size-text-base);

}

.message-item.message-item--user .message-item__text {
  margin: 0;
}

.message-item.message-item--assistant .message-item__text {
  margin-bottom: 8px;
  margin-top: 8px;
}

/* 加载动画 */
.assistant-loading {
  font-size: var(--size-text-sm);
  margin-top: 8px;
}

/* Token 消耗显示样式 - 简约风格 */
.token-usage-section {
  padding: 4px 0;
  animation: fadeIn 0.3s ease;
}

.dark .token-usage-section {
  opacity: 0.8;
  /* 暗色模式下稍微降低透明度 */
}

.token-item {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  white-space: nowrap;
}

.token-item strong {
  font-weight: 600;
  color: inherit;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
<style>
@import "@/assets/markdown.css";
/* 全局样式：确保 v-html 中的代码高亮生效 */
@import 'highlight.js/styles/foundation.css';
</style>