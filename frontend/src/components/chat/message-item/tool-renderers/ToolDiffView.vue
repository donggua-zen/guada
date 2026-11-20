<template>
  <div class="tool-diff-view">
    <div class="tool-view-header">
      <span class="tool-view-file" v-tooltip="filePath">{{ fileName }}</span>
      <span v-if="diffStat.added" class="diff-stat diff-stat--add">+{{ diffStat.added }}</span>
      <span v-if="diffStat.removed" class="diff-stat diff-stat--remove">−{{ diffStat.removed }}</span>
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
      <div v-if="truncated" class="diff-truncated">
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
import { countDiffLines, type DiffStat } from "@/utils/diff";
import { takeTextPreview } from "@/utils/textPreview";

const { t } = useI18n();

const props = defineProps<{
  filePath: string;
  oldText: string;
  newText: string;
  /** 全文增删统计（父层已算过）；缺省时本组件自行计算 */
  stat?: DiffStat;
}>();

/** 渲染行数上限：防止超大 diff 撑爆 DOM */
const MAX_ROWS = 400;
/** 单侧预览字符上限：diff/高亮只处理前 400 行切片 */
const MAX_PREVIEW_CHARS = 120_000;
/** 两侧预览合计的高亮预算：超过则退化为转义纯文本 */
const MAX_HIGHLIGHT_CHARS = 120_000;

const { highlightCodeLines, getLanguageFromExtension, escapeHtml } = useHighlight();

const fileName = computed(() => {
  const parts = props.filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || props.filePath;
});

const language = computed(() => {
  const dot = props.filePath.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  return getLanguageFromExtension(props.filePath.slice(dot)) || "plaintext";
});

/** diff 只在前 400 行切片上计算；行头徽章仍是全文统计 */
const oldPreview = computed(() =>
  takeTextPreview(props.oldText, MAX_ROWS, MAX_PREVIEW_CHARS),
);
const newPreview = computed(() =>
  takeTextPreview(props.newText, MAX_ROWS, MAX_PREVIEW_CHARS),
);

const diffStat = computed(
  () => props.stat ?? countDiffLines(props.oldText, props.newText),
);

interface DiffRow {
  type: "add" | "del" | "ctx";
  sign: string;
  html: string;
}

const rows = computed<DiffRow[]>(() => {
  const oldText = oldPreview.value.text;
  const newText = newPreview.value.text;
  if (!oldText && !newText) return [];
  // 流式期间文本不完整，diffLines 对部分文本同样适用
  const parts = diffLines(oldText, newText);
  const highlighted = oldText.length + newText.length <= MAX_HIGHLIGHT_CHARS;
  const out: DiffRow[] = [];
  for (const part of parts) {
    const text = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    if (!text) continue;
    // 整段高亮后按行拆分，保留跨行 token（块注释/模板字符串）的上下文
    const htmls = highlighted
      ? highlightCodeLines(text, language.value)
      : text.split("\n").map(escapeHtml);
    for (const html of htmls) {
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

const truncated = computed(
  () =>
    oldPreview.value.truncated ||
    newPreview.value.truncated ||
    rows.value.length > MAX_ROWS,
);
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
  color: var(--gd-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-stat {
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.diff-stat--add {
  color: var(--gd-color-success);
}

.diff-stat--remove {
  color: var(--gd-color-danger);
}

.tool-diff-body {
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 4px;
  /* 满铺到卡片内缘（抵消 .tool-result-inline 的右内边距）：滚动条贴右边框、不悬空 */
  margin-right: calc(-1 * var(--tool-card-pad-x, 12px));
}

/* 表格按满铺量收窄，增删底色行仍与卡片留白对齐（不顶到边框） */
.diff-table {
  width: calc(100% - var(--tool-card-pad-x, 12px));
  border-collapse: collapse;
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 12px;
  /* 整数行高：12 × 1.55 = 18.6px 会让整块每行都落在小数偏移上（长 diff 最明显） */
  line-height: 19px;
  color: var(--gd-color-text);
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
  background: rgba(var(--gd-color-success-rgb, 103, 194, 58), 0.1);
}

.diff-line--add .diff-sign {
  color: var(--gd-color-success);
}

.diff-line--del {
  background: rgba(var(--gd-color-danger-rgb, 245, 108, 108), 0.1);
}

.diff-line--del .diff-sign {
  color: var(--gd-color-danger);
}

.diff-line--ctx .diff-sign {
  color: var(--gd-color-text-disabled);
}

.diff-truncated {
  padding: 4px calc(10px + var(--tool-card-pad-x, 12px)) 4px 10px;
  font-size: 11px;
  color: var(--gd-color-text-gray);
  border-top: 1px solid var(--gd-color-border);
}
</style>
