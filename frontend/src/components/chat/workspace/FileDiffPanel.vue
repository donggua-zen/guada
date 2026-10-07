<!-- 编辑记录面板：渲染单个文件在本回合的编辑历史（多次调用 = 多标签）。
     从 FileDiffDialog 抽出，供侧边栏标签与（若保留）弹窗共用。
     数据源是 useFileChanges 从工具参数派生的 FileChangeEntry.operations[]，
     非权威落盘 diff；二进制/办公文件无法逐行比对，走兜底提示。 -->
<template>
  <div class="file-diff-panel">
    <!-- 操作切换标签：同一文件被多次 write/edit 时逐次展示 -->
    <div class="fdp__tabs" v-if="entry && entry.operations.length > 1">
      <button
        v-for="(op, i) in entry.operations"
        :key="op.toolCallId"
        class="fdp__tab"
        :class="{ 'is-active': activeOpIndex === i }"
        @click="activeOpIndex = i"
      >
        <span class="fdp__tab-index">#{{ i + 1 }}</span>
        <span class="fdp__tab-name">{{ op.toolName }}</span>
        <span class="fdp__tab-lines">
          <span class="fdp__add" v-if="op.addedLines">+{{ op.addedLines }}</span>
          <span class="fdp__del" v-if="op.removedLines">−{{ op.removedLines }}</span>
        </span>
      </button>
    </div>

    <!-- 二进制 / 办公文件：无法逐行 diff，仅提示 -->
    <div v-if="!diffable" class="fdp__nodiff">
      <el-icon :size="16"><Info24Regular /></el-icon>
      <span>{{ t('chat.fileChanges.noDiff') }}</span>
    </div>

    <!-- Diff 内容 -->
    <div v-else-if="currentOp" class="fdp__content">
      <div class="fdp__view">
        <table class="fdp__table">
          <tbody>
            <tr
              v-for="(line, i) in diffLines"
              :key="i"
              :class="{
                'is-add': line.type === 'add',
                'is-del': line.type === 'del',
                'is-ctx': line.type === 'ctx',
              }"
            >
              <td class="fdp__sign">{{ line.sign }}</td>
              <td class="fdp__cell" v-html="line.html"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElIcon } from "element-plus";
import { Info24Regular } from "@vicons/fluent";
import { diffLines as computeDiffLines } from "diff";
import { useHighlight } from "@/composables/useHighlight";
import type { FileChangeEntry, FileChangeOperation } from "@/composables/useFileChanges";

const { t } = useI18n();

const props = defineProps<{
  entry: FileChangeEntry | null;
}>();

const { highlightCode, getLanguageFromExtension, escapeHtml } = useHighlight();

const activeOpIndex = ref(0);

// 切换文件时回到首个操作
watch(
  () => props.entry,
  () => {
    activeOpIndex.value = 0;
  },
);

const currentOp = computed<FileChangeOperation | null>(() => {
  if (!props.entry || props.entry.operations.length === 0) return null;
  return props.entry.operations[activeOpIndex.value] || props.entry.operations[0];
});

/** 无法逐行比对的扩展名：办公文档 / 压缩包 / 位图 / 媒体 / 常见二进制产物 */
const NON_DIFFABLE_EXT = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "pdf", "zip", "rar", "7z", "gz", "tar", "bz2", "xz",
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "tiff", "svg",
  "mp3", "mp4", "avi", "mov", "mkv", "wav", "flac",
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "war", "pdb",
  "ttf", "otf", "woff", "woff2", "eot",
]);

const diffable = computed(() => {
  if (!props.entry) return false;
  const dotIdx = props.entry.filePath.lastIndexOf(".");
  if (dotIdx === -1) return true; // 无扩展名：按文本处理
  const ext = props.entry.filePath.slice(dotIdx + 1).toLowerCase();
  return !NON_DIFFABLE_EXT.has(ext);
});

const language = computed(() => {
  if (!props.entry) return "plaintext";
  const dotIdx = props.entry.filePath.lastIndexOf(".");
  if (dotIdx === -1) return "plaintext";
  const ext = props.entry.filePath.slice(dotIdx);
  return getLanguageFromExtension(ext) || "plaintext";
});

interface DiffLine {
  type: "add" | "del" | "ctx";
  sign: string;
  html: string;
}

const diffLines = computed<DiffLine[]>(() => {
  if (!currentOp.value) return [];
  const op = currentOp.value;
  const oldText = op.oldText || "";
  const newText = op.newText || "";
  if (!oldText && !newText) return [];

  const parts = computeDiffLines(oldText, newText);
  const result: DiffLine[] = [];
  for (const part of parts) {
    const text = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    for (const line of text.split("\n")) {
      if (part.added) {
        result.push({ type: "add", sign: "+", html: highlightLine(line) });
      } else if (part.removed) {
        result.push({ type: "del", sign: "−", html: highlightLine(line) });
      } else {
        result.push({ type: "ctx", sign: " ", html: highlightLine(line) });
      }
    }
  }
  return result;
});

function highlightLine(line: string): string {
  if (!line) return "&nbsp;";
  try {
    const highlighted = highlightCode(line, language.value);
    const match = highlighted.match(/<div class="line-content">(.*?)<\/div>/s);
    if (match) return match[1];
    return escapeHtml(line);
  } catch {
    return escapeHtml(line);
  }
}
</script>

<style scoped>
.file-diff-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 12px;
  padding: 12px;
  font-size: 14px;
}

/* 操作切换标签 */
.fdp__tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.fdp__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.fdp__tab:hover {
  background: var(--el-fill-color);
}

.fdp__tab.is-active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}

.fdp__tab-index {
  color: var(--el-text-color-placeholder);
}

.fdp__tab-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.fdp__tab-lines {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  display: flex;
  gap: 6px;
}

.fdp__add {
  color: var(--el-color-success);
}

.fdp__del {
  color: var(--el-color-danger);
}

/* 二进制兜底 */
.fdp__nodiff {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

/* Diff 内容 */
.fdp__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.fdp__view {
  border-radius: 4px;
  background: var(--el-bg-color);
}

.fdp__table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 14px;
  line-height: 22px;
}

.fdp__table td {
  padding: 0;
  vertical-align: top;
}

.fdp__sign {
  width: 20px;
  min-width: 20px;
  text-align: center;
  user-select: none;
}

.fdp__cell {
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.is-add {
  background: rgba(var(--el-color-success-rgb, 103, 194, 58), 0.08);
}
.is-add .fdp__sign {
  color: var(--el-color-success);
}

.is-del {
  background: rgba(var(--el-color-danger-rgb, 245, 108, 108), 0.08);
}
.is-del .fdp__sign {
  color: var(--el-color-danger);
}

.is-ctx {
  background: transparent;
}
.is-ctx .fdp__sign {
  color: var(--el-text-color-placeholder);
}
</style>
