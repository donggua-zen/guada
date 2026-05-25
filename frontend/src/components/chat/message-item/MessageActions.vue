<template>
  <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-500 items-center"
    :class="[isAssistant ? 'justify-start' : 'justify-end']">

    <div class="message-action-button" @click="$emit('copy')">
      <el-icon :size="16">
        <Copy20Filled />
      </el-icon>
    </div>

    <template v-if="!isAssistant && allowGenerate">
      <div class="message-action-button" @click="$emit('generate')">
        <el-icon :size="16">
          <ArrowDownwardTwotone />
        </el-icon>
      </div>
    </template>

    <template v-if="isAssistant && isLast">
      <div class="message-action-button" @click="$emit('regenerate')">
        <el-icon :size="16">
          <ArrowCounterclockwise24Filled />
        </el-icon>
      </div>
    </template>

    <template v-if="isLast && contentVersions.length > 1">
      <div class="message-action-button" @click="$emit('switchVersion', 'prev')" :disabled="!hasPrev">
        <el-icon :size="16">
          <ChevronLeft24Filled />
        </el-icon>
      </div>
      <div class="text-gray-700 transition-colors duration-200 flex items-center py-1">
        {{ currentVersionIndex + 1 }} / {{ contentVersions.length }}
      </div>
      <div class="message-action-button" @click="$emit('switchVersion', 'next')" :disabled="!hasNext">
        <el-icon :size="16">
          <ChevronRight24Filled />
        </el-icon>
      </div>
    </template>

    <DropdownMenu @command="handleCommand">
      <div class="message-action-button">
        <el-icon :size="16" class="pointer-events-none">
          <MoreVertical24Filled />
        </el-icon>
      </div>
      <template #dropdown>
        <DropdownMenuItem command="edit">
          <el-icon class="mr-2">
            <EditTwotone />
          </el-icon>
          编辑内容
        </DropdownMenuItem>
        <DropdownMenuItem command="delete">
          <el-icon class="mr-2">
            <DeleteTwotone />
          </el-icon>
          删除消息
        </DropdownMenuItem>
      </template>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElIcon } from 'element-plus';
import DropdownMenu from '../../ui/DropdownMenu.vue';
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue';
import {
  Copy20Filled,
  ArrowCounterclockwise24Filled,
  MoreVertical24Filled,
  ChevronLeft24Filled,
  ChevronRight24Filled
} from '@vicons/fluent';
import { EditTwotone, DeleteTwotone, ArrowDownwardTwotone } from '@vicons/material';

const props = defineProps<{
  isAssistant: boolean;
  isLast: boolean;
  allowGenerate: boolean;
  contentVersions: string[];
  currentVersionIndex: number;
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
  @apply cursor-pointer flex items-center gap-1 py-1 px-1 rounded mr-1 hover:bg-(--color-surface) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}


</style>
