<template>
  <!--
    单行渲染（plain / virtual 两种台账模式共用）：两列网格 50px 事件列 + 1fr 内容列。
    - turn-header：回合分界线 + 线下的细标签
    - system / message：事件列 kind 徽章
  -->
  <!-- 回合分界：分隔线 + 线下的细标签（不悬空、不压徽章列；已删除回合标记为红） -->
  <div
    v-if="row.kind === 'turn-header'"
    class="cv-row flex h-[18px] items-center border-t-2 border-(--gd-color-border)"
  >
    <span
      class="px-[6px] font-mono text-[9px]/[11px]"
      :class="row.deletedTurn ? 'text-(--gd-trajectory-error)' : 'text-(--gd-color-text-gray)'"
    >{{ t('trajectory.turnLabel', { n: row.label }) }}</span>
  </div>

  <!-- SYSTEM 快照行 -->
  <template v-else-if="row.kind === 'system'">
    <div
      class="cv-row grid grid-cols-[50px_1fr] items-center h-[30px] border-b-[0.5px] text-[12px] leading-[18px] border-(--gd-color-border)/60 hover:bg-(--gd-color-sidebar-bg-hover) transition-colors cursor-pointer text-[12px] leading-[18px]"
      :data-trajectory-source-kind="`system_${row.envelope.reason}`"
      @click="$emit('toggle', row.key)"
    >
      <div class="relative h-full">
        <span class="absolute left-0 top-0 bottom-0 w-[2px] bg-(--gd-trajectory-turn-rail)"></span>
        <span
          class="absolute right-[4px] top-1/2 -translate-y-1/2 inline-flex h-[19px] px-[5px] whitespace-nowrap rounded-[4px] text-[10px] font-[650] leading-[16px] text-(--gd-color-text-gray) bg-(--gd-trajectory-neutral-bg)"
        >S{{ row.number }}</span>
      </div>
      <div class="flex items-center gap-1.5 min-w-0 pl-[4px] pr-[8px]">
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
    <div v-if="expanded" class="cv-row border-b-[0.5px] border-(--gd-color-border)/60 py-[6px] pr-[8px] pl-[54px]">
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

  <!-- 通用事件行：原始日志事件逐条审计（step/start|end、context/stats、turn/finish、
       compaction、turn/delete、未知事件——点击展开原始 JSON） -->
  <template v-else-if="row.kind === 'event'">
    <div
      class="cv-row grid grid-cols-[50px_1fr] items-center h-[30px] border-b-[0.5px] border-(--gd-color-border)/40 hover:bg-(--gd-color-sidebar-bg-hover) cursor-pointer text-[12px] leading-[18px]"
      :class="row.deletedTurn ? 'opacity-50' : ''"
      :data-trajectory-event="row.event.type"
      @click="$emit('toggle', row.key)"
    >
      <div class="relative h-full">
        <span class="absolute left-0 top-0 bottom-0 w-[2px] bg-(--gd-trajectory-turn-rail)"></span>
        <span
          class="absolute right-[4px] top-1/2 -translate-y-1/2 inline-flex h-[19px] px-[5px] whitespace-nowrap rounded-[4px] text-[10px] leading-[16px] font-[650] tracking-[0.035em]"
          :class="eventBadgeClass"
        >{{ t('trajectory.role.event') }}</span>
      </div>
      <div class="flex items-center min-w-0 gap-1.5 pl-[4px] pr-[8px]">
        <span class="shrink-0 font-mono text-[11px] text-(--gd-color-text)">{{ row.event.type }}</span>
        <span class="block min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] text-(--gd-color-text-gray)">{{
          eventSummary
        }}</span>
      </div>
    </div>
    <div
      v-if="expanded"
      class="cv-row border-b-[0.5px] border-(--gd-color-border)/60 py-[6px] pr-[8px] pl-[54px]"
    >
      <pre class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px]/[17px] text-(--gd-color-text)">{{ eventJson }}</pre>
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
 * 台账单行（plain / virtual 两种台账模式共用）：回合细标签 / kind 徽章 / 内容列。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LedgerRow } from '@/composables/useTrajectory';
import TrajectoryCell from './TrajectoryCell.vue';
import {
  compactTrajectoryDiff,
  diffTrajectoryLines,
} from './format';

const props = defineProps<{
  row: LedgerRow;
  /** 该行是否展开（消息行 / SYSTEM 行用） */
  expanded: boolean;
}>();

defineEmits<{
  toggle: [key: string];
  'open-sub-trajectory': [subSessionId: string];
}>();

const { t } = useI18n();

/** SYSTEM 行文案：语义标签（初始系统提示词 / 系统提示词已更新），未知 reason 回退原词 */
function systemTitle(row: { envelope: { reason: string } }): string {
  const key = `trajectory.envelope.title.${row.envelope.reason}`;
  const translated = t(key);
  return translated === key ? row.envelope.reason : translated;
}

/** 通用事件行摘要：从载荷里挑关键事实（未知事件回退紧凑 JSON） */
const eventSummary = computed(() => {
  if (props.row.kind !== 'event') return '';
  const { event } = props.row;
  const data = (event.data ?? {}) as Record<string, any>;
  switch (event.type) {
    case 'session/init':
      return '';
    case 'turn/delete':
      return props.row.deletedTurnNumber !== undefined
        ? t('trajectory.event.deletedTurn', { n: props.row.deletedTurnNumber })
        : String(data.turnId ?? '');
    case 'turn/start':
      return [data.turnId].filter(Boolean).join(' ');
    case 'turn/finish':
      return [data.finishReason, data.totalDurationMs !== undefined ? `${data.totalDurationMs}ms` : undefined]
        .filter(Boolean)
        .join(' · ');
    case 'context/stats':
      return data.usedTokens !== undefined ? `usedTokens ${data.usedTokens}` : '';
    case 'step/start':
      return [`step ${data.step ?? ''}`, data.source, data.model].filter(Boolean).join(' · ');
    case 'step/end':
      return [
        data.finishReason,
        data.durationMs !== undefined ? `${data.durationMs}ms` : undefined,
        data.error?.name,
      ]
        .filter(Boolean)
        .join(' · ');
    default: {
      const raw = JSON.stringify(data);
      return raw && raw !== '{}' ? raw.slice(0, 120) : '';
    }
  }
});

/** 通用事件行展开：原始载荷（审计原文） */
const eventJson = computed(() => {
  if (props.row.kind !== 'event') return '';
  return JSON.stringify(props.row.event.data ?? {}, null, 2);
});

/** 通用事件行徽章：turn/delete 用危险色，其余中性 */
const eventBadgeClass = computed(() =>
  props.row.kind === 'event' && props.row.event.type === 'turn/delete'
    ? 'bg-(--gd-trajectory-error)/12 text-(--gd-trajectory-error)'
    : 'bg-(--gd-trajectory-neutral-bg) text-(--gd-color-text-gray)',
);

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
