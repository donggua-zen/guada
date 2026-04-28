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

    <el-dropdown trigger="click" @command="handleMoreAction">
      <div class="message-action-button">
        <el-icon :size="16">
          <MoreVertical24Filled />
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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElIcon, ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';
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
  copy: [];
  generate: [];
  regenerate: [];
  switchVersion: [direction: 'prev' | 'next'];
  edit: [];
  delete: [];
}>();

const hasPrev = computed(() => props.currentVersionIndex > 0);

const hasNext = computed(() => props.currentVersionIndex < props.contentVersions.length - 1);

const handleMoreAction = (command: 'edit' | 'delete') => {
  emit(command);
};
</script>

<style scoped>
@reference "tailwindcss";

.message-action-button {
  @apply cursor-pointer flex items-center gap-1 py-1 px-1 rounded mr-1 hover:bg-(--color-surface) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}
</style>
