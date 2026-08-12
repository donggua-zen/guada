<template>
  <LDialog
    v-model="visible"
    :title="dialogTitle"
    width="46.5rem"
    :close-on-click-modal="true"
    append-to-body
    destroy-on-close
  >
    <div class="diff-dialog__body">
      <!-- 上下文按钮区 -->
      <div class="diff-dialog__tabs" v-if="entry && entry.operations.length > 1">
        <button
          v-for="(op, i) in entry.operations"
          :key="op.toolCallId"
          class="diff-tab"
          :class="{ 'diff-tab--active': activeOpIndex === i }"
          @click="activeOpIndex = i"
        >
          <span class="diff-tab__index">#{{ i + 1 }}</span>
          <span class="diff-tab__name">{{ op.toolName }}</span>
          <span class="diff-tab__lines">
            <span class="text-green" v-if="op.addedLines">+{{ op.addedLines }}</span>
            <span class="text-red" v-if="op.removedLines">−{{ op.removedLines }}</span>
          </span>
        </button>
      </div>

      <!-- Diff 内容 -->
      <div class="diff-dialog__content" v-if="currentOp">
        <div class="diff-view">
          <table class="diff-table">
            <tbody>
              <tr
                v-for="(line, i) in diffLines"
                :key="i"
                :class="{
                  'diff-line--add': line.type === 'add',
                  'diff-line--del': line.type === 'del',
                  'diff-line--ctx': line.type === 'ctx',
                }"
              >
                <td class="diff-line__sign">{{ line.sign }}</td>
                <td class="diff-line__content" v-html="line.html"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </LDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import LDialog from "@/components/ui/LDialog.vue";
import { useI18n } from "vue-i18n";
import { diffLines as computeDiffLines } from "diff";
import { useHighlight } from "@/composables/useHighlight";
import type { FileChangeEntry, FileChangeOperation } from "@/composables/useFileChanges";

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  entry: FileChangeEntry | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [val: boolean];
}>();

const { highlightCode, getLanguageFromExtension, escapeHtml } = useHighlight();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const activeOpIndex = ref(0);

watch(
  () => props.modelValue,
  (v) => {
    if (v) activeOpIndex.value = 0;
  },
);

const dialogTitle = computed(() => {
  if (!props.entry) return t('chat.fileChanges.dialogTitle');
  return t('chat.fileChanges.dialogTitleWithName', { name: props.entry.fileName });
});

const currentOp = computed<FileChangeOperation | null>(() => {
  if (!props.entry || props.entry.operations.length === 0) return null;
  return props.entry.operations[activeOpIndex.value] || props.entry.operations[0];
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
    const lines = text.split("\n");

    for (const line of lines) {
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
    // highlightCode 返回 HTML，拆出第一行的内容
    const highlighted = highlightCode(line, language.value);
    // highlightCode 包裹了 <pre><code>...<div class="line">..., 提取 .line-content 内容
    const match = highlighted.match(/<div class="line-content">(.*?)<\/div>/s);
    if (match) return match[1];
    // 降级：直接 escape
    return escapeHtml(line);
  } catch {
    return escapeHtml(line);
  }
}
</script>

<style scoped>
.diff-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 操作切换 tabs */
.diff-dialog__tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.diff-tab {
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

.diff-tab:hover {
  background: var(--el-fill-color);
}

.diff-tab--active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}

.diff-tab__index {
  color: var(--el-text-color-placeholder);
}

.diff-tab__name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.diff-tab__lines {
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  display: flex;
  gap: 6px;
}

.text-green {
  color: var(--el-color-success);
}

.text-red {
  color: var(--el-color-danger);
}

/* Diff 表格 */
.diff-view {
  /* border: 1px solid var(--el-border-color); */
  border-radius: 4px;
  background: var(--el-bg-color);
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 13px;
  line-height: 1.6;
}

.diff-table td {
  padding: 0;
  vertical-align: top;
}

.diff-line__sign {
  width: 20px;
  min-width: 20px;
  text-align: center;
  user-select: none;
}

.diff-line__content {
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 行背景 */
.diff-line--add {
  background: rgba(var(--el-color-success-rgb, 103, 194, 58), 0.08);
}

.diff-line--add .diff-line__sign {
  color: var(--el-color-success);
}

.diff-line--del {
  background: rgba(var(--el-color-danger-rgb, 245, 108, 108), 0.08);
}

.diff-line--del .diff-line__sign {
  color: var(--el-color-danger);
}

.diff-line--ctx {
  background: transparent;
}

.diff-line--ctx .diff-line__sign {
  color: var(--el-text-color-placeholder);
}
</style>
