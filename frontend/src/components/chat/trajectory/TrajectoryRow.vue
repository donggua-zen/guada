<template>
  <!-- 单行渲染（plain / virtual 两种台账模式共用）：分组头 / Request 边界 / 消息行 -->
  <div
    v-if="row.kind === 'turn-header'"
    class="sticky top-0 z-10 px-2 py-1 bg-(--gd-color-sidebar-bg-active)/90 backdrop-blur border-y border-(--gd-color-border) text-(11px) font-medium text-(--gd-color-text-gray)"
  >
    {{ t('trajectory.turnLabel', { n: row.label }) }}
  </div>
  <div
    v-else-if="row.kind === 'group-header'"
    class="sticky top-0 z-10 px-2 py-1 bg-(--gd-color-sidebar-bg-active)/90 backdrop-blur border-y border-(--gd-color-border) text-(11px) font-medium text-(--gd-color-text-gray)"
  >
    {{ t('trajectory.auxLabel') }}
  </div>

  <template v-else-if="row.kind === 'request'">
    <button
      type="button"
      class="w-full text-left px-2 py-1.5 flex items-center gap-1.5 border-b border-(--gd-color-border)/60 hover:bg-(--gd-color-sidebar-bg-hover) transition-colors"
      :class="selected ? 'bg-(--gd-color-sidebar-bg-active)' : ''"
      :data-trajectory-source-kind="row.step.source"
      @click="$emit('select', selected ? null : row.step.requestId)"
    >
      <span
        class="shrink-0 inline-flex items-center px-1.5 rounded font-mono text-(10px)"
        :class="statusBadgeClass(row.step.status)"
      >
        R{{ row.number }}
      </span>
      <span class="truncate text-(--gd-color-text)">{{ sourceLabel(row.step.source) }}</span>
      <span class="ml-auto shrink-0 tabular-nums text-(10px) text-(--gd-color-text-gray)">
        {{ tokensLabel(row.step) }}
      </span>
      <span class="shrink-0 tabular-nums text-(10px) text-(--gd-color-text-gray)">
        {{ durationLabel(row.step) }}
      </span>
    </button>

    <!-- 选中：内嵌详情（对齐 dsh inspector REQUEST 页签的精简版） -->
    <TrajectoryStepDetail v-if="selected" :step="row.step" :output-nodes="outputNodes" />
  </template>

  <TrajectoryCell
    v-else-if="row.kind === 'message'"
    :row="row"
    :expanded="expanded"
    @toggle="$emit('toggle', row.key)"
    @open-sub-trajectory="$emit('open-sub-trajectory', $event)"
  />
</template>

<script setup lang="ts">
/**
 * 台账单行（分组头 / Request 边界 / 消息行三分支）：
 * TrajectoryLedger 的 plain 与 virtual 两种模式共用本组件。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrajectoryMessageNode, TrajectoryStepView } from '@/services/modules/trajectory.api';
import type { LedgerRow } from '@/composables/useTrajectory';
import TrajectoryCell from './TrajectoryCell.vue';
import TrajectoryStepDetail from './TrajectoryStepDetail.vue';
import { formatTrajectoryDuration, formatTrajectoryTokens } from './format';

const props = defineProps<{
  row: LedgerRow;
  /** 该行是否展开（消息行用） */
  expanded: boolean;
  /** 当前选中的 request id（request 行用） */
  selectedRequestId: string | null;
  /** 该行宿主 step 的 OUT 区消息节点（request 行传给详情做 timing 计算） */
  outputNodes?: TrajectoryMessageNode[];
}>();

const emit = defineEmits<{
  toggle: [key: string];
  select: [requestId: string | null];
  'open-sub-trajectory': [subSessionId: string];
}>();

const { t } = useI18n();

const selected = computed(
  () => props.row.kind === 'request' && props.selectedRequestId === props.row.step.requestId,
);

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'error':
      return 'bg-(--gd-trajectory-error)/15 text-(--gd-trajectory-error)';
    case 'unclosed':
      return 'bg-amber-500/15 text-amber-500';
    default:
      return 'bg-(--gd-trajectory-tool-result)/15 text-(--gd-trajectory-tool-result)';
  }
}

/** 来源标签：i18n 词表优先，动态来源（plugin:<id> 等）回退原词 */
function sourceLabel(source: string): string {
  const key = `trajectory.source.${source}`;
  const translated = t(key);
  return translated === key ? source : translated;
}

function tokensLabel(step: TrajectoryStepView): string | null {
  if (!step.usage) return null;
  return `${formatTrajectoryTokens(step.usage.promptTokens)}→${formatTrajectoryTokens(step.usage.completionTokens)}`;
}

function durationLabel(step: TrajectoryStepView): string | null {
  return formatTrajectoryDuration(step.durationMs);
}
</script>
