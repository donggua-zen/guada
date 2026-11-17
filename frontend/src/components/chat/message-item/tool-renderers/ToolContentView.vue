<template>
  <div class="tool-content-view">
    <div class="tool-view-header">
      <span class="tool-view-file" :title="filePath">{{ fileName }}</span>
      <span class="tool-view-meta">{{ t('chat.toolCalls.lineCount', { n: lineCount }) }}</span>
    </div>
    <div class="tool-content-body">
      <pre class="tool-content-code"><code><span v-for="(line, i) in visibleLines" :key="i" class="code-line" v-html="line || '&nbsp;'"></span></code></pre>
      <div v-if="truncated" class="content-truncated">
        {{ t('chat.toolCalls.truncatedLines', { n: MAX_LINES }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useHighlight } from "@/composables/useHighlight";
import { useThrottledValue } from "@/composables/useThrottledValue";
import { takeTextPreview } from "@/utils/textPreview";
import { perfStart } from "@/utils/perf";

const { t } = useI18n();

const props = defineProps<{
  filePath: string;
  content: string;
}>();

/** 渲染行数上限：防止超大文件撑爆 DOM */
const MAX_LINES = 400;
/** 预览文本硬上限：先截断再高亮，tokenize 成本不再随原文件大小增长 */
const MAX_PREVIEW_CHARS = 120_000;
/** 同步高亮预算：超过则降级为转义后的纯文本（首屏仍立即出现） */
const MAX_HIGHLIGHT_CHARS = 60_000;

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

/**
 * 流式写入时 content 每个 delta 都会增长：切片 + 高亮的成本与已收内容成正比，
 * 边写边看会把主线程吃满。展示层节流到 500ms 一帧（尾值必达，写完立即收敛）。
 */
const shownContent = useThrottledValue(() => props.content, 500);

/** 先切片再高亮：高亮输入最多 MAX_PREVIEW_CHARS，而不是整份文件 */
const preview = computed(() => {
  const span = perfStart("toolCalls.contentPreview");
  const result = takeTextPreview(shownContent.value, MAX_LINES, MAX_PREVIEW_CHARS);
  span?.end({
    chars: shownContent.value.length,
    previewChars: result.text.length,
    lines: result.totalLines,
    truncated: result.truncated ? 1 : 0,
  });
  return result;
});

const lineCount = computed(() => preview.value.totalLines);

const truncated = computed(() => preview.value.truncated);

const lines = computed(() => {
  const text = preview.value.text;
  if (!text) return [];
  const span = perfStart("toolCalls.contentHighlight");
  const highlighted = text.length <= MAX_HIGHLIGHT_CHARS;
  const result = highlighted
    ? highlightCodeLines(text, language.value)
    : text.split("\n").map(escapeHtml);
  span?.end({ chars: text.length, highlighted: highlighted ? 1 : 0 });
  return result;
});

const visibleLines = computed(() => lines.value.slice(0, MAX_LINES));
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

.tool-view-meta {
  flex-shrink: 0;
  color: var(--gd-color-text-gray);
}

.tool-content-body {
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 4px;
  /* 满铺到卡片内缘（抵消 .tool-result-inline 的右内边距）：滚动条贴右边框、不悬空 */
  margin-right: calc(-1 * var(--tool-card-pad-x, 12px));
}

.tool-content-code {
  margin: 0;
  padding: 6px 0;
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 12px;
  /* 整数行高：12 × 1.55 = 18.6px 会让整块每行都落在小数偏移上 */
  line-height: 19px;
  color: var(--gd-color-text);
}

/* 右侧额外补一个卡片内边距，抵消 .tool-content-body 的负边距，保持代码换行宽度不变 */
.code-line {
  display: block;
  padding: 0 calc(10px + var(--tool-card-pad-x, 12px)) 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
}

.content-truncated {
  padding: 4px calc(10px + var(--tool-card-pad-x, 12px)) 4px 10px;
  font-size: 11px;
  color: var(--gd-color-text-gray);
  border-top: 1px solid var(--gd-color-border);
}
</style>
