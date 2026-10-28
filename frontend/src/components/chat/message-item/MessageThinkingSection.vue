<template>
  <div class="process-section thinking-section">
    <!-- 标题行：与工具调用行同构的单行步骤（图标 + 动作文案 + 摘要 + 箭头） -->
    <div
      class="group thinking-section__header flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200 min-w-0"
      @click.stop="handleToggle">
      <el-icon size="16" class="shrink-0">
        <BrainCircuit20Regular />
      </el-icon>
      <div class="ml-1.5 min-w-0 flex-1 flex items-center text-gray-400 dark:text-gray-500 overflow-hidden">
        <span class="shrink-0 text-gray-700 dark:text-gray-300 font-medium"
          :class="{ 'shimmer-text': isThinking }">{{ isThinking ? t('chat.turn.thinkingActive') : t('chat.turn.thinkingDone') }}</span>
        <!-- 摘要：思考内容最后一行（思考中实时跟随，结束后保留） -->
        <span v-if="previewText" class="text-sm ml-2 truncate"
          :class="{ 'shimmer-text': isThinking }">{{ previewText }}</span>
        <span v-if="thinkingDuration" class="shrink-0 text-xs text-gray-400 ml-2">
          {{ formattedDuration }}
        </span>
      </div>
      <!-- 展开箭头：闭合朝右、展开朝下；hover 时显示，展开后持续显示 -->
      <el-icon class="shrink-0 ml-2 text-gray-400 transition-opacity duration-200"
        :class="isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" size="12">
        <ChevronDown12Regular :class="{ '-rotate-90': !isExpanded }" class="transition-transform duration-200" />
      </el-icon>
    </div>

    <!-- 内容区：仅展开时渲染；折叠态为纯单行步骤，与工具行完全一致 -->
    <div v-if="isExpanded" class="thinking-section__content-wrapper text-sm">
      <div class="thinking-content">
        <MarkdownContent @click.stop="$emit('click')" class="flex-1 markdown-text text-gray-500 dark:text-gray-400"
          :content="reasoningContent" />
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, inject } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { BrainCircuit20Regular, ChevronDown12Regular } from '@vicons/fluent';
import MarkdownContent from '../../ui/MarkdownContent.vue';
import { formatDuration, getThinkingPreview } from '../../../utils/messageUtils';
import { useElapsedTicker } from '../../../composables/useElapsedTicker';

const { t } = useI18n();

const props = defineProps<{
  reasoningContent: string;
  isThinking: boolean;
  thinkingDurationMs: number | null | undefined;
  /** 思考跳动锚点（epoch ms，流式期间展示层秒表用） */
  thinkingStartedAt?: number | null;
}>();

const emit = defineEmits<{
  click: [];
}>();

const isExpanded = ref(false);

// 从 ChatPanel 注入锁定滚动方法，展开思考内容时调用
const lockScrollAnchor = inject<() => void>('lockScrollAnchor', () => {});

const handleToggle = () => {
  if (!isExpanded.value) {
    lockScrollAnchor();
  }
  isExpanded.value = !isExpanded.value;
};

/** 摘要：思考内容最后一行（按行拆分取最后一行，从行首显示、结尾截断） */
const previewText = computed(() => getThinkingPreview(props.reasoningContent));

// 展示层秒表：进行中从锚点跳动，结束后显示服务端 timing 派生的权威时长
const { elapsedMs: thinkingDuration } = useElapsedTicker(
  () => props.thinkingStartedAt,
  () => props.isThinking,
  () => props.thinkingDurationMs,
);

const formattedDuration = computed(() => {
  return formatDuration(thinkingDuration.value);
});
</script>

<style scoped>
.thinking-section {
  border-radius: 8px;
  animation: fadeIn 0.3s ease;
}

.thinking-section__header {
  user-select: none;
}

/* 与工具展开卡片（tool-result-inline）完全一致的容器样式（微透明表面底色）；
   margin-left 22px = 图标 16px + 标题间距 6px，让详情块缩进与标题文字对齐、错开图标 */
.thinking-section__content-wrapper {
  margin-top: 4px;
  margin-left: 22px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: color-mix(in srgb, var(--gd-color-surface) 80%, transparent);
  /* 长思考不再撑满整屏：限高后框内自滚动。
     column-reverse 让滚动原点落在底部 = 纯 CSS 自动贴底（流式增高时新内容始终可见，
     用户上滚阅读不被拽回）；内容只占顶部时盒子按内容收缩，无副作用 */
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
}

/* 流式思考中的文字波纹（文案 + 摘要一起波纹，与分组标题 shimmer-text 同款） */
.shimmer-text {
  background: linear-gradient(90deg,
      var(--gd-shimmer-base, #a8aab3) 0%,
      var(--gd-shimmer-base, #a8aab3) 25%,
      var(--gd-shimmer-highlight, #ffffff) 50%,
      var(--gd-shimmer-base, #a8aab3) 75%,
      var(--gd-shimmer-base, #a8aab3) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer-slide 1.5s linear infinite;
}

@keyframes shimmer-slide {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -100% 0;
  }
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
