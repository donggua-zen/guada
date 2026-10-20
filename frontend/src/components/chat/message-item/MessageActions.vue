<template>
  <div
    class="message-actions flex flex-nowrap gap-0 text-sm w-full mt-3 text-gray-500 items-center min-w-0 whitespace-nowrap"
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

    <!-- 用量：只常显总量，明细走 tooltip（窄屏优先截断这一段） -->
    <GdTooltip v-if="isAssistant && tokenUsage" class="min-w-0" :content="tokenDetail" placement="top">
      <div class="ml-2 flex min-w-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <el-icon :size="14" class="shrink-0">
          <InsightsTwotone />
        </el-icon>
        <span class="truncate">{{ tokenSummary }}</span>
      </div>
    </GdTooltip>

    <template v-if="isAssistant">
      <div v-if="durationText" class="ml-2 flex shrink-0 items-center justify-center text-gray-500">
        <AccessTimeTwotone class="w-3 h-3 mr-1" />
        <span class="text-xs">{{ durationText }}</span>
      </div>
      <span class="ml-2 shrink-0 text-xs text-gray-500" :title="props.timeFull">{{ props.timeFriendly }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElIcon } from 'element-plus';
import { useI18n } from 'vue-i18n';
import DropdownMenu from '../../ui/DropdownMenu.vue';
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue';
import GdTooltip from '../../ui/GdTooltip.vue';
import { formatCompactTokens } from '@/utils/usageFormat';

const { t } = useI18n();
import {
  Copy16Regular,
  ArrowClockwise16Regular,
  MoreHorizontal16Regular,
  Delete16Regular,
  Edit16Regular,
  BranchFork16Regular,
} from '@vicons/fluent';
import { ArrowDownwardTwotone, AccessTimeTwotone, InsightsTwotone } from '@vicons/material';
import { LoadingOutlined } from '@vicons/antd';

interface TokenUsageLike {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const props = defineProps<{
  isAssistant: boolean;
  isLast: boolean;
  allowGenerate: boolean;
  timeFull: string;
  timeFriendly: string;
  /** 工作时长（ms）；与用量、时间同处一行，窄屏时让位给用量文案 */
  durationMs?: number | null;
  /** Token 用量：只常显总量，明细进 tooltip */
  tokenUsage?: TokenUsageLike | null;
  /** 本回合分支进行中：图标转圈且不可点 */
  branching?: boolean;
  /** 有任意分支在飞行中：禁用（防并发 fork） */
  branchDisabled?: boolean;
}>();

// 12.04s → 12s、12.35s → 12.4s（与用量统计页的 trimZero 口径一致）
const trimSecond = (value: number): string => value.toFixed(1).replace(/\.0$/, '');

const durationText = computed(() => {
  const ms = props.durationMs;
  if (ms == null || !Number.isFinite(ms)) return null;
  // 先按 0.1s 舍入，避免 59.96s 显示成「60 秒」却走秒分支
  const rounded = Math.max(0, Math.round(ms / 100) / 10);
  if (rounded < 60) {
    return t('chat.messageActions.durationSeconds', { seconds: trimSecond(rounded) });
  }
  const minutes = Math.floor(rounded / 60);
  const seconds = Math.round(rounded % 60);
  return t('chat.messageActions.durationMinutes', { minutes, seconds });
});

const tokenSummary = computed(() => {
  if (!props.tokenUsage) return '';
  return t('chat.messageActions.tokenUsage', {
    count: formatCompactTokens(props.tokenUsage.totalTokens),
  });
});

const tokenDetail = computed(() => {
  const usage = props.tokenUsage;
  if (!usage) return '';
  return t('chat.messageActions.tokenUsageDetail', {
    prompt: formatCompactTokens(usage.promptTokens),
    completion: formatCompactTokens(usage.completionTokens),
    total: formatCompactTokens(usage.totalTokens),
  });
});

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
  @apply shrink-0 cursor-pointer flex items-center gap-1 py-1 px-1 rounded-md mr-1 hover:bg-(--gd-color-surface-hover) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-transform duration-100;
}
</style>
