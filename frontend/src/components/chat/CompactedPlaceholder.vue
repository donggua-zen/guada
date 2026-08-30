<template>
  <div class="compacted-placeholder w-full py-1.5">
    <button type="button" class="compacted-placeholder__btn" @click="expanded = !expanded">
      <el-icon size="12" class="mr-1">
        <ArrowDown16Regular v-if="!expanded" />
        <ArrowUp16Regular v-else />
      </el-icon>
      <span class="text-xs text-gray-400 dark:text-gray-500">
        {{
          expanded
            ? "收起摘要"
            : `已压缩 ${compactInfo?.shadowedMessageIds?.length ?? 0} 条消息`
        }}
      </span>
    </button>
    <!-- 折叠时默认收起，点击展开摘要 -->
    <div v-if="expanded && summaryText" class="compacted-placeholder__summary">
      {{ summaryText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ArrowDown16Regular, ArrowUp16Regular } from "@vicons/fluent";

const props = defineProps<{
  /** 压缩信息（后端 message/compact 事件原文） */
  compactInfo?: {
    shadowedMessageIds?: string[];
    summaryContentId?: string;
    summary?: string;
  } | null;
  /** 兜底摘要文本（可直接展示） */
  summary?: string | null;
}>();

const expanded = ref(false);

const summaryText = computed(() => {
  return props.summary || props.compactInfo?.summary || "";
});
</script>

<style scoped>
@reference "tailwindcss";

.compacted-placeholder__btn {
  @apply flex items-center gap-1 rounded-full px-2.5 py-1 text-gray-400 dark:text-gray-500
    hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-500 dark:hover:text-gray-400 transition-colors;
}
.compacted-placeholder__summary {
  @apply mt-2 rounded-md bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400
    whitespace-pre-wrap break-words border border-gray-200/60 dark:border-gray-700/60;
}
</style>
