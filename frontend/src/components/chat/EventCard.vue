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
      <button type="button" class="event-card__compaction-btn" @click="expanded = !expanded">
        <el-icon size="12" class="mr-1">
          <Archive20Regular v-if="!expanded" />
          <ArrowUp16Regular v-else />
        </el-icon>
        <span class="text-xs text-gray-400 dark:text-gray-500">
          {{
            expanded
              ? "收起摘要"
              : `上下文已压缩 · 折叠 ${shadowedCount} 条消息`
          }}
        </span>
      </button>
      <div v-if="expanded && summaryText" class="event-card__summary">
        {{ summaryText }}
      </div>
    </div>

    <!-- 其他事件类消息：通用兜底 -->
    <div v-else class="text-xs text-gray-400 dark:text-gray-500">
      {{ commandName || '事件' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { KeyCommand16Regular, ArrowUp16Regular, Archive20Regular } from "@vicons/fluent";

const props = defineProps<{
  /** 事件源：kind='event' 外壳 turn，或 turn 内 role='event' 消息（两者均从 .metadata 读取事件字段） */
  event?: Record<string, any> | null;
}>();

const expanded = ref(false);

const eventType = computed(() => props.event?.metadata?.eventType ?? "");
const commandName = computed(() => props.event?.metadata?.commandName ?? "");
const outcome = computed(() => props.event?.metadata?.commandOutcome ?? null);
const compactInfo = computed(() => props.event?.metadata?.compactInfo ?? null);
const shadowedCount = computed(() => compactInfo.value?.shadowedMessageIds?.length ?? 0);
const summaryText = computed(
  () => compactInfo.value?.summary ?? props.event?.metadata?.summary ?? "",
);

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

.event-card__compaction-btn {
  @apply flex items-center gap-1 rounded-full px-2.5 py-1 text-gray-400 dark:text-gray-500
    hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-500 dark:hover:text-gray-400 transition-colors;
}
</style>

