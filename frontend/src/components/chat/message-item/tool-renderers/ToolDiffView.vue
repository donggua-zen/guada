<template>
  <div class="tool-diff-view">
    <div class="tool-view-header">
      <span class="tool-view-file" :title="filePath">{{ fileName }}</span>
      <span v-if="stat.added" class="diff-stat diff-stat--add">+{{ stat.added }}</span>
      <span v-if="stat.removed" class="diff-stat diff-stat--remove">−{{ stat.removed }}</span>
    </div>
    <div v-if="rows.length" class="tool-diff-body">
      <table class="diff-table">
        <tbody>
          <tr v-for="(row, i) in visibleRows" :key="i" :class="`diff-line--${row.type}`">
            <td class="diff-sign">{{ row.sign }}</td>
            <td class="diff-content" v-html="row.html"></td>
          </tr>
        </tbody>
      </table>
      <div v-if="rows.length > MAX_ROWS" class="diff-truncated">
        {{ t('chat.toolCalls.truncatedLines', { n: MAX_ROWS }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { diffLines } from "diff";
import { useHighlight } from "@/composables/useHighlight";
import { countDiffLines } from "@/utils/diff";

const { t } = useI18n();

const props = defineProps<{
  filePath: string;
  oldText: string;
  newText: string;
}>();

/** 行数上限：防止超大 diff 撑爆 DOM */
const MAX_ROWS = 400;

const { highlightCodeLines, getLanguageFromExtension } = useHighlight();

const fileName = computed(() => {
  const parts = props.filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || props.filePath;
});

const language = computed(() => {
  const dot = props.filePath.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  return getLanguageFromExtension(props.filePath.slice(dot)) || "plaintext";
});

const stat = computed(() => countDiffLines(props.oldText, props.newText));

interface DiffRow {
  type: "add" | "del" | "ctx";
  sign: string;
  html: string;
}

const rows = computed<DiffRow[]>(() => {
  if (!props.oldText && !props.newText) return [];
  // 流式期间文本不完整，diffLines 对部分文本同样适用
  const parts = diffLines(props.oldText, props.newText);
  const out: DiffRow[] = [];
  for (const part of parts) {
    const text = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    if (!text) continue;
    // 整段高亮后按行拆分，保留跨行 token（块注释/模板字符串）的上下文
    for (const html of highlightCodeLines(text, language.value)) {
      if (part.added) {
        out.push({ type: "add", sign: "+", html });
      } else if (part.removed) {
        out.push({ type: "del", sign: "−", html });
      } else {
        out.push({ type: "ctx", sign: " ", html });
      }
    }
  }
  return out;
});

const visibleRows = computed(() => rows.value.slice(0, MAX_ROWS));
</script>

<style scoped>
.tool-view-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0 6px;
  font-size: 12px;
}

.tool-view-file {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-weight: 500;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-stat {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.diff-stat--add {
  color: var(--el-color-success);
}

.diff-stat--remove {
  color: var(--el-color-danger);
}

.tool-diff-body {
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 4px;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 12px;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}

.diff-table td {
  padding: 0;
  vertical-align: top;
}

.diff-sign {
  width: 18px;
  min-width: 18px;
  text-align: center;
  user-select: none;
}

.diff-content {
  padding: 0 8px 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-line--add {
  background: rgba(var(--el-color-success-rgb, 103, 194, 58), 0.1);
}

.diff-line--add .diff-sign {
  color: var(--el-color-success);
}

.diff-line--del {
  background: rgba(var(--el-color-danger-rgb, 245, 108, 108), 0.1);
}

.diff-line--del .diff-sign {
  color: var(--el-color-danger);
}

.diff-line--ctx .diff-sign {
  color: var(--el-text-color-placeholder);
}

.diff-truncated {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
