<template>
  <div class="message-actions flex gap-0 text-sm w-full mt-3 text-gray-500 items-center"
    :class="[isAssistant ? 'justify-start -translate-x-1' : 'justify-end translate-x-1']">

    <GdTooltip :content="t('chat.messageActions.copy')" placement="top">
      <div class="message-action-button" @click="$emit('copy')">
        <el-icon :size="16">
          <Copy16Regular />
        </el-icon>
      </div>
    </GdTooltip>

    <template v-if="!isAssistant && allowGenerate">
      <GdTooltip :content="t('chat.messageActions.regenerate')" placement="top">
        <div class="message-action-button" @click="$emit('generate')">
          <el-icon :size="16">
            <ArrowDownwardTwotone />
          </el-icon>
        </div>
      </GdTooltip>
    </template>

    <template v-if="isAssistant && isLast">
      <GdTooltip :content="t('chat.messageActions.regenerate')" placement="top">
        <div class="message-action-button" @click="$emit('regenerate')">
          <el-icon :size="16">
            <ArrowClockwise16Regular />
          </el-icon>
        </div>
      </GdTooltip>
    </template>

    <template v-if="isAssistant">
      <GdTooltip
        :content="branching ? t('chat.messageActions.branching') : t('chat.messageActions.branchFromHere')"
        placement="top">
        <!-- 真 button 而非 div：让 .message-action-button 预置的 disabled: 工具类生效 -->
        <button type="button" class="message-action-button"
          :disabled="branching || branchDisabled" @click="handleBranch">
          <el-icon :size="16" :class="{ 'is-loading': branching }">
            <LoadingOutlined v-if="branching" />
            <BranchFork16Regular v-else />
          </el-icon>
        </button>
      </GdTooltip>
    </template>

    <GdTooltip :content="t('chat.messageActions.more')" placement="top">
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
          {{ t('chat.messageActions.editContent') }}
        </DropdownMenuItem>
        <DropdownMenuItem command="delete">
          <el-icon class="mr-2">
            <Delete16Regular />
          </el-icon>
          {{ t('chat.messageActions.deleteTurn') }}
        </DropdownMenuItem>
      </template>
    </DropdownMenu>
    </GdTooltip>
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
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import DropdownMenu from '../../ui/DropdownMenu.vue';
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue';
import GdTooltip from '../../ui/GdTooltip.vue';

const { t } = useI18n();
import {
  Copy16Regular,
  ArrowClockwise16Regular,
  MoreHorizontal16Regular,
  Delete16Regular,
  Edit16Regular,
  BranchFork16Regular,
} from '@vicons/fluent';
import { ArrowDownwardTwotone, AccessTimeTwotone } from '@vicons/material';
import { LoadingOutlined } from '@vicons/antd';

const props = defineProps<{
  isAssistant: boolean;
  isLast: boolean;
  allowGenerate: boolean;
  timeFull: string;
  timeFriendly: string;
  durationText?: string | null;
  /** 本回合分支进行中：图标转圈且不可点 */
  branching?: boolean;
  /** 有任意分支在飞行中：禁用（防并发 fork） */
  branchDisabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'copy'): void;
  (e: 'generate'): void;
  (e: 'regenerate'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
  (e: 'branch'): void;
}>();

const handleCommand = (command: string) => {
  if (command === 'edit') {
    emit('edit');
  } else if (command === 'delete') {
    emit('delete');
  }
};

// disabled 属性挡住鼠标，这里挡住键盘触发等边缘路径（双保险）
const handleBranch = () => {
  if (props.branching || props.branchDisabled) return;
  emit('branch');
};
</script>

<style scoped>
@reference "tailwindcss";

.message-action-button {
  @apply cursor-pointer flex items-center gap-1 py-1 px-1 rounded-md mr-1 hover:bg-(--gd-color-surface-hover) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}
</style>
