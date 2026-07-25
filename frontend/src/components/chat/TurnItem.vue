<template>
  <div class="turn-wrapper" :class="{ 'turn-wrapper--last': isLast }" :data-message-id="turn.user?.id">
    <!-- ============================================ -->
    <!-- User 部分 -->
    <!-- ============================================ -->
    <div v-if="turn.user" class="user-section">
      <div class="message-item__wrapper">
        <div class="message-item__card">
          <!-- 用户文本 -->
          <div class="message-item__text break-all whitespace-pre-wrap">
            <template v-if="isSystemMessage">
              <div class="system-message-header">
                <el-icon size="14" class="system-message-icon">
                  <Alert16Regular />
                </el-icon>
                <span class="system-message-label">{{ systemMessageLabel }}</span>
              </div>
              <div class="system-message-divider" />
              <div class="system-message-body">
                <span v-html="userContent"></span>
              </div>
            </template>
            <span v-else v-html="renderSkillBadges(userContent)"></span>
          </div>
        </div>
        <!-- 知识库 -->
        <div class="knowledge-base flex flex-wrap gap-2 mt-3 ml-auto"
          v-if="turn.user.contents?.[0]?.metadata?.referencedKbs?.length > 0">
          <div v-for="kb in turn.user.contents[0].metadata.referencedKbs" :key="kb.id">
            <div
              class="knowledge-base-item rounded-md px-2 py-1 bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs flex items-center gap-1">
              <MenuBookOutlined class="w-4 h-4" />
              {{ kb.name }}
            </div>
          </div>
        </div>
        <!-- 文件列表 -->
        <div class="file-list flex flex-wrap gap-2 mt-3 ml-auto" v-if="turn.user.files?.length > 0">
          <FileItem v-for="file, index in turn.user.files" :key="file.id" :name="file.displayName" :type="file.fileType"
            :ext="file.fileExtension" :size="file.fileSize" :preview-url="file.previewUrl"
            :clickable="file.fileType === 'image'" @click="handleImageClick(Number(index))"></FileItem>
        </div>
        <!-- 用户操作按钮 -->
        <MessageActions v-if="true" :is-assistant="false" :is-last="false" :allow-generate="allowGenerate"
          :content-versions="[]" :current-version-index="0" :time-full="userTime.full"
          :time-friendly="userTime.firendly" @copy="emit('copy', turn.user)" @generate="emit('generate', turn.user)"
          @edit="emit('edit', turn.user)" @delete="emit('delete', turn.user)" />
      </div>
    </div>

    <!-- ============================================ -->
    <!-- Assistant 部分（有回复时） -->
    <!-- ============================================ -->
    <template v-if="activeAssistant">
      <div class="assistant-section">
        <div class="text-xs text-gray-400 mb-3">
          <div class="flex items-center">
            <div class="mr-5 flex items-center">
              <Avatar class="w-6 h-6 mr-2.5 relative top-0" :src="characterAvatar || modelAvatarPath" :round="false"
                type="assistant" :name="displayName"></Avatar>
              <span class="text-[1.3em] text-gray-700 dark:text-gray-300 font-medium leading-tight mr-2">{{
                displayName }}</span>
              <span v-if="currentModelName && currentModelName !== 'unknown'" class="text-[1em] text-gray-400 mt-0.5">{{
                currentModelName }}</span>
            </div>
          </div>
        </div>
        <div class="message-item__card">
          <!-- 展示分组：content / think / tool -->
          <template v-for="(group, groupIndex) in displayGroups" :key="group.id">
            <template v-if="group.type === 'content'">
              <template v-for="item in group.items" :key="item.id">
                <MarkdownContent class="message-item__text markdown-text" @click="handleClick"
                  :content="item.content || ''" />
              </template>
            </template>
            <div v-else class="process-group">
              <div
                v-if="group.isCollapsible && !(streamingState.isStreaming && groupIndex === displayGroups.length - 1)"
                class="process-group__header" @click="toggleGroup(group.id)">
                <span class="process-group__title">
                  调用了 {{ countToolCalls(group.items) }} 个工具
                </span>
                <el-icon size="14" class="process-group__arrow" :class="{ 'is-expanded': isGroupExpanded(group.id) }">
                  <ArrowRightTwotone />
                </el-icon>
              </div>
              <div
                v-show="!group.isCollapsible || isGroupExpanded(group.id) || (streamingState.isStreaming && groupIndex === displayGroups.length - 1)"
                class="process-group__body py-1 space-y-1">
                <template v-for="item in group.items" :key="item.id">
                  <MessageThinkingSection v-if="item.type === 'think'" :reasoning-content="item.reasoningContent || ''"
                    :is-thinking="item.source.state?.isThinking || false"
                    :is-streaming="item.source.state?.isStreaming || false"
                    :thinking-duration-ms="item.source.thinkingDurationMs ?? item.source.metadata?.thinkingDurationMs"
                    :metadata="item.source.metadata" />
                  <MessageToolCalls v-if="item.type === 'tool'" :tool-calls="item.toolCalls || []"
                    :tool-responses="item.toolResponses" :content-id="item.source.id"
                    :is-streaming="streamingState.isStreaming" />
                </template>
              </div>
            </div>
          </template>

          <!-- 错误提示 -->
          <el-alert v-if="assistantMetadata?.finishReason === 'error'" title="API 请求错误" type="error" :closable="false">
            {{ assistantMetadata.error }}
          </el-alert>

          <!-- 用户终止提示 -->
          <div v-if="assistantMetadata?.finishReason === 'user_cancel'"
            class="mt-2 text-sm text-gray-400 dark:text-gray-500">
            已手动终止
          </div>

          <!-- 继续执行按钮 -->
          <div
            v-if="assistantMetadata && !streamingState.isStreaming && assistantMetadata.finishReason === 'max_iterations_reached'"
            class="max-iterations-notice mt-3">
            <el-alert type="warning" :closable="false">
              <template #title>
                <span>已达到最大工具调用轮次限制</span>
              </template>
              <div v-if="isLast" class="flex items-center gap-3 mt-2">
                <el-button type="primary" size="small" @click="emit('continue', activeAssistant)">
                  继续执行
                </el-button>
              </div>
            </el-alert>
          </div>

          <!-- Token 消耗 -->
          <div v-if="tokenUsage && !streamingState.isStreaming" class="token-usage-section mt-2 flex">
            <div class="flex items-center gap-3 text-xs text-gray-400">
              <el-icon size="13" class="text-gray-400">
                <InsightsTwotone />
              </el-icon>
              <span class="text-gray-500">Tokens:</span>
              <span class="token-item">
                <span class="text-gray-400 dark:text-gray-300 text-xs">Prompt</span>&nbsp;<span
                  class="text-gray-500 dark:text-gray-300">{{ formatTokenNumber(tokenUsage.promptTokens) }}</span>
              </span>
              <span class="token-item">
                <span class="text-gray-400 dark:text-gray-300">Completion</span>&nbsp;<span
                  class="text-gray-500 dark:text-gray-300">{{ formatTokenNumber(tokenUsage.completionTokens) }}</span>
              </span>
              <span class="token-item">
                <span class="text-gray-400 dark:text-gray-300">Total</span>&nbsp;<span
                  class="text-gray-500 dark:text-gray-300">{{
                    formatTokenNumber(tokenUsage.totalTokens) }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 操作按钮（含版本切换） -->
        <MessageActions v-if="!streamingState.isStreaming" :is-assistant="true" :is-last="isLast"
          :allow-generate="false" :content-versions="siblingVersions" :current-version-index="currentVersionIndex"
          :time-full="assistantTime.full" :time-friendly="assistantTime.firendly" @copy="emit('copy', activeAssistant)"
          @regenerate="emit('regenerate', activeAssistant)" @switch-version="switchContent"
          @edit="emit('edit', activeAssistant)" @delete="emit('delete', activeAssistant)" />
      </div>
    </template>

    <!-- 图片预览 -->
    <el-image-viewer v-if="showImageViewer" v-model:visible="showImageViewer" :url-list="previewList"
      :initial-index="currentPreViewIndex" @close="showImageViewer = false" :teleported="true" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElAlert, ElIcon, ElImageViewer, ElButton } from "element-plus";
import { InsightsTwotone, MenuBookOutlined, ArrowRightTwotone } from "@vicons/material";
import { Alert16Regular } from "@vicons/fluent";
import { FileItem, Avatar } from "../ui";
import { formatTime } from '../../utils';
import { getCurrentTurns, groupContentsForDisplay, countToolCalls, type DisplayGroup } from '@/utils/messageUtils';
import { getModelDisplayName, getModelAvatarPath } from '@/utils/modelUtils';
import { usePopup } from "../../composables/usePopup";
import MessageThinkingSection from './message-item/MessageThinkingSection.vue';
import MessageToolCalls from './message-item/MessageToolCalls.vue';
import MessageActions from './message-item/MessageActions.vue';

const { toast } = usePopup();

const props = defineProps<{
  turn: { user: any; assistants: any[] };
  isLast: boolean;
  allowGenerate: boolean;
  characterName?: string;
  characterAvatar?: string;
  avatar?: string;
}>();

const emit = defineEmits<{
  switch: [message: any, versionId: string]
  delete: [message: any]
  edit: [message: any]
  copy: [message: any]
  generate: [message: any]
  regenerate: [message: any]
  continue: [message: any]
}>();

// ============================================
// 内部状态
// ============================================
const showImageViewer = ref(false);
const currentPreViewIndex = ref(0);
const expandedGroups = ref<Set<string>>(new Set());

const toggleGroup = (groupId: string) => {
  const set = expandedGroups.value;
  if (set.has(groupId)) set.delete(groupId);
  else set.add(groupId);
};

const isGroupExpanded = (groupId: string): boolean => {
  return expandedGroups.value.has(groupId);
};

// ============================================
// 版本管理
// ============================================
const siblingVersions = computed(() =>
  props.turn.assistants.map((a: any) => a.id)
);

const activeAssistant = computed(() => {
  const user = props.turn.user;
  const activeId = user?.currentVersionId;
  if (activeId) return props.turn.assistants.find((a: any) => a.id === activeId);
  return props.turn.assistants[props.turn.assistants.length - 1];
});

const currentVersionIndex = computed(() => {
  if (!activeAssistant.value) return 0;
  return siblingVersions.value.indexOf(activeAssistant.value.id);
});

const switchContent = (direction: 'prev' | 'next') => {
  const currentIndex = currentVersionIndex.value;
  if (currentIndex === -1) return;
  let newIndex: number;
  if (direction === 'prev' && currentIndex > 0) {
    newIndex = currentIndex - 1;
  } else if (direction === 'next' && currentIndex < siblingVersions.value.length - 1) {
    newIndex = currentIndex + 1;
  } else {
    return;
  }
  const targetId = siblingVersions.value[newIndex];
  const targetMsg = props.turn.assistants.find((a: any) => a.id === targetId);
  if (targetMsg) {
    emit('switch', activeAssistant.value, targetId);
  }
};

// ============================================
// 展示计算
// ============================================
const turnsCache = computed(() => {
  if (!activeAssistant.value) return [];
  return getCurrentTurns(activeAssistant.value as any);
});

const displayGroups = computed<DisplayGroup[]>(() => {
  return groupContentsForDisplay(turnsCache.value);
});

// ============================================
// 用户部分
// ============================================
const userContent = computed(() => {
  const content = props.turn.user?.contents?.[0];
  return content?.content || '';
});

const userTime = computed(() => {
  const content = props.turn.user?.contents?.[0];
  return {
    firendly: formatTime(content?.createdAt || '', 'friendly'),
    full: formatTime(content?.createdAt || '', 'full'),
  };
});

const isSystemMessage = computed(() => {
  const meta = props.turn.user?.metadata;
  const type = meta?.type;
  return type && type !== 'client';
});

const systemMessageLabel = computed(() => {
  const meta = props.turn.user?.metadata;
  const type = meta?.type || '';
  const name = meta?.subAgentName || '';
  switch (type) {
    case 'scheduler': return '来自定时任务的系统消息';
    case 'sub_agent': return '来自子代理的系统消息';
    default: return '系统消息';
  }
});

const renderSkillBadges = (text: string): string => {
  if (!text) return text;
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /\[([\/@])([a-zA-Z][\w\-\/]*):([\w-]+)(?:\s+label="([^"]*)")?\s*\]/g,
    (_, prefix, provider, name, label) => {
      const displayText = label || `${prefix}${name}`;
      return `<span data-type="command" data-provider-id="${provider}" data-name="${name}" data-label="${label || ''}" data-trigger="${prefix}" class="command-badge" style="color: var(--el-color-primary);">${displayText}</span>`;
    }
  );
};

// ============================================
// Assistant 部分
// ============================================
const assistantMetadata = computed(() => {
  const cache = turnsCache.value;
  if (cache.length === 0) return null;
  return cache[cache.length - 1]?.metadata || null;
});

const streamingState = computed(() => ({
  isStreaming: activeAssistant.value?.state?.isStreaming ?? false,
  isThinking: activeAssistant.value?.state?.isThinking ?? false,
  isPlaceholder: false,
}));

const currentModelName = computed(() => {
  const modelName = assistantMetadata.value?.modelName;
  return modelName ? getModelDisplayName(modelName) : "unknown";
});

const displayName = computed(() => {
  return props.characterName || currentModelName.value;
});

const modelAvatarPath = computed(() => {
  const modelName = assistantMetadata.value?.modelName;
  if (!modelName) return undefined;
  const parts = modelName.split("/");
  const providerName = parts.length > 1 ? parts[0] : undefined;
  return getModelAvatarPath(modelName, providerName) || undefined;
});

const assistantTime = computed(() => {
  const cache = turnsCache.value;
  if (cache.length === 0) {
    return { firendly: '', full: '' };
  }
  return {
    firendly: formatTime(cache[0]?.createdAt || '', 'friendly'),
    full: formatTime(cache[0]?.createdAt || '', 'full'),
  };
});

const tokenUsage = computed(() => {
  if (!turnsCache.value || turnsCache.value.length === 0) return null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  for (const turn of turnsCache.value) {
    const usage = turn?.metadata?.usage;
    if (usage) {
      totalPromptTokens += usage.promptTokens || 0;
      totalCompletionTokens += usage.completionTokens || 0;
      totalTokens += usage.totalTokens || 0;
    }
  }
  if (totalTokens === 0) return null;
  return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
});

const formatTokenNumber = (num: number | null): string => {
  if (!num && num !== 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
};

// ============================================
// 图片预览
// ============================================
const previewList = computed(() => {
  const files = props.turn.user?.files || [];
  return files.map((f: any) => f.url || f.previewUrl);
});

const handleImageClick = (index: number) => {
  currentPreViewIndex.value = index;
  showImageViewer.value = true;
};

// 代码复制
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
</script>

<style scoped>
.turn-wrapper {
  width: 100%;
  margin-top: 20px;
  margin-bottom: 25px;
  contain: layout style;
}


.turn-wrapper:last-child {
  min-height: 260px;
}

/* 消息卡片 */
.message-item__card {
  font-size: var(--size-text-base);
  max-width: 100%;
}

/* 用户消息气泡 */
.user-section {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.user-section .message-item__card {
  background-color: var(--color-bubble-user-bg);
  color: var(--color-bubble-user-text);
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid var(--color-bubble-user-border);
}

.user-section .message-item__wrapper {
  align-items: flex-end;
  max-width: 80%;
}

/* 助手消息气泡 */
.assistant-section {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.assistant-section .message-item__card {
  background: var(--color-bubble-assitant-bg);
  color: var(--color-bubble-assitant-text);
  border: 1px solid var(--assistant-bubble-border-color);
  margin-right: auto;
  width: 100%;
  padding: 0;
  box-shadow: none;
  border: none;
}

.assistant-section .message-item__card strong {
  color: var(--color-bubble-assitant-text-strong);
}

.assistant-section .message-item__wrapper {
  align-items: flex-start;
  width: 100%;
}

/* 消息文本 */
.message-item__text {
  line-height: 1.8;
  color: inherit;
  max-width: 100%;
  vertical-align: middle;
  font-size: var(--size-text-base);
}

.user-section .message-item__text {
  margin: 0;
}

.assistant-section .message-item__text {
  margin-bottom: 8px;
  margin-top: 8px;
}

.message-item__wrapper {
  padding: 8px 0;
}

/* 系统消息 */
.system-message-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.system-message-icon {
  color: var(--el-color-warning);
}

.system-message-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.system-message-divider {
  height: 1px;
  background-color: var(--el-border-color-lighter);
  margin: 8px 0;
}

.system-message-body {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

/* 中间处理过程分组 */
.process-group {
  margin: 4px 0;
}

.process-group__header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  user-select: none;
}

:deep(.process-group__body .process-section:last-child .process-timeline) {
  display: none;
}

.process-group__header:hover {
  color: var(--el-text-color-primary);
}

.process-group__arrow {
  transition: transform 0.2s ease;
  color: var(--el-text-color-placeholder);
}

.process-group__arrow.is-expanded {
  transform: rotate(90deg);
}

.process-group__title {
  line-height: 1.4;
}

.process-group__body {
  overflow: hidden;
}

/* 知识库 */
.knowledge-base-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Token 消耗 */
.token-usage-section {
  padding: 4px 0;
  animation: fadeIn 0.3s ease;
}

.dark .token-usage-section {
  opacity: 0.8;
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

.max-iterations-notice {
  margin-top: 12px;
}
</style>
<style>
@import "@/assets/markdown.css";
@import 'highlight.js/styles/foundation.css';
</style>