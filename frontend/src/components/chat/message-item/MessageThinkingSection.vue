<template>
  <div class="thinking-section mb-2" :class="{ 'thinking-section--expanded': isExpanded }">
    <div
      class="thinking-section__header h-7 inline-flex justify-center items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium my-1 transition-colors duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] rounded px-1"
      @click.stop="handleToggle">
      <div class="flex items-center">
        <el-icon size="15" class="">
          <Lightbulb24Regular class="text-yellow-500"/>
        </el-icon>
        <span class="text-gray-500 ml-2">{{ isThinking ? '思考中...' : '已深度思考' }}</span>
        <span v-if="thinkingDuration" class="text-xs text-gray-400 ml-2">
          <template v-if="isThinking">
            已思考 {{ formattedDuration }}
          </template>
          <template v-else>
            耗时 {{ formattedDuration }}
          </template>
        </span>
        <el-icon :class="['transition-transform duration-300 ml-2', isExpanded ? 'rotate-90' : 'rotate-0']" size="14">
          <ArrowRightTwotone />
        </el-icon>
      </div>
    </div>

    <div class="thinking-section__container" :class="{ 'thinking-section__container--expanded': isExpanded }">
      <div class="thinking-section__content-wrapper flex">
        <div class="pt-1 flex">
          <div class="w-5.5 min-h-0 flex justify-center mr-1.5">
            <div class="w-px bg-gray-200 dark:bg-gray-700"></div>
          </div>
          <MarkdownContent @click.stop="$emit('click')" class="flex-1 markdown-text text-gray-500 dark:text-gray-400"
            :content="reasoningContent" :debounced="isStreaming" @render-complete="$emit('renderComplete')" />
        </div>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import { ArrowRightTwotone } from '@vicons/material';
import { Lightbulb24Regular } from '@vicons/fluent';
import MarkdownContent from '../../ui/MarkdownContent.vue';
import { formatDuration } from '../../../utils/messageUtils';

const props = defineProps<{
  reasoningContent: string;
  isThinking: boolean;
  isStreaming: boolean;
  thinkingDurationMs: number | null | undefined;
  metadata?: Record<string, any>;
}>();

const emit = defineEmits<{
  click: [];
  renderComplete: [];
}>();

const isExpanded = ref(false);

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
  if(!isThinking){
    isExpanded.value = false;
  }
});
</script>

<style scoped>
@reference "tailwindcss";

.thinking-section {
  border-radius: 8px;
  overflow: hidden;
  animation: fadeIn 0.3s ease;
}

.thinking-section__header {
  user-select: none;
}

.thinking-section__container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.thinking-section__container--expanded {
  grid-template-rows: 1fr;
}

.thinking-section__content-wrapper {
  min-height: 0;
  opacity: 0;
  /* transform: translateY(-8px); */
  transition: opacity 0.25s ease, transform 0.25s ease;
  overflow: hidden;
  /* padding-bottom: 8px; */
}

.thinking-section__container--expanded .thinking-section__content-wrapper {
  opacity: 1;
  transform: translateY(0);
}
</style>
