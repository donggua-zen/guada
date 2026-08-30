<template>
  <div class="process-section thinking-section">
    <!-- 标题行 -->
    <div
      class="group thinking-section__header flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200"
      @click.stop="handleToggle">
      <el-icon size="15" class="shrink-0">
        <BrainCircuit20Regular />
      </el-icon>
      <span class="text-gray-600 dark:text-gray-400 ml-1.5">{{ isThinking ? t('chat.turn.thinkingActive') : t('chat.turn.thinkingDone') }}</span>
      <span v-if="thinkingDuration" class="text-xs text-gray-400 ml-2">
        {{ formattedDuration }}
      </span>
      <!-- 展开箭头：闭合朝右、展开朝下；右对齐，hover 时显示，展开后持续显示 -->
      <el-icon class="shrink-0 ml-auto text-gray-400 transition-opacity duration-200"
        :class="isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" size="12"
        @click.stop="handleToggle">
        <ChevronDown12Regular :class="{ '-rotate-90': !isExpanded }" class="transition-transform duration-200" />
      </el-icon>
    </div>

    <!-- 内容区：折叠时显示最多3行 + 渐变遮罩，展开时全量显示 -->
    <div class="thinking-section__content-wrapper border-l ml-1.75 pl-4 text-sm border-gray-300 dark:border-gray-700">
      <div class="thinking-content" :class="{ 'is-collapsed': !isExpanded && !isThinking }">
        <MarkdownContent @click.stop="$emit('click')" class="flex-1 markdown-text text-gray-500 dark:text-gray-400"
          :content="reasoningContent" />
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, inject } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { BrainCircuit20Regular, ChevronDown12Regular } from '@vicons/fluent';
import MarkdownContent from '../../ui/MarkdownContent.vue';
import { formatDuration } from '../../../utils/messageUtils';
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

const isExpanded = ref(props.isThinking);

// 从 ChatPanel 注入锁定滚动方法，展开思考内容时调用
const lockScrollAnchor = inject<() => void>('lockScrollAnchor', () => {});

const handleToggle = () => {
  if (!isExpanded.value) {
    lockScrollAnchor();
  }
  isExpanded.value = !isExpanded.value;
};

// 展示层秒表：进行中从锚点跳动，结束后显示服务端 timing 派生的权威时长
const { elapsedMs: thinkingDuration } = useElapsedTicker(
  () => props.thinkingStartedAt,
  () => props.isThinking,
  () => props.thinkingDurationMs,
);

const formattedDuration = computed(() => {
  return formatDuration(thinkingDuration.value);
});

watch(() => props.isThinking, (isThinking: boolean) => {
  if (isThinking) {
    isExpanded.value = true;
  } else {
    isExpanded.value = false;
  }
}, { immediate: true });
</script>

<style scoped>
.thinking-section {
  border-radius: 8px;
  overflow: hidden;
  animation: fadeIn 0.3s ease;
}

.thinking-section__header {
  user-select: none;
}



.thinking-content {
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.thinking-content.is-collapsed {
  max-height: 4.5em;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom,
      black 0,
      black 2.5em,
      transparent 4.5em);
  mask-image: linear-gradient(to bottom,
      black 0,
      black 2.5em,
      transparent 4.5em);
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
