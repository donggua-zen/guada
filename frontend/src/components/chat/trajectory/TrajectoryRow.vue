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

  <!-- SYSTEM 快照行（envelope；对齐 dsh request/header 行：S 徽标 + reason + 模型 + 工具数） -->
  <template v-else-if="row.kind === 'system'">
    <button
      type="button"
      class="w-full text-left px-2 py-1.5 flex items-center gap-1.5 border-b border-(--gd-color-border)/60 hover:bg-(--gd-color-sidebar-bg-hover) transition-colors"
      :data-trajectory-source-kind="`system_${row.envelope.reason}`"
      @click="$emit('toggle', row.key)"
    >
      <span
        class="shrink-0 inline-flex items-center px-1.5 rounded font-mono text-(10px) bg-(--gd-trajectory-reasoning)/15 text-(--gd-trajectory-reasoning)"
      >
        S{{ row.number }}
      </span>
      <span class="truncate text-(--gd-color-text)">{{ reasonLabel(row.envelope.reason) }}</span>
      <span
        v-if="row.envelope.model"
        class="ml-auto shrink-0 truncate max-w-24 text-(10px) text-(--gd-color-text-gray)"
      >
        {{ row.envelope.model }}
      </span>
      <span class="shrink-0 tabular-nums text-(10px) text-(--gd-color-text-gray)">
        {{ t('trajectory.detail.tools', { n: row.envelope.tools?.length ?? 0 }) }}
      </span>
    </button>

    <!-- 展开：相邻 diff（对齐 dsh SYSTEM 页签）+ 系统提示词 + 工具清单 -->
    <div
      v-if="expanded"
      class="px-2 py-2 space-y-1.5 border-b border-(--gd-color-border) bg-(--gd-color-sidebar-bg-active)/60 text-(11px)"
    >
      <div
        v-if="diffInfo"
        class="overflow-y-auto rounded bg-(--gd-color-surface) px-1.5 py-1 font-mono text-(10px) leading-snug"
        :class="diffInfo.tooLarge ? '' : 'max-h-40'"
      >
        <span v-if="diffInfo.tooLarge" class="text-(--gd-color-text-gray)">
          {{ t('trajectory.diff.tooLarge', { added: diffInfo.added, removed: diffInfo.removed }) }}
        </span>
        <template v-else>
          <!-- 标记放独立装订线列：原文行首自带的 '- '/'*' 不再与 diff 标记连字 -->
          <div
            v-for="(line, li) in diffInfo.lines"
            :key="li"
            :class="line.omitted !== undefined
              ? 'text-center text-(--gd-color-text-gray)'
              : [diffLineClass(line.type), 'flex items-start gap-1']"
          >
            <template v-if="line.omitted !== undefined">
              {{ t('trajectory.diff.unchanged', { n: line.omitted }) }}
            </template>
            <template v-else>
              <span class="w-2.5 shrink-0 select-none text-center opacity-60">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
              <span class="flex-1 break-words">{{ line.text.trim() === '' ? t('trajectory.diff.blank') : line.text }}</span>
            </template>
          </div>
        </template>
      </div>
      <details v-if="row.envelope.system">
        <summary class="cursor-pointer select-none text-(10px) text-(--gd-color-text-gray)">
          {{ t('trajectory.detail.systemPrompt') }}（{{ row.envelope.system!.length }} chars）
        </summary>
        <pre class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-(10px) leading-snug">{{ row.envelope.system }}</pre>
      </details>
      <div
        v-if="row.envelope.tools?.length"
        class="break-words leading-relaxed text-(10px) text-(--gd-color-text-gray)"
      >
        {{ t('trajectory.detail.tools', { n: row.envelope.tools.length }) }}
        {{ row.envelope.tools.map((x) => x.name).join(', ') }}
      </div>
    </div>
  </template>

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
import {
  compactTrajectoryDiff,
  diffTrajectoryLines,
  formatTrajectoryDuration,
  formatTrajectoryTokens,
} from './format';

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

/** envelope reason 标签（i18n 词表优先，未知 reason 回退原词） */
function reasonLabel(reason: string): string {
  const key = `trajectory.envelope.reason.${reason}`;
  const translated = t(key);
  return translated === key ? reason : translated;
}

/**
 * 相邻快照的 system diff（无上一条或全等 → null）。
 * 未变区段折叠为省略标记；变化行超过阈值（整段重写）→ 只给一行摘要，
 * 不摊开整个 diff（+/- 空行堆叠在窄栏里视觉上就是一大块空白）。
 */
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

function diffLineClass(type: 'same' | 'added' | 'removed'): string {
  switch (type) {
    case 'added':
      return 'text-(--gd-trajectory-assistant) bg-(--gd-trajectory-assistant)/10';
    case 'removed':
      return 'text-(--gd-trajectory-error) bg-(--gd-trajectory-error)/10';
    default:
      return 'text-(--gd-color-text-gray)';
  }
}



function tokensLabel(step: TrajectoryStepView): string | null {
  if (!step.usage) return null;
  return `${formatTrajectoryTokens(step.usage.promptTokens)}→${formatTrajectoryTokens(step.usage.completionTokens)}`;
}

function durationLabel(step: TrajectoryStepView): string | null {
  return formatTrajectoryDuration(step.durationMs);
}
</script>
