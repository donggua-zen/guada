<template>
  <div class="event-card w-full py-1.5">
    <!-- 命令执行事件 -->
    <div v-if="eventType === 'command'" class="event-card__command">
      <div class="flex items-center gap-1.5">
        <el-icon size="14" class="text-gray-400 dark:text-gray-500">
          <KeyCommand16Regular />
        </el-icon>
        <span class="font-mono text-xs text-gray-500 dark:text-gray-400">
          /{{ commandName }}
        </span>
        <span v-if="outcome"
          class="rounded px-1.5 py-0.5 text-[10px] leading-none"
          :class="outcomeClass">
          {{ outcomeLabel }}
        </span>
      </div>
      <div v-if="outcome?.text" class="event-card__result">
        {{ outcome.text }}
      </div>
    </div>

    <!-- 压缩摘要事件 -->
    <div v-else-if="eventType === 'compaction'" class="event-card__compaction">
      <!-- 压缩中占位：同款胶囊 + loading（压缩完成后由 compaction_summary 原位替换为结果卡）。
           图标 14px（偶数）与分隔线 2px（h-0.5）：奇数尺寸会让居中余量成半像素，
           图标/线会随容器（回合折叠、滚动）在两种奇偶相位间跳一个设备像素。 -->
      <div v-if="compressing" class="event-card__divider">
        <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
        <span class="event-card__compaction-btn event-card__compaction-btn--compressing">
          <el-icon size="14" class="is-loading">
            <Loading />
          </el-icon>
          <span class="event-card__compaction-text">{{ t('chat.turn.contextCompacting') }}</span>
        </span>
        <span class="event-card__line event-card__line--right" aria-hidden="true"></span>
      </div>
      <!-- 压缩结果卡（纯裁剪/空跑：没有 compaction_summary，靠它说明本次做了什么） -->
      <div v-else-if="compressResult" class="event-card__divider">
        <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
        <span class="event-card__compaction-btn event-card__compaction-btn--compressing">
          <el-icon size="14">
            <Archive20Regular />
          </el-icon>
          <span class="event-card__compaction-text">{{ compressResultLabel }}</span>
        </span>
        <span class="event-card__line event-card__line--right" aria-hidden="true"></span>
      </div>
      <template v-else>
        <div class="event-card__divider">
          <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
          <button type="button" class="event-card__compaction-btn" @click="expanded = !expanded">
            <!-- 14px（偶数）：与上方压缩中胶囊同规格；13px 在 24px 行内的居中余量是 5.5px 半像素 -->
            <el-icon size="14">
              <Archive20Regular v-if="!expanded" />
              <ArrowUp16Regular v-else />
            </el-icon>
            <span class="event-card__compaction-text">{{ compactLabel }}</span>
          </button>
          <span class="event-card__line event-card__line--right" aria-hidden="true"></span>
        </div>
        <div v-if="expanded && summaryText" class="event-card__summary">
          {{ summaryText }}
        </div>
      </template>
      <!-- 降级说明（摘要卡/结果卡共用；成功摘要后仍保留，刷新由 compaction_summary.degraded 重建） -->
      <div v-if="degradedLabel" class="event-card__result event-card__notice-detail">
        {{ degradedLabel }}
      </div>
    </div>

    <!-- 后台作业完成通知（job-notice）：数据仍是 role='user' 消息（source.kind 命中即此分支），
         仅渲染形态对齐压缩卡分隔线样式；将来注入事件有更好的形态时，本分支独立增删。 -->
    <div v-else-if="eventType === 'job-notice'" class="event-card__compaction">
      <div class="event-card__divider">
        <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
        <button type="button" class="event-card__compaction-btn" @click="expanded = !expanded">
          <el-icon size="14">
            <PanelRightExpand20Filled v-if="isSubagentNotice" />
            <ArrowUp16Regular v-else-if="expanded" />
            <ChevronDown12Regular v-else class="rotate-90" />
          </el-icon>
          <span class="event-card__compaction-text">{{ noticeLabel }}</span>
        </button>
        <!-- 子代理结果通知：点进派生子代理的会话（source.subSessionId 结构化携带） -->
        <GdTooltip v-if="isSubagentNotice && subSessionId && openSubAgentSession"
          :content="t('chat.toolCalls.openSubAgentPanel')" placement="top">
          <span class="event-card__subagent-btn" @click="openSubAgentSession(subSessionId)">
            <el-icon size="14">
              <PanelRightExpand20Filled />
            </el-icon>
          </span>
        </GdTooltip>
        <span class="event-card__line event-card__line--right" aria-hidden="true"></span>
      </div>
      <div v-if="expanded && noticeText" class="event-card__summary">{{ noticeText }}</div>
    </div>

    <!-- 上下文窗口变化提示（模型切换 / 会话 token 上限调整） -->
    <div v-else-if="eventType === 'context-notice'" class="event-card__compaction">
      <div class="event-card__divider">
        <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
        <span class="event-card__compaction-btn event-card__compaction-btn--compressing">
          <el-icon size="14">
            <Warning />
          </el-icon>
          <span class="event-card__compaction-text">{{ t('chat.turn.contextWindowNoticeTitle') }}</span>
        </span>
        <span class="event-card__line event-card__line--right" aria-hidden="true"></span>
      </div>
      <div class="event-card__result event-card__notice-detail">
        {{ contextNoticeLabel }}
      </div>
    </div>

    <!-- 其他事件类消息：通用兜底（workflow 进度不落 JSONL，改由 workflow_run 工具行原地渲染，
         历史事件不再渲染卡片） -->
    <div v-else class="text-xs text-gray-400 dark:text-gray-500">
      {{ commandName || '事件' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { Loading, Warning } from "@element-plus/icons-vue";
import {
  KeyCommand16Regular,
  ArrowUp16Regular,
  Archive20Regular,
  ChevronDown12Regular,
  PanelRightExpand20Filled,
} from "@vicons/fluent";
import GdTooltip from "@/components/ui/GdTooltip.vue";
import { stripSystemReminder } from "@/utils/messageUtils";
import type { Turn, MessageBundle } from "@/types/message";

const props = defineProps<{
  /** 事件源：kind='event' 外壳 turn，或 turn 内 role='event' 消息（两者均从 .metadata 读取事件字段） */
  event?: Turn | MessageBundle | null;
}>();

const { t } = useI18n();
const expanded = ref(false);

/** 子代理面板跳转：宿主提供（ChatPage）；BotSessionDialog 等无 provide 时按钮不渲染 */
const openSubAgentSession = inject<((subSessionId: string) => void) | null>(
  'workspace:openSubAgentSession',
  null,
);

const sourceKind = computed(() => {
  const source = (props.event as MessageBundle | null | undefined)?.source;
  return source && typeof source.kind === "string" ? source.kind : "";
});

/**
 * 事件类型：metadata.eventType 优先（event 外壳/束）；
 * 通知类消息数据保持 role='user' 不动，以 source.kind 作为渲染分流的兜底判定。
 */
const eventType = computed(() => {
  const declared = props.event?.metadata?.eventType;
  if (declared) return String(declared);
  if (sourceKind.value === "process_monitor" || sourceKind.value === "sub_agent") {
    return "job-notice";
  }
  return "";
});

const isSubagentNotice = computed(() => sourceKind.value === "sub_agent");
const subSessionId = computed(() => {
  if (!isSubagentNotice.value) return "";
  const source = (props.event as MessageBundle | null | undefined)?.source as
    | { subSessionId?: unknown }
    | undefined;
  return typeof source?.subSessionId === "string" ? source.subSessionId : "";
});

const noticeLabel = computed(() =>
  isSubagentNotice.value
    ? t("chat.turn.viewSubagentResult")
    : t("chat.turn.viewProcessOutput"),
);

const noticeText = computed(() => {
  if (!expanded.value) return "";
  const blocks = (props.event as MessageBundle | null | undefined)?.blocks;
  const text = (blocks ?? [])
    .map((b) => (typeof b?.content === "string" ? b.content : ""))
    .join("\n");
  return stripSystemReminder(text);
});

const compressing = computed(() => !!props.event?.metadata?.compressing);
const compressResult = computed(() => props.event?.metadata?.compressResult ?? null);
const commandName = computed(() => props.event?.metadata?.commandName ?? "");
const outcome = computed(() => props.event?.metadata?.commandOutcome ?? null);
const compactInfo = computed(() => props.event?.metadata?.compactInfo ?? null);
const shadowedCount = computed(
  () =>
    compactInfo.value?.shadowedCount ??
    compactInfo.value?.shadowedMessageIds?.length ??
    0,
);
const summaryText = computed(
  () => compactInfo.value?.summary ?? props.event?.metadata?.summary ?? "",
);
const contextNotice = computed(
  () => props.event?.metadata?.contextNotice ?? null,
);

/** token 数展示（千分位；缺省用 -，避免 NaN） */
const formatTokenCount = (value: number | undefined): string =>
  typeof value === "number" ? value.toLocaleString("en-US") : "-";

/** 上下文窗口提示文案：模型/窗口变化 + 当前占用 + 将自动压缩与否 */
const contextNoticeLabel = computed(() => {
  const notice = contextNotice.value;
  if (!notice) return "";
  const parts: string[] = [];
  if (typeof notice.previousEffectiveContextWindow === "number") {
    parts.push(
      t("chat.turn.contextWindowChanged", {
        model: notice.modelName ?? "",
        previous: formatTokenCount(notice.previousEffectiveContextWindow),
        current: formatTokenCount(notice.effectiveContextWindow),
      }),
    );
  } else {
    parts.push(
      t("chat.turn.contextWindowCurrent", {
        model: notice.modelName ?? "",
        current: formatTokenCount(notice.effectiveContextWindow),
      }),
    );
  }
  parts.push(
    t(
      notice.overWindow
        ? "chat.turn.contextWindowOver"
        : "chat.turn.contextWindowNearLimit",
      {
        used: formatTokenCount(notice.usedTokens),
        ratio: Math.round((notice.triggerRatio ?? 0) * 100),
      },
    ),
  );
  parts.push(
    t(
      notice.willAutoCompact
        ? "chat.turn.contextWindowWillCompact"
        : "chat.turn.contextWindowAutoCompactOff",
    ),
  );
  return parts.join("");
});

/** 摘要输入降级说明（剥离/丢弃统计；成功摘要与结果卡共用） */
const degradedLabel = computed(() => {
  const degraded =
    compactInfo.value?.degraded ?? compressResult.value?.degraded ?? null;
  if (!degraded) return "";
  const parts: string[] = [];
  const stripped =
    (degraded.strippedToolResults ?? 0) +
    (degraded.strippedReasoning ?? 0) +
    (degraded.strippedImages ?? 0) +
    (degraded.strippedFiles ?? 0);
  if (stripped > 0) {
    parts.push(t("chat.turn.contextDegradedStripped", { count: stripped }));
  }
  if ((degraded.truncatedRounds ?? 0) > 0) {
    parts.push(
      t("chat.turn.contextDegradedTruncated", {
        rounds: degraded.truncatedRounds,
        tokens: formatTokenCount(degraded.droppedTokens),
      }),
    );
  }
  return parts.join("");
});

const compactLabel = computed(() => {
  if (expanded.value) return t("chat.turn.collapseSummary");
  return shadowedCount.value > 0
    ? t("chat.turn.contextCompactedCount", { count: shadowedCount.value })
    : t("chat.turn.contextCompacted");
});

/** 未压缩原因 → i18n key（未知原因回退 unknown，不把 key 直接暴露给用户） */
const SKIP_REASON_KEYS: Record<string, string> = {
  "below-threshold": "chat.turn.compressSkip.belowThreshold",
  "prune-sufficient": "chat.turn.compressSkip.pruneSufficient",
  "no-summary-provider": "chat.turn.compressSkip.noSummaryProvider",
  "retain-budget-exceeds-history": "chat.turn.compressSkip.retainBudget",
  "tier-disabled": "chat.turn.compressSkip.tierDisabled",
};

/** 压缩结果卡文案：裁剪/剥离条数 + 是否压缩（未压缩时给出原因；微压缩不显示"未压缩"） */
const compressResultLabel = computed(() => {
  const r = compressResult.value;
  if (!r) return "";
  const parts: string[] = [];
  if (r.pruneEvents > 0) {
    parts.push(t("chat.turn.contextPruned", { count: r.pruneEvents }));
  }
  if (r.thinkingStrippedCount > 0) {
    parts.push(t("chat.turn.contextThinkingStripped", { count: r.thinkingStrippedCount }));
  }
  if (r.compacted) {
    parts.push(t("chat.turn.contextCompacted"));
  } else if (r.tier !== "micro") {
    // 二级（LLM）压缩未发生：给出跳过原因；微压缩（tier=micro）不做二级，不显示"未压缩"
    const reason = t(
      SKIP_REASON_KEYS[r.skipReason] ?? "chat.turn.compressSkip.unknown",
    );
    parts.push(`${t("chat.turn.contextNotCompacted")}（${reason}）`);
  }
  return parts.join(" · ") || t("chat.turn.contextCompacted");
});

const outcomeLabel = computed(() => {
  if (!outcome.value) return "";
  const map: Record<string, string> = {
    success: "完成",
    error: "失败",
    rejected: "已拒绝",
  };
  return map[outcome.value.kind] ?? outcome.value.kind;
});

const outcomeClass = computed(() => {
  if (!outcome.value) return "";
  const map: Record<string, string> = {
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    error: "bg-red-500/10 text-red-500 dark:text-red-400",
    rejected: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
  };
  return map[outcome.value.kind] ?? "bg-gray-500/10 text-gray-500";
});
</script>

<style scoped>
@reference "tailwindcss";

.event-card__result,
.event-card__summary {
  @apply mt-1.5 rounded-md bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400
    whitespace-pre-wrap break-words border border-gray-200/60 dark:border-gray-700/60;
}

/* 窗口变化/降级提示：暖色底突出"需要用户知道"的非致命状态 */
.event-card__notice-detail {
  @apply bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300
    border-amber-200/70 dark:border-amber-700/50;
}

.event-card__divider {
  @apply flex items-center gap-3 select-none;
}

.event-card__line {
  /* 2px 而非 1px：28px 行内居中时 1px 线的余量是 13.5px（半像素），
     线会落在半像素上、随容器相位随机变粗变虚；2px 余量 13px，稳定落在整像素。 */
  @apply h-0.5 flex-1;
}
.event-card__line--left {
  @apply bg-gradient-to-r from-transparent to-gray-200 dark:to-gray-700/60;
}
.event-card__line--right {
  @apply bg-gradient-to-l from-transparent to-gray-200 dark:to-gray-700/60;
}

.event-card__compaction-btn {
  @apply flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-gray-400 dark:text-gray-500
    hover:bg-gray-100/70 dark:hover:bg-gray-800/50 hover:text-gray-500 dark:hover:text-gray-400 transition-colors;
}

.event-card__compaction-btn--compressing {
  @apply cursor-default;
}
.event-card__compaction-text {
  @apply text-xs tracking-wide;
}

.event-card__subagent-btn {
  @apply flex shrink-0 cursor-pointer items-center rounded-full p-1 text-gray-400 dark:text-gray-500
    hover:bg-gray-100/70 dark:hover:bg-gray-800/50 hover:text-gray-500 dark:hover:text-gray-400 transition-colors;
}
</style>

