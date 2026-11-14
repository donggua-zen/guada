<template>
  <!--
    单行渲染（plain / virtual 两种台账模式共用）：两列网格 44px 事件列 + 1fr 内容列。
    - turn-header：回合分界线 + 标签章
    - group-header：辅助调用组标题行
    - request：事件列圆点边界（状态色）+ 内容列 R 徽标
    - system / message：事件列 kind 徽章
  -->
  <!-- 回合分界 -->
  <div
    v-if="row.kind === 'turn-header'"
    class="cv-row relative border-t-2 border-(--gd-color-border)"
  >
    <span
      class="absolute left-0 top-0 z-1 inline-block rounded-br-[2px] px-[5px] pt-[1px] pb-[2px] font-mono text-[8px]/[10px] text-(--gd-color-text-gray) bg-(--gd-trajectory-neutral-bg)"
    >{{ t('trajectory.turnLabel', { n: row.label }) }}</span>
  </div>
  <!-- 辅助调用组标题 -->
  <div
    v-else-if="row.kind === 'group-header'"
    class="cv-row flex h-[36px] items-center px-[12px]"
  >
    <span class="text-xs text-(--gd-color-text)">{{ t('trajectory.auxLabel') }}</span>
  </div>

  <!-- Request 边界行 -->
  <template v-else-if="row.kind === 'request'">
    <div
      class="cv-row grid grid-cols-[44px_1fr] items-center h-[30px] border-b-[0.5px] border-(--gd-color-border)/60 hover:bg-(--gd-color-sidebar-bg-hover) transition-colors cursor-pointer"
      :class="selected ? 'bg-(--gd-color-sidebar-bg-active)' : ''"
      :data-trajectory-source-kind="row.step.source"
      @click="$emit('select', selected ? null : row.step.requestId)"
    >
      <div class="relative h-full">
        <span
          class="absolute top-1/2 left-1/2 -translate-1/2 w-[5px] h-[5px] rounded-full"
          :class="dotClass(row.step.status)"
          :style="{ boxShadow: '0 0 0 2px var(--gd-color-sidebar-bg)' }"
        ></span>
      </div>
      <div class="flex items-center gap-1.5 min-w-0 pr-[8px]">
        <span
          class="shrink-0 inline-flex items-center h-[19px] px-[5px] rounded-[4px] font-mono text-[10px] font-[650] tracking-[0.035em]"
          :class="statusChipClass(row.step.status)"
        >R{{ row.number }}</span>
        <span class="truncate text-(--gd-color-text)">{{ sourceLabel(row.step.source) }}</span>
        <span class="ml-auto shrink-0 tabular-nums text-[10px] text-(--gd-color-text-gray)">
          {{ tokensLabel(row.step) }}
        </span>
        <span class="shrink-0 tabular-nums text-[10px] text-(--gd-color-text-gray)">
          {{ durationLabel(row.step) }}
        </span>
      </div>
    </div>

    <!-- 选中：内嵌详情 -->
    <TrajectoryStepDetail v-if="selected" :step="row.step" :output-nodes="outputNodes" />
  </template>

  <!-- SYSTEM 快照行 -->
  <template v-else-if="row.kind === 'system'">
    <div
      class="cv-row grid grid-cols-[44px_1fr] items-center h-[30px] border-b-[0.5px] border-(--gd-color-border)/60 hover:bg-(--gd-color-sidebar-bg-hover) transition-colors cursor-pointer"
      :data-trajectory-source-kind="`system_${row.envelope.reason}`"
      @click="$emit('toggle', row.key)"
    >
      <div class="relative h-full">
        <span
          class="absolute top-1/2 left-1/2 -translate-1/2 inline-flex items-center justify-center h-[19px] px-[5px] whitespace-nowrap rounded-[4px] text-[10px] font-[650] leading-[16px] text-(--gd-color-text-gray) bg-(--gd-trajectory-neutral-bg)"
        >S{{ row.number }}</span>
      </div>
      <div class="flex items-center gap-1.5 min-w-0 pr-[8px]">
        <span class="truncate text-(--gd-color-text)">{{ systemTitle(row) }}</span>
        <span
          v-if="row.envelope.model"
          class="ml-auto shrink-0 truncate max-w-24 text-[10px] text-(--gd-color-text-gray)"
        >{{ row.envelope.model }}</span>
        <span class="shrink-0 tabular-nums text-[10px] text-(--gd-color-text-gray)">
          {{ t('trajectory.detail.tools', { n: row.envelope.tools?.length ?? 0 }) }}
        </span>
      </div>
    </div>

    <!-- 展开：diff + 系统提示词 + 工具清单 -->
    <div v-if="expanded" class="cv-row border-b-[0.5px] border-(--gd-color-border)/60 py-[6px] pr-[8px] pl-[44px]">
      <div
        v-if="diffInfo"
        class="overflow-y-auto rounded-[4px] font-mono text-[11px]/[17px]"
        :class="diffInfo.tooLarge ? '' : 'max-h-40'"
      >
        <span v-if="diffInfo.tooLarge" class="block px-[6px] text-(--gd-color-text-gray)">
          {{ t('trajectory.diff.tooLarge', { added: diffInfo.added, removed: diffInfo.removed }) }}
        </span>
        <template v-else>
          <div
            v-for="(line, li) in diffInfo.lines"
            :key="li"
            class="block px-[6px] break-words"
            :class="diffLineClass(line)"
          >{{ line.omitted !== undefined ? t('trajectory.diff.unchanged', { n: line.omitted }) : (line.text.trim() === '' ? t('trajectory.diff.blank') : line.text) }}</div>
        </template>
      </div>
      <details v-if="row.envelope.system" class="mt-[6px]">
        <summary class="cursor-pointer select-none text-[10px] text-(--gd-color-text-gray)">
          {{ t('trajectory.detail.systemPrompt') }}（{{ row.envelope.system!.length }} chars）
        </summary>
        <pre class="mt-[4px] max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px]/[17px] px-[6px]">{{ row.envelope.system }}</pre>
      </details>
      <div
        v-if="row.envelope.tools?.length"
        class="mt-[4px] break-words leading-relaxed text-[10px] text-(--gd-color-text-gray)"
      >
        {{ t('trajectory.detail.tools', { n: row.envelope.tools.length }) }}
        {{ row.envelope.tools.map((x) => x.name).join(', ') }}
      </div>
    </div>
  </template>

  <!-- 消息行（kind 徽章事件列 + 内容列单行省略，整行点击展开） -->
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
 * 台账单行（plain / virtual 两种台账模式共用）：分界章 / 圆点边界 / kind 徽章 / 内容列。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrajectoryMessageNode, TrajectoryStepView } from '@/services/modules/trajectory.api';
import type { LedgerRow } from '@/composables/useTrajectory';
import TrajectoryCell from './TrajectoryCell.vue';
import TrajectoryStepDetail from './TrajectoryStepDetail.vue';
import {
  compactTrajectoryDiff,
  diffTrajectoryLines,
  formatTrajectoryDuration,
  formatTrajectoryTokens,
} from './format';

const props = defineProps<{
  row: LedgerRow;
  /** 该行是否展开（消息行 / SYSTEM 行用） */
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

/** 边界圆点状态色 */
function dotClass(status: string): string {
  return status === 'error'
    ? 'bg-(--gd-trajectory-error)'
    : 'bg-(--gd-color-text-gray)';
}

function statusChipClass(status: string): string {
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

/** SYSTEM 行文案：语义标签（初始系统提示词 / 系统提示词已更新），未知 reason 回退原词 */
function systemTitle(row: { envelope: { reason: string } }): string {
  const key = `trajectory.envelope.title.${row.envelope.reason}`;
  const translated = t(key);
  return translated === key ? row.envelope.reason : translated;
}

function tokensLabel(step: TrajectoryStepView): string | null {
  if (!step.usage) return null;
  return `${formatTrajectoryTokens(step.usage.promptTokens)}→${formatTrajectoryTokens(step.usage.completionTokens)}`;
}

function durationLabel(step: TrajectoryStepView): string | null {
  return formatTrajectoryDuration(step.durationMs);
}

/** 相邻快照的 system diff（未变区段折叠；整段重写 → 一行摘要） */
const DIFF_TOO_LARGE_LINES = 30;
const diffInfo = computed(() => {
  if (props.row.kind !== 'system') return null;
  const { previous, envelope } = props.row;
  if (!previous) return null;
  const raw = diffTrajectoryLines(previous.system ?? '', envelope.system ?? '');
  if (!raw) return null;
  const added = raw.filter((l) => l.type === 'added').length;
  const removed = raw.filter((l) => l.type === 'removed').length;
  const tooLarge = added + removed > DIFF_TOO_LARGE_LINES;
  return { lines: tooLarge ? [] : compactTrajectoryDiff(raw), added, removed, tooLarge };
});

/** diff 行视觉：added 绿 tint / removed 红 tint / 未变灰 / 省略标记居中 */
function diffLineClass(line: { type: 'same' | 'added' | 'removed'; omitted?: number }): string {
  if (line.omitted !== undefined) {
    return 'text-center text-(--gd-color-text-gray) bg-(--gd-trajectory-neutral-bg)';
  }
  switch (line.type) {
    case 'added':
      return 'text-(--gd-trajectory-added) bg-(--gd-trajectory-added)/10';
    case 'removed':
      return 'text-(--gd-trajectory-error) bg-(--gd-trajectory-error)/10';
    default:
      return 'text-(--gd-color-text-gray)';
  }
}
</script>
