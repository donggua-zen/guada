<template>
  <!-- SYSTEM 快照列表（对齐 dsh inspector SYSTEM 页签：system prompt + tools + 变更 diff） -->
  <div class="px-2 py-2 space-y-2 text-(11px) border-b border-(--gd-color-border) bg-(--gd-color-sidebar-bg-active)/60">
    <div v-for="(env, i) in envelopes" :key="i" class="rounded-md bg-(--gd-color-sidebar-bg-hover) px-2 py-1.5">
      <div class="flex items-center gap-1.5">
        <span class="font-mono text-(10px) text-(--gd-trajectory-tool-result)">S{{ i + 1 }}</span>
        <span class="text-(--gd-color-text-gray)">{{ env.reason }}</span>
        <span v-if="env.model" class="ml-auto truncate max-w-28 text-(--gd-color-text)" :title="env.model">
          {{ env.model }}
        </span>
      </div>

      <!-- 变更 diff（仅第 2 条起；对齐 dsh SYSTEM diff） -->
      <template v-if="i > 0 && diffFor(i)">
        <div class="mt-1 max-h-40 overflow-y-auto rounded bg-(--gd-color-surface) px-1.5 py-1 font-mono text-(10px) leading-snug">
          <div
            v-for="(line, li) in diffFor(i)!"
            :key="li"
            :class="diffLineClass(line.type)"
          >{{ diffMark(line.type) }}{{ line.text }}</div>
        </div>
      </template>

      <!-- 本条全文（折叠；首条默认展开前 12 行） -->
      <details v-if="env.system" class="mt-1">
        <summary class="cursor-pointer text-(10px) text-(--gd-color-text-gray) select-none">
          {{ t('trajectory.detail.systemPrompt') }}（{{ env.system.length }} chars）
        </summary>
        <pre class="whitespace-pre-wrap break-words mt-1 max-h-40 overflow-y-auto font-mono text-(10px) leading-snug">{{ env.system }}</pre>
      </details>
      <div v-if="env.tools?.length" class="mt-1 text-(10px) text-(--gd-color-text-gray)">
        {{ t('trajectory.detail.tools', { n: env.tools.length }) }}
        <span class="truncate max-w-full" :title="env.tools.map((x) => x.name).join(', ')">
          {{ env.tools.map((x) => x.name).join(', ') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SYSTEM 快照区块：envelope 历史 + 相邻两条的行级 diff（dsh SYSTEM 页签精简版）。
 */
import { useI18n } from 'vue-i18n';
import type { TrajectoryEnvelope } from '@/services/modules/trajectory.api';
import { diffTrajectoryLines, type TrajectoryDiffLine } from './format';

const props = defineProps<{ envelopes: TrajectoryEnvelope[] }>();
const { t } = useI18n();

/** 第 i 条与第 i-1 条的 system 文本 diff；无变化/缺失返回 null */
function diffFor(i: number): TrajectoryDiffLine[] | null {
  const prev = props.envelopes[i - 1]?.system;
  const next = props.envelopes[i]?.system;
  if (typeof prev !== 'string' || typeof next !== 'string') return null;
  return diffTrajectoryLines(prev, next);
}

function diffLineClass(type: TrajectoryDiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'text-(--gd-trajectory-assistant) bg-(--gd-trajectory-assistant)/10';
    case 'removed':
      return 'text-(--gd-trajectory-error) bg-(--gd-trajectory-error)/10';
    default:
      return 'text-(--gd-color-text-gray)';
  }
}

function diffMark(type: TrajectoryDiffLine['type']): string {
  return type === 'added' ? '+ ' : type === 'removed' ? '- ' : '  ';
}
</script>
