<template>
  <div class="h-full w-full flex flex-col overflow-hidden">
    <!-- 头部：汇总 + 搜索 + 操作（对齐 dsh TrajectoryToolbar 的精简版） -->
    <div class="shrink-0 flex flex-col gap-1.5 px-2 pt-2 pb-1.5 border-b border-(--gd-color-border)">
      <div class="flex items-center gap-1.5 flex-wrap text-xs text-(--gd-color-text-gray)">
        <span class="font-medium text-(--gd-color-text)">{{ t('trajectory.title') }}</span>
        <span class="tabular-nums">{{ summary.shownCount }}/{{ summary.callCount }}</span>
        <span v-if="summary.errorCount > 0" class="text-(--gd-trajectory-error) tabular-nums">
          {{ summary.errorCount }} {{ t('trajectory.errors') }}
        </span>
        <span class="tabular-nums">{{ formatTokens(summary.totalTokens) }} tok</span>
        <span v-if="summary.models.length" class="truncate max-w-28" :title="summary.models.join(', ')">
          {{ summary.models.join(', ') }}
        </span>
        <div class="ml-auto flex items-center gap-0.5">
          <GdTooltip :content="t('trajectory.expandAll')" placement="bottom">
            <button type="button" class="btn-icon" @click="expandAll(true)">
              <ChevronDown16Regular class="w-3.5 h-3.5" />
            </button>
          </GdTooltip>
          <GdTooltip :content="t('trajectory.collapseAll')" placement="bottom">
            <button type="button" class="btn-icon" @click="expandAll(false)">
              <ChevronRight16Regular class="w-3.5 h-3.5" />
            </button>
          </GdTooltip>
          <GdTooltip :content="t('trajectory.refresh')" placement="bottom">
            <button type="button" class="btn-icon" :disabled="loading" @click="refresh()">
              <ArrowClockwise16Regular class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" />
            </button>
          </GdTooltip>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <input
          v-model="search"
          type="search"
          class="flex-1 min-w-0 h-7 px-2 rounded-md text-xs bg-(--gd-color-sidebar-bg-hover) outline-none border border-transparent focus:border-(--gd-color-border)"
          :placeholder="t('trajectory.searchPlaceholder')"
        />
        <!-- SYSTEM 快照开关（envelope 历史 + diff，对齐 dsh SYSTEM 页签） -->
        <button
          v-if="(view?.envelopes?.length ?? 0) > 0"
          type="button"
          class="shrink-0 h-7 px-2 rounded-md text-xs transition-colors"
          :class="systemOpen
            ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active) font-medium'
            : 'bg-(--gd-color-sidebar-bg-hover) text-(--gd-color-text-gray)'"
          @click="systemOpen = !systemOpen"
        >
          SYSTEM
        </button>
      </div>
    </div>

    <!-- SYSTEM 快照区（展开时） -->
    <TrajectorySystemSection v-if="systemOpen" :envelopes="view?.envelopes ?? []" class="max-h-56 overflow-y-auto shrink-0" />

    <!-- 台账主体 -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="error" class="p-3 text-xs text-(--gd-trajectory-error)">{{ error }}</div>
      <div v-else-if="loading && !view" class="p-3 text-xs text-(--gd-color-text-gray)">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="!view?.available" class="p-3 text-xs text-(--gd-color-text-gray) leading-relaxed">
        {{ t('trajectory.unavailable') }}
      </div>
      <div v-else-if="rows.length === 0" class="p-3 text-xs text-(--gd-color-text-gray)">
        {{ search ? t('trajectory.noSearchHit') : t('trajectory.empty') }}
      </div>
      <TrajectoryLedger
        v-else
        :rows="rows"
        :expanded="expanded"
        :selected-request-id="selectedRequestId"
        @toggle="toggleExpand"
        @select="selectStep"
        @open-sub-trajectory="emit('open-sub-trajectory', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 调用轨迹面板（aside 页签）：头部汇总 + SYSTEM 快照区 + 台账。
 * 数据经 useTrajectory（REST 拉式投影）；展开状态存 Panel 层（跨卸载存活）。
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowClockwise16Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
} from '@vicons/fluent';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import TrajectoryLedger from './TrajectoryLedger.vue';
import TrajectorySystemSection from './TrajectorySystemSection.vue';
import { useTrajectory } from '@/composables/useTrajectory';
import { formatTrajectoryTokens } from './format';

const props = defineProps<{ sessionId: string | null }>();

const emit = defineEmits<{
  /** 子代理工具行请求打开子会话轨迹（ChatPage 切路由 + 开轨迹页签） */
  'open-sub-trajectory': [subSessionId: string];
}>();

const { t } = useI18n();
const {
  loading, error, view, search, expanded, rows, summary,
  selectedRequestId, refresh, toggleExpand, expandAll, selectStep,
} = useTrajectory(computed(() => props.sessionId));

const systemOpen = ref(false);

function formatTokens(n: number): string {
  return formatTrajectoryTokens(n);
}

// 会话切换：重拉数据（面板保持挂载，数据随 sessionId 走）
watch(
  () => props.sessionId,
  (sid) => {
    if (sid) void refresh();
    else view.value = null;
  },
  { immediate: true },
);
</script>

<style scoped>
@reference "tailwindcss";

.btn-icon {
  @apply w-6 h-6 inline-flex items-center justify-center rounded-md text-(--gd-color-text-gray) hover:bg-(--gd-color-sidebar-bg-hover) disabled:opacity-50;
}
</style>
