<template>
  <div class="flex flex-col gap-4">
    <!-- ============ 上下文统计卡片 ============ -->
    <template v-if="tokenStats">
      <div>
        <!-- 使用率进度条 -->
        <div class="mb-3">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">{{ t('chat.memo.contextUsage')
                }}</span>
              <GdTooltip :content="t('chat.memo.contextUsageTooltip')" placement="top">
                <el-icon
                  class="text-gray-400 dark:text-[#8b8d95] hover:text-gray-600 dark:hover:text-[#a8aab0] cursor-help transition-colors"
                  :size="14">
                  <QuestionCircle16Filled />
                </el-icon>
              </GdTooltip>
            </div>
            <span class="text-base font-bold" :class="usageColorClass">
              {{ tokenStats.percentage }}%
            </span>
          </div>
          <el-progress :percentage="tokenStats.percentage" :color="progressColor" :stroke-width="6"
            :show-text="false" />
          <div class="flex items-center gap-2 mt-1.5">
            <span class="text-xs text-gray-400 dark:text-[#8b8d95]">
              {{ tokenStats.usedTokens.toLocaleString() }} / {{ tokenStats.totalTokens.toLocaleString() }} · {{
                t('chat.memo.messages', { count: tokenStats.messageCount }) }}
            </span>
            <GdButton v-if="tokenStats.breakdown" size="small" text @click="showBreakdown = !showBreakdown"
              :class="memoTextButtonClass" :style="memoTextButtonStyle">
              {{ t('chat.memo.details') }}
            </GdButton>
          </div>
          <!-- 窗口口径说明：环形/进度条的分母是“压缩有效窗口”（总窗口 − 封顶输出预留） -->
          <div v-if="tokenStats.totalContextWindow" class="mt-0.5 text-[11px] text-gray-400 dark:text-[#8b8d95]">
            {{ t('chat.memo.windowDetail', {
              total: tokenStats.totalContextWindow.toLocaleString(),
              reserve: (tokenStats.outputReserveTokens || 0).toLocaleString(),
            }) }}
          </div>
        </div>

        <!-- 细分统计：垂直列表 -->
        <div v-if="tokenStats.breakdown && showBreakdown" class="space-y-2.5 mb-3">
          <div v-for="item in breakdownItems" :key="item.key">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-gray-600 dark:text-[#a8aab0]">{{ item.label }}</span>
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium" :class="item.colorClass">{{ item.tokens.toLocaleString() }}</span>
                <span class="text-xs text-gray-400 dark:text-[#8b8d95] w-10 text-right">{{ item.percentage }}%</span>
              </div>
            </div>
            <div class="h-1.5 bg-gray-200 dark:bg-[#2a2c30] rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-300" :class="item.barClass"
                :style="{ width: item.percentage + '%' }" />
            </div>
          </div>
        </div>


        <!-- 请求媒体负载（精确值）：媒体预算只约束图片，不含文本/工具定义 -->
        <div v-if="requestStats" class="mb-3">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">{{ t('chat.memo.requestMedia')
                }}</span>
              <GdTooltip :content="t('chat.memo.requestMediaTooltip')" placement="top">
                <el-icon
                  class="text-gray-400 dark:text-[#8b8d95] hover:text-gray-600 dark:hover:text-[#a8aab0] cursor-help transition-colors"
                  :size="14">
                  <QuestionCircle16Filled />
                </el-icon>
              </GdTooltip>
            </div>
            <span class="text-base font-bold" :class="mediaColorClass">
              {{ mediaUsagePercent }}%
            </span>
          </div>
          <el-progress :percentage="mediaUsagePercent" :color="mediaColor" :stroke-width="6" :show-text="false" />
          <div class="flex items-center justify-between gap-2 mt-1.5">
            <span class="text-xs text-gray-400 dark:text-[#8b8d95]">
              {{ formatBytes(requestStats.mediaBytes) }} / {{ formatBytes(requestStats.mediaBudgetBytes) }} ·
              {{ t('chat.memo.imagesRetained', { count: requestStats.retainedImages ?? 0 }) }}
              <template v-if="requestStats.omittedImages">
                · {{ t('chat.memo.imagesOmitted', { count: requestStats.omittedImages }) }}
              </template>
            </span>
            <GdButton size="small" text @click="openPruneDialog" :class="memoTextButtonClass"
              :style="memoTextButtonStyle">
              {{ t('chat.memo.pruneToolImages') }}
            </GdButton>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2 pt-3">
          <GdButton size="small" @click="loadTokenStats" class="flex-1">
            <el-icon class="mr-1">
              <ArrowClockwise16Regular />
            </el-icon>
            {{ t('common.refresh') }}
          </GdButton>
          <GdButton size="small" @click="handleCompress" :loading="isCompressing" class="flex-1">
            <el-icon class="mr-1">
              <Wand16Regular />
            </el-icon>
            {{ isCompressing ? t('chat.memo.compressing') : t('chat.memo.compress') }}
          </GdButton>
        </div>
      </div>
    </template>
    <template v-else>
      <el-empty :description="t('chat.memo.noStats')" :image-size="60" />
    </template>

    <!-- ============ 最新压缩状态 ============ -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">{{ t('chat.memo.latestCompressStatus') }}
        </h4>
        <span class="text-xs text-gray-400 dark:text-[#8b8d95]">{{ t('chat.memo.compressedTimes', {
          count: summaryTotal
          })
          }}</span>
      </div>

      <template v-if="summaries.length > 0">
        <!-- 只显示最新一条 -->
        <div :key="summaries[0].id">

          <!-- 摘要内容 -->
          <div v-if="summaries[0].summaryContent"
            class="text-xs text-gray-700 dark:text-[#c8c9cd] whitespace-pre-wrap leading-relaxed mb-3 max-h-32 overflow-y-auto">
            {{ summaries[0].summaryContent }}
          </div>

          <!-- 统计信息区域 -->
          <div v-if="summaries[0].compressionStats" class="space-y-2 mb-3">
            <div
              v-if="summaries[0].compressionStats?.beforeTokenCount && summaries[0].compressionStats?.afterTokenCount"
              class="flex justify-between items-center text-xs">
              <span class="text-gray-600 dark:text-[#a8aab0]">Token</span>
              <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                {{ formatNumber(summaries[0].compressionStats.beforeTokenCount) }} → {{
                  formatNumber(summaries[0].compressionStats.afterTokenCount) }}
                <span class="text-green-600 dark:text-green-500 ml-1">
                  (-{{ formatNumber(summaries[0].compressionStats.beforeTokenCount -
                    summaries[0].compressionStats.afterTokenCount) }})
                </span>
              </span>
            </div>
            <div class="flex items-center gap-1.5 text-xs pt-1">
              <el-tag size="small" :type="getStrategyTagType(summaries[0].cleaningStrategy || 'unknown')">
                {{ getStrategyLabel(summaries[0].cleaningStrategy || 'unknown') }}
              </el-tag>
              <span v-if="summaries[0].shadowedCount > 0" class="text-gray-500 dark:text-[#8b8d95]">
                {{ summaries[0].shadowedCount }} {{ t('chat.memo.items') }}
              </span>
            </div>
          </div>

          <div v-else-if="!summaries[0].summaryContent" class="text-xs text-gray-400 dark:text-[#8b8d95] italic mb-3">
            {{ t('chat.memo.noSummaryContent') }}
          </div>


          <!-- 底部信息：时间戳和操作按钮 -->
          <div class="flex items-center justify-between text-xs pt-3">
            <span class="text-gray-400 dark:text-[#8b8d95] truncate" :title="formatTime(summaries[0].createdAt)">
              {{ formatTime(summaries[0].createdAt) }}
            </span>
            <div class="flex gap-1">
              <GdButton size="small" text @click="handleViewHistory"
                class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                <el-icon>
                  <List16Regular />
                </el-icon>
                <span class="ml-1">{{ t('chat.memo.history') }}</span>
              </GdButton>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <el-empty :description="t('chat.memo.noCompressRecords')" :image-size="60" />
      </template>
    </div>

    <!-- 裁剪旧截图对话框 -->
    <GdDialog v-model="pruneDialogVisible" :title="t('chat.memo.pruneDialogTitle')" size="xs" append-to-body
      :z-index="MEMO_DIALOG_Z_INDEX" :close-on-click-modal="!isPruning" :close-on-press-escape="!isPruning"
      :show-close="!isPruning">
      <div class="space-y-3">
        <p class="text-sm text-gray-600 dark:text-[#a8aab0]">{{ t('chat.memo.pruneDialogDesc') }}</p>
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-700 dark:text-[#e8e9ed]">{{ t('chat.memo.pruneKeepTurns') }}</span>
          <GdInputNumber v-model="keepTurns" :min="1" :max="1000" :step="1" :disabled="isPruning" />
          <span class="text-xs text-gray-400 dark:text-[#8b8d95]">{{ t('chat.memo.pruneKeepTurnsUnit') }}</span>
        </div>
        <p class="text-xs text-gray-400 dark:text-[#8b8d95]">
          {{ t('chat.memo.pruneDialogHint', { count: loadedTurnCount }) }}
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <GdButton @click="pruneDialogVisible = false" :disabled="isPruning">
            {{ t('common.cancel') }}
          </GdButton>
          <GdButton type="primary" :loading="isPruning" @click="handlePruneToolImages">
            {{ t('chat.memo.pruneDialogConfirm') }}
          </GdButton>
        </div>
      </template>
    </GdDialog>

    <!-- 压缩历史记录对话框 -->
    <GdDialog v-model="historyDialogVisible" :title="t('chat.memo.compressHistoryTitle')" size="lg"
      :z-index="MEMO_DIALOG_Z_INDEX" append-to-body>
      <template v-if="summaries.length > 0">
        <div v-for="(summary, index) in summaries" :key="summary.id" class="mb-4 last:mb-0">
          <div class="rounded-lg border border-gray-200 dark:border-[#2a2c30] bg-white dark:bg-[#232428] p-4">
            <!-- 头部：序号和时间 -->
            <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100 dark:border-[#2a2c30]">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">{{ t('chat.memo.compressTime', {
                  n: summaryTotal - index }) }}</span>
                <el-tag size="small" :type="getStrategyTagType(summary.cleaningStrategy || 'unknown')">
                  {{ getStrategyLabel(summary.cleaningStrategy || 'unknown') }}
                </el-tag>
              </div>
              <span class="text-xs text-gray-400 dark:text-[#8b8d95]">{{ formatTime(summary.createdAt) }}</span>
            </div>

            <!-- 摘要内容 -->
            <div v-if="summary.summaryContent" class="mb-3">
              <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">{{ t('chat.memo.summaryContentLabel') }}</div>
              <div
                class="text-xs text-gray-700 dark:text-[#c8c9cd] whitespace-pre-wrap leading-relaxed bg-gray-50 dark:bg-[#1e1f23] rounded p-3 max-h-40 overflow-y-auto">
                {{ summary.summaryContent }}
              </div>
            </div>

            <!-- 统计信息 -->
            <div v-if="summary.compressionStats" class="space-y-2">
              <div class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('chat.memo.compressStatsLabel') }}</div>
              <div class="bg-gray-50 dark:bg-[#1e1f23] rounded p-3 space-y-2">
                <!-- Token 统计 -->
                <div v-if="summary.compressionStats?.beforeTokenCount && summary.compressionStats?.afterTokenCount"
                  class="flex justify-between items-center text-xs">
                  <span class="text-gray-600 dark:text-[#a8aab0]">{{ t('chat.memo.tokenCount') }}</span>
                  <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                    {{ formatNumber(summary.compressionStats.beforeTokenCount) }} → {{
                      formatNumber(summary.compressionStats.afterTokenCount) }}
                    <span class="text-green-600 dark:text-green-500 ml-1">(-{{
                      formatNumber(summary.compressionStats.beforeTokenCount - summary.compressionStats.afterTokenCount)
                      }})</span>
                  </span>
                </div>

                <!-- 折叠消息条数 -->
                <div v-if="summary.shadowedCount > 0" class="flex justify-between items-center text-xs">
                  <span class="text-gray-600 dark:text-[#a8aab0]">{{ t('chat.memo.messageCount') }}</span>
                  <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                    {{ summary.shadowedCount }}
                  </span>
                </div>

                <!-- 压缩率 -->
                <div v-if="summary.compressionStats?.beforeTokenCount && summary.compressionStats?.afterTokenCount"
                  class="flex justify-between items-center text-xs">
                  <span class="text-gray-600 dark:text-[#a8aab0]">{{ t('chat.memo.compressRate') }}</span>
                  <span class="font-medium text-green-600 dark:text-green-500">
                    {{ ((1 - summary.compressionStats.afterTokenCount / summary.compressionStats.beforeTokenCount) *
                    100).toFixed(2) }}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <el-empty :description="t('chat.memo.noCompressRecords')" :image-size="80" />
      </template>
      <template #footer>
        <GdButton @click="historyDialogVisible = false">{{ t('chat.memo.close') }}</GdButton>
      </template>
    </GdDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionTokenStats, applyContextStatsFromEvents, clearTokenStats } from '@/composables/useSessionTokenStats';
import GdDialog from '@/components/ui/GdDialog.vue';
import { useSessionStore } from '@/stores/session';
import { apiService } from '@/services/ApiService';
import type { SessionSummaryItem } from '@/services/modules/session.api';
import { getApiErrorStatus, getErrorMessage } from '@/utils/errorMessage';
import { formatBytes } from '@/utils/formatBytes';
import { usePopup } from '@/composables/usePopup';
import { toast } from '@/components/ui/toastService';
import { ArrowClockwise16Regular, QuestionCircle16Filled, Wand16Regular, List16Regular } from '@vicons/fluent';
import dayjs from 'dayjs';
import GdTooltip from '@/components/ui/GdTooltip.vue';
import GdButton from '@/components/ui/GdButton.vue';
import GdInputNumber from '@/components/ui/GdInputNumber.vue';


const { confirm } = usePopup();
const { t } = useI18n();
const sessionStore = useSessionStore();

const emit = defineEmits<{
  close: [];
  /** 内部子弹窗/确认框打开状态变化，父级据此冻结 popover 的自动关闭 */
  overlayActive: [active: boolean];
}>();

const props = defineProps<{
  sessionId: string | null;
}>();
const summaries = ref<SessionSummaryItem[]>([]);
const summaryTotal = ref(0);
const showBreakdown = ref(false);
const historyDialogVisible = ref(false);
const pruneDialogVisible = ref(false);
const keepTurns = ref(5);
const isPruning = ref(false);
/** 高于 GdPopover(3000)、低于 Element Plus 浮层(4000)：浮层内弹窗需显式抬层 */
const MEMO_DIALOG_Z_INDEX = 3500;
const sessionIdRef = computed(() => props.sessionId);
const { tokenStats } = useSessionTokenStats(sessionIdRef);

// 内部子弹窗/确认框是否打开：打开期间父级 popover 冻结"点击外部/Esc 关闭"
const confirmActive = ref(false);
const subDialogOpen = computed(() => historyDialogVisible.value || pruneDialogVisible.value);
const overlayActive = computed(() => subDialogOpen.value || confirmActive.value);
watch(overlayActive, (active) => emit('overlayActive', active));
onBeforeUnmount(() => emit('overlayActive', false));

// 使用 Store 中的会话级压缩状态
const isCompressing = computed(() => {
  return props.sessionId ? sessionStore.sessionIsCompressing(props.sessionId) : false;
});

/** 已加载的对话轮数（仅作弹窗提示；后端按真实轮数 clamp） */
const loadedTurnCount = computed(() => {
  if (!props.sessionId) return 0;
  return sessionStore.getTurns(props.sessionId).filter((turn) => turn.kind === 'turn').length;
});

// 计算进度条颜色
const progressColor = computed(() => {
  if (!tokenStats.value) return '#409eff';
  const percentage = tokenStats.value.percentage;
  if (percentage < 60) return '#67c23a'; // 绿色
  if (percentage < 80) return '#e6a23c'; // 黄色
  return '#f56c6c'; // 红色
});

// 计算使用率颜色类
const usageColorClass = computed(() => {
  if (!tokenStats.value) return 'text-gray-700';
  const percentage = tokenStats.value.percentage;
  if (percentage < 60) return 'text-green-600';
  if (percentage < 80) return 'text-yellow-600';
  return 'text-red-600';
});

/** 媒体区块内联文字按钮：与「详情」同一套字号/内边距；hover 只改文字色，不加背景 */
const memoTextButtonClass =
  'text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 ' +
  'hover:!bg-transparent active:!bg-transparent !px-1 !py-0 !h-auto !leading-none';
const memoTextButtonStyle = { fontSize: '12px' };

/** 最近一次请求携带的媒体负载（旧锚点缺省 → 不渲染卡片） */
const requestStats = computed(() => tokenStats.value?.request);

/** 媒体预算使用率（超出预算时进度条封顶 100%，但数字仍显示真实值） */
const mediaUsagePercent = computed(() => {
  const r = requestStats.value;
  if (!r?.mediaBytes || !r.mediaBudgetBytes) return 0;
  return Math.min(
    100,
    parseFloat(((r.mediaBytes / r.mediaBudgetBytes) * 100).toFixed(1)),
  );
});

const mediaColor = computed(() => {
  const pct = mediaUsagePercent.value;
  if (pct >= 90) return '#f56c6c';
  if (pct >= 70) return '#e6a23c';
  return '#409eff';
});

const mediaColorClass = computed(() => {
  const pct = mediaUsagePercent.value;
  if (pct >= 90) return 'text-red-600';
  if (pct >= 70) return 'text-yellow-600';
  return 'text-green-600';
});

// 细分统计项（系统提示词/历史/工具定义；摘要已折叠进 history）
const breakdownItems = computed(() => {
  if (!tokenStats.value?.breakdown) return [];
  const total = tokenStats.value.totalTokens;
  const b = tokenStats.value.breakdown;
  const items = [
    { key: 'systemPrompt', label: t('chat.memo.systemPrompt'), tokens: b.systemPrompt },
    { key: 'history', label: t('chat.memo.historyLabel'), tokens: b.history },
    { key: 'tools', label: t('chat.memo.toolDefs'), tokens: b.tools },
  ];
  return items.map((item) => {
    const pct = total > 0 ? parseFloat(((item.tokens / total) * 100).toFixed(1)) : 0;
    const intense = pct >= 50;
    const moderate = pct >= 20;
    const colorClass = intense ? 'text-red-600 dark:text-red-500' : moderate ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-600 dark:text-green-500';
    const barClass = intense ? 'bg-red-500' : moderate ? 'bg-yellow-500' : 'bg-green-500';
    return { ...item, percentage: pct, colorClass, barClass };
  });
});
// 加载摘要列表
async function loadSummaries() {
  if (!props.sessionId) return;
  try {
    const res = await apiService.fetchSessionSummaries(props.sessionId, 10);
    summaries.value = res.items;
    summaryTotal.value = res.total;
  } catch (error) {
    console.error('加载摘要失败:', error);
    toast.error(t('chat.memo.loadSummaryFailed'));
  }
}

// 刷新 Token 统计：从事件日志重扫最后一个上下文锚点（统计已统一为事件流投影，不走 REST；
// 实时更新由 streamProjector 在 turn_end / 压缩事件时按会话喂入切片）
function loadTokenStats() {
  if (!props.sessionId) return;
  const eventLog = sessionStore.getSessionState(props.sessionId).eventLog || [];
  applyContextStatsFromEvents(props.sessionId, eventLog);
}

// 格式化时间
function formatTime(dateString: string) {
  return dayjs(dateString).format('YYYY-MM-DD HH:mm:ss');
}

// 格式化数字（添加千位分隔符）
function formatNumber(num: number) {
  return num.toLocaleString();
}

// 获取策略标签类型
function getStrategyTagType(strategy: string) {
  const typeMap: Record<string, 'success' | 'warning' | 'info'> = {
    'pruned_only': 'warning',
    'summarized': 'success',
  };
  return typeMap[strategy] || 'info';
}

// 获取策略显示名称
function getStrategyLabel(strategy: string) {
  const labelMap: Record<string, string> = {
    'pruned_only': t('chat.memo.prunedOnly'),
    'summarized': t('chat.memo.summaryCompress'),
  };
  return labelMap[strategy] || strategy;
}

// 监听会话 ID 变化
watch(
  () => props.sessionId,
  (newSessionId) => {
    if (newSessionId) {

      loadSummaries();
      loadTokenStats();
    } else {
      summaries.value = [];
      summaryTotal.value = 0;
      clearTokenStats();
    }
  },
  { immediate: true }
);

// 流状态变化自动刷新由 useSessionTokenStats 处理，这里只刷新摘要
watch(
  () => props.sessionId ? sessionStore.sessionIsStreaming(props.sessionId) : false,
  (isStreaming, wasStreaming) => {
    if (wasStreaming && !isStreaming) {
      loadSummaries();
    }
  }
);

// 压缩结束后刷新压缩历史（同会话下 sessionId watch 不触发；弹窗可能已关，重开即见新条目）
watch(isCompressing, (now, was) => {
  if (was && !now) {
    loadSummaries();
  }
});

// 触发压缩（异步：维护流占用会话，压缩事件经 SSE 下发，触发后关闭弹窗）
async function handleCompress() {
  if (!props.sessionId) return;

  // 压缩进行中 / 正在流式输出：拒绝重复触发
  if (isCompressing.value) {
    toast.warning(t('chat.memo.compressingWarning'));
    return;
  }
  if (sessionStore.sessionIsStreaming(props.sessionId)) {
    toast.warning(t('chat.memo.streamingWarning'));
    return;
  }

  confirmActive.value = true;
  const compressConfirmed = await confirm(
    t('chat.memo.compressConfirmTitle'),
    t('chat.memo.compressConfirmDesc'),
    { zIndex: MEMO_DIALOG_Z_INDEX },
  );
  confirmActive.value = false;
  if (!compressConfirmed) return;

  try {
    const res = await apiService.compressSession(props.sessionId);
    if (res?.started) {
      // 压缩已后台执行：关闭弹窗，进度与结果由对话区事件卡片展示
      toast.success(t('chat.memo.compressStarted'));
      emit('close');
    } else {
      toast.warning(t('chat.memo.compressNotExecuted'));
    }
  } catch (error) {
    console.error('触发压缩失败:', error);
    // 409：会话正在流式输出（SESSION_STREAMING）或已有任务进行中（SESSION_BUSY）
    const msg = getErrorMessage(error);
    if (getApiErrorStatus(error) === 409 || msg.includes('busy') || msg.includes('STREAMING')) {
      toast.warning(t('chat.memo.streamingWarning'));
    } else {
      toast.error(msg || t('chat.memo.compressFailed'));
    }
  }
}

// 打开“裁剪旧截图”弹窗
function openPruneDialog() {
  if (!props.sessionId) return;
  if (isCompressing.value) {
    toast.warning(t('chat.memo.compressingWarning'));
    return;
  }
  if (sessionStore.sessionIsStreaming(props.sessionId)) {
    toast.warning(t('chat.memo.streamingWarning'));
    return;
  }
  keepTurns.value = Math.min(5, Math.max(1, loadedTurnCount.value || 5));
  pruneDialogVisible.value = true;
}

// 提交工具截图裁剪（同步 REST；完成后 context_stats SSE 会刷新媒体卡片）
async function handlePruneToolImages() {
  if (!props.sessionId || isPruning.value) return;
  if (isCompressing.value) {
    toast.warning(t('chat.memo.compressingWarning'));
    return;
  }
  if (sessionStore.sessionIsStreaming(props.sessionId)) {
    toast.warning(t('chat.memo.streamingWarning'));
    return;
  }

  isPruning.value = true;
  try {
    const res = await apiService.pruneToolImages(props.sessionId, keepTurns.value);
    if (res?.prunedImages > 0) {
      toast.success(
        t('chat.memo.pruneSuccess', {
          count: res.prunedImages,
          size: formatBytes(res.prunedBytes),
        }),
      );
      pruneDialogVisible.value = false;
      // 媒体卡片由 context_stats SSE 更新；eventLog 已追加，这里再兜底重算一次
      loadTokenStats();
      await loadSummaries();
    } else {
      toast.info(t('chat.memo.pruneEmpty'));
      pruneDialogVisible.value = false;
    }
  } catch (error) {
    console.error('裁剪旧截图失败:', error);
    const msg = getErrorMessage(error);
    if (getApiErrorStatus(error) === 409 || msg.includes('busy') || msg.includes('STREAMING')) {
      toast.warning(t('chat.memo.streamingWarning'));
    } else {
      toast.error(msg || t('chat.memo.pruneFailed'));
    }
  } finally {
    isPruning.value = false;
  }
}

// 查看压缩历史
function handleViewHistory() {
  historyDialogVisible.value = true;
}

// 监听标签页切换逻辑已移除，因为不再使用 Tab 组件
// 监听会话 ID 变化时已经完成了数据加载
</script>

<style scoped>
/* 暗色模式下的 el-tag 样式优化 */
:deep(.el-tag) {
  --el-tag-bg-color: var(--el-color-warning-light-9);
  --el-tag-border-color: var(--el-color-warning-light-8);
  --el-tag-text-color: var(--el-color-warning-dark-2);
}

.dark :deep(.el-tag--success) {
  --el-tag-bg-color: rgba(103, 194, 58, 0.1);
  --el-tag-border-color: rgba(103, 194, 58, 0.2);
  --el-tag-text-color: #85ce61;
}

.dark :deep(.el-tag--warning) {
  --el-tag-bg-color: rgba(230, 162, 60, 0.1);
  --el-tag-border-color: rgba(230, 162, 60, 0.2);
  --el-tag-text-color: #ebb563;
}

/* 暗色模式下的进度条颜色优化 */
.dark :deep(.el-progress-bar__inner) {
  transition: all 0.3s ease;
}
</style>
