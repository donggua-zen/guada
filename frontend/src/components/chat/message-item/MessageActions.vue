<template>
  <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-500 items-center"
    :class="[isAssistant ? 'justify-start -translate-x-1' : 'justify-end translate-x-1']">

    <LTooltip content="复制" placement="top">
      <div class="message-action-button" @click="$emit('copy')">
        <el-icon :size="16">
          <Copy16Regular />
        </el-icon>
      </div>
    </LTooltip>

    <template v-if="!isAssistant && allowGenerate">
      <LTooltip content="重新生成" placement="top">
        <div class="message-action-button" @click="$emit('generate')">
          <el-icon :size="16">
            <ArrowDownwardTwotone />
          </el-icon>
        </div>
      </LTooltip>
    </template>

    <template v-if="isAssistant && isLast">
      <LTooltip content="重新生成" placement="top">
        <div class="message-action-button" @click="$emit('regenerate')">
          <el-icon :size="16">
            <ArrowClockwise16Regular />
          </el-icon>
        </div>
      </LTooltip>
    </template>

    <template v-if="isLast && contentVersions.length > 1">
      <LTooltip content="上一个版本" placement="top">
        <div class="message-action-button" @click="$emit('switchVersion', 'prev')" :disabled="!hasPrev">
          <el-icon :size="16">
            <ChevronLeft24Filled />
          </el-icon>
        </div>
      </LTooltip>
      <div class="text-gray-700 transition-colors duration-200 flex items-center py-1">
        {{ currentVersionIndex + 1 }} / {{ contentVersions.length }}
      </div>
      <LTooltip content="下一个版本" placement="top">
        <div class="message-action-button" @click="$emit('switchVersion', 'next')" :disabled="!hasNext">
          <el-icon :size="16">
            <ChevronRight24Filled />
          </el-icon>
        </div>
      </LTooltip>
    </template>

    <LTooltip content="更多" placement="top">
      <DropdownMenu @command="handleCommand">
        <div class="message-action-button">
          <el-icon :size="16" class="pointer-events-none">
            <MoreHorizontal16Regular />
          </el-icon>
        </div>
      <template #dropdown>
        <DropdownMenuItem command="edit">
          <el-icon class="mr-2">
            <Edit16Regular />
          </el-icon>
          编辑内容
        </DropdownMenuItem>
        <DropdownMenuItem command="delete">
          <el-icon class="mr-2">
            <Delete16Regular />
          </el-icon>
          删除消息
        </DropdownMenuItem>
      </template>
    </DropdownMenu>
    </LTooltip>
    <template v-if="isAssistant">
      <div class="flex text-gray-500 shrink-0 items-center justify-center ml-2">
        <AccessTimeTwotone class="w-3 h-3 mr-1" />
        <span class="text-xs" :title="props.timeFull">{{ props.timeFriendly }}</span>
        <template v-if="props.durationText">
          <span class="text-gray-300 dark:text-gray-600 mx-1">·</span>
          <span class="text-xs">{{ props.durationText }}</span>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElIcon } from 'element-plus';
import DropdownMenu from '../../ui/DropdownMenu.vue';
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue';
import LTooltip from '../../ui/LTooltip.vue';
import {
  Copy16Regular,
  ArrowClockwise16Regular,
  MoreHorizontal16Regular,
  ChevronLeft24Filled,
  ChevronRight24Filled,
  Delete16Regular,
  Edit16Regular,
} from '@vicons/fluent';
import { ArrowDownwardTwotone, AccessTimeTwotone } from '@vicons/material';

const props = defineProps<{
  isAssistant: boolean;
  isLast: boolean;
  allowGenerate: boolean;
  contentVersions: string[];
  currentVersionIndex: number;
  timeFull: string;
  timeFriendly: string;
  durationText?: string | null;
}>();

const emit = defineEmits<{
  (e: 'copy'): void;
  (e: 'generate'): void;
  (e: 'regenerate'): void;
  (e: 'switchVersion', direction: 'prev' | 'next'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
}>();

const hasPrev = computed(() => props.currentVersionIndex > 0);

const hasNext = computed(() => props.currentVersionIndex < props.contentVersions.length - 1);

const handleCommand = (command: string) => {
  if (command === 'edit') {
    emit('edit');
  } else if (command === 'delete') {
    emit('delete');
  }
};
</script>

<style scoped>
@reference "tailwindcss";

.message-action-button {
  @apply cursor-pointer flex items-center gap-1 py-1 px-1 rounded-md mr-1 hover:bg-(--color-surface-hover) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}
</style>
