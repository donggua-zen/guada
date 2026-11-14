<template>
  <!-- 选中 request 的内嵌详情 -->
  <div class="px-2 py-2 bg-(--gd-color-sidebar-bg-active)/60 border-b border-(--gd-color-border) space-y-1.5 text-(11px)">
    <!-- 元信息栅格 -->
    <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.status') }}</span>
      <span :class="statusClass">{{ statusLabel }}</span>

      <template v-if="step.model">
        <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.model') }}</span>
        <span class="truncate">{{ step.model }}</span>
      </template>
      <template v-if="step.provider">
        <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.provider') }}</span>
        <span>{{ step.provider }}</span>
      </template>

      <template v-if="step.usage">
        <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.usage') }}</span>
        <span class="tabular-nums">
          {{ step.usage.promptTokens }} → {{ step.usage.completionTokens }}
          <template v-if="step.usage.totalTokens">（{{ step.usage.totalTokens }}）</template>
          <template v-if="cachedLabel"> · {{ cachedLabel }}</template>
        </span>
      </template>

      <template v-if="durationLabel">
        <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.duration') }}</span>
        <span class="tabular-nums">{{ durationLabel }}</span>
      </template>

      <template v-if="step.finishReason">
        <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.finishReason') }}</span>
        <span>{{ step.finishReason }}</span>
      </template>

      <template v-if="step.attemptIndex">
        <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.attempts') }}</span>
        <span class="tabular-nums">{{ step.attemptIndex }}</span>
      </template>

      <template v-if="timing">
        <span class="text-(--gd-color-text-gray)">TTFT</span>
        <span class="tabular-nums">{{ timing.ttftLabel }}</span>
        <template v-if="timing.genLabel">
          <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.genTime') }}</span>
          <span class="tabular-nums">{{ timing.genLabel }}</span>
        </template>
        <template v-if="timing.tpsLabel">
          <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.throughput') }}</span>
          <span class="tabular-nums">{{ timing.tpsLabel }}</span>
        </template>
      </template>

      <span class="text-(--gd-color-text-gray)">{{ t('trajectory.detail.window') }}</span>
      <span class="font-mono text-(10px) break-all">
        [{{ step.input.fromSeq }}..{{ step.input.toSeq }}] / [{{ step.output.fromSeq }}..{{ outputToLabel }}]
      </span>
    </div>

    <!-- 错误块 -->
    <div v-if="step.error" class="rounded-md bg-(--gd-trajectory-error)/10 px-2 py-1.5">
      <div class="font-medium text-(--gd-trajectory-error)">{{ step.error.name }}</div>
      <pre class="whitespace-pre-wrap break-words mt-0.5 text-(10px) leading-snug">{{ step.error.message }}</pre>
    </div>

    <!-- 媒体占位清单 -->
    <div v-if="step.mediaOverlay?.length" class="rounded-md bg-amber-500/10 px-2 py-1.5">
      <div class="font-medium text-amber-500">
        {{ t('trajectory.detail.mediaOverlay', { n: step.mediaOverlay.length }) }}
      </div>
      <div v-for="(o, i) in step.mediaOverlay" :key="i" class="truncate text-(10px) text-(--gd-color-text-gray)">
        {{ o.messageId }}#{{ o.blockIndex }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Request N 详情块：状态/模型/usage/耗时/finishReason/重试/seq 窗口 + 错误与媒体占位。
 * IN/OUT 明细不在此重复——台账消息行（region in/out）即明细。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrajectoryMessageNode, TrajectoryStepView } from '@/services/modules/trajectory.api';
import { formatTrajectoryDuration } from './format';

const props = defineProps<{
  step: TrajectoryStepView;
  /** OUT 区消息节点（计时来源：块级 timing 由 assembler 打点随块持久化） */
  outputNodes?: TrajectoryMessageNode[];
}>();
const { t } = useI18n();

const statusClass = computed(() => {
  switch (props.step.status) {
    case 'error':
      return 'text-(--gd-trajectory-error)';
    case 'unclosed':
      return 'text-amber-500';
    default:
      return 'text-(--gd-trajectory-tool-result)';
  }
});

const statusLabel = computed(() => t(`trajectory.status.${props.step.status}`));

const cachedLabel = computed(() => {
  const read = props.step.usage?.cachedTokens?.read;
  return read ? t('trajectory.detail.cached', { n: read }) : null;
});

const durationLabel = computed(() => formatTrajectoryDuration(props.step.durationMs));

const outputToLabel = computed(() =>
  props.step.output.toSeq === Number.MAX_SAFE_INTEGER ? '…' : String(props.step.output.toSeq),
);

/**
 * 计时（TTFT / 生成时长 / 吞吐）。
 * 来源 = OUT 区 assistant 块的 BlockTiming（首块 startedAt 为首 token，末块 finishedAt 收口）。
 */
const timing = computed(() => {
  const assistant = props.outputNodes?.find((n) => n.role === 'assistant');
  if (!assistant) return null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const block of assistant.content ?? []) {
    // timing 只在部分块形态上存在（text/reasoning/tool-call），统一按可选形状取
    const t0 = (block as { timing?: { startedAt?: number } }).timing?.startedAt;
    const t1 = (block as { timing?: { finishedAt?: number } }).timing?.finishedAt;
    if (typeof t0 === 'number') firstAt = firstAt === null ? t0 : Math.min(firstAt, t0);
    if (typeof t1 === 'number') lastAt = lastAt === null ? t1 : Math.max(lastAt, t1);
  }
  if (firstAt === null) return null;
  const ttftMs = Math.max(0, firstAt - props.step.startedAt);
  const genMs = lastAt !== null ? Math.max(0, lastAt - firstAt) : null;
  const completion = props.step.usage?.completionTokens;
  const tps =
    genMs && genMs > 0 && completion ? (completion / (genMs / 1000)).toFixed(1) : null;
  return {
    ttftLabel: formatTrajectoryDuration(ttftMs),
    genLabel: genMs !== null ? formatTrajectoryDuration(genMs) : null,
    tpsLabel: tps ? `${tps} tok/s` : null,
  };
});
</script>
