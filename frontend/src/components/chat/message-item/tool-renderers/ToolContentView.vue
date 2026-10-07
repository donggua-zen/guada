<template>
  <div class="tool-content-view">
    <div class="tool-view-header">
      <span class="tool-view-file" :title="filePath">{{ fileName }}</span>
      <span class="tool-view-meta">{{ t('chat.toolCalls.lineCount', { n: lineCount }) }}</span>
    </div>
    <div class="tool-content-body">
      <pre class="tool-content-code"><code><span v-for="(line, i) in visibleLines" :key="i" class="code-line" v-html="line || '&nbsp;'"></span></code></pre>
      <div v-if="lines.length > MAX_LINES" class="content-truncated">
        {{ t('chat.toolCalls.truncatedLines', { n: MAX_LINES }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useHighlight } from "@/composables/useHighlight";

const { t } = useI18n();

const props = defineProps<{
  filePath: string;
  content: string;
}>();

/** 行数上限：防止超大文件撑爆 DOM */
const MAX_LINES = 400;

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

const lineCount = computed(() => props.content.split("\n").length);

const lines = computed(() => highlightCodeLines(props.content, language.value));

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
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-view-meta {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
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
  color: var(--el-text-color-regular);
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
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
