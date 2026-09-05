<template>
  <div class="event-card w-full py-1.5">
    <!-- 命令执行事件 -->
    <div v-if="eventType === 'command'" class="event-card__command">
      <div class="flex items-center gap-1.5">
        <el-icon size="13" class="text-gray-400 dark:text-gray-500">
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
      <!-- 压缩中占位：同款胶囊 + loading（压缩完成后由 compaction_summary 原位替换为结果卡） -->
      <div v-if="compressing" class="event-card__divider">
        <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
        <span class="event-card__compaction-btn event-card__compaction-btn--compressing">
          <el-icon size="13" class="is-loading">
            <Loading />
          </el-icon>
          <span class="event-card__compaction-text">{{ t('chat.turn.contextCompacting') }}</span>
        </span>
        <span class="event-card__line event-card__line--right" aria-hidden="true"></span>
      </div>
      <template v-else>
        <div class="event-card__divider">
          <span class="event-card__line event-card__line--left" aria-hidden="true"></span>
          <button type="button" class="event-card__compaction-btn" @click="expanded = !expanded">
            <el-icon size="13">
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
    </div>

    <!-- Workflow 编排进度（run → phase → member 三层卡片） -->
    <WorkflowRunCard v-else-if="eventType === 'workflow' && event?.metadata?.workflow"
      class="w-full" :state="event.metadata.workflow" />

    <!-- 其他事件类消息：通用兜底 -->
    <div v-else class="text-xs text-gray-400 dark:text-gray-500">
      {{ commandName || '事件' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { Loading } from "@element-plus/icons-vue";
import { KeyCommand16Regular, ArrowUp16Regular, Archive20Regular } from "@vicons/fluent";
import WorkflowRunCard from "./WorkflowRunCard.vue";

const props = defineProps<{
  /** 事件源：kind='event' 外壳 turn，或 turn 内 role='event' 消息（两者均从 .metadata 读取事件字段） */
  event?: Record<string, any> | null;
}>();

const { t } = useI18n();
const expanded = ref(false);

const eventType = computed(() => props.event?.metadata?.eventType ?? "");
const compressing = computed(() => !!props.event?.metadata?.compressing);
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

const compactLabel = computed(() => {
  if (expanded.value) return t("chat.turn.collapseSummary");
  return shadowedCount.value > 0
    ? t("chat.turn.contextCompactedCount", { count: shadowedCount.value })
    : t("chat.turn.contextCompacted");
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

.event-card__divider {
  @apply flex items-center gap-3 select-none;
}

.event-card__line {
  @apply h-px flex-1;
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
</style>

