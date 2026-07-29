<template>
  <div class="process-section thinking-section">
    <!-- 标题行 -->
    <div
      class="thinking-section__header flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200"
      @click.stop="handleToggle">
      <el-icon size="15" class="shrink-0">
        <BrainCircuit20Regular />
      </el-icon>
      <span class="text-gray-600 dark:text-gray-400 ml-1.5">{{ isThinking ? '思考中...' : '已深度思考' }}</span>
      <span v-if="thinkingDuration" class="text-xs text-gray-400 ml-2">
        {{ formattedDuration }}
      </span>
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
import { computed, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import { BrainCircuit20Regular } from '@vicons/fluent';
import MarkdownContent from '../../ui/MarkdownContent.vue';
import { formatDuration } from '../../../utils/messageUtils';

const props = defineProps<{
  reasoningContent: string;
  isThinking: boolean;
  thinkingDurationMs: number | null | undefined;
  metadata?: Record<string, any>;
}>();

const emit = defineEmits<{
  click: [];
}>();

const isExpanded = ref(props.isThinking);

const handleToggle = () => {
  isExpanded.value = !isExpanded.value;
};

const thinkingDuration = computed(() => {
  if (props.isThinking) {
    return props.thinkingDurationMs;
  }
  return props.metadata?.thinkingDurationMs || props.thinkingDurationMs;
});

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
