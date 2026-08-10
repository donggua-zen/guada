<template>
  <div class="file-changes-bar">
    <!-- 折叠态：摘要行 -->
    <div class="fcb__header" @click="expanded = !expanded">
      <span class="fcb__summary">
        {{ t('chat.fileChanges.summary', { count: changes.length }) }}
      </span>
      <span class="fcb__stats">
        <span class="fcb__added">+{{ totalAdded }}</span>
        <span class="fcb__removed">−{{ totalRemoved }}</span>
      </span>
    </div>

    <!-- 展开态：文件列表 -->
    <transition name="fcb-expand">
      <div v-if="expanded" class="fcb__list">
        <div
          v-for="entry in changes"
          :key="entry.filePath"
          class="fcb__file-row"
          @click="openFile(entry.filePath)"
        >
          <span class="fcb__file-path" :title="entry.filePath">{{ entry.fileName }}</span>
          <span class="fcb__file-dir">{{ dirPath(entry.filePath) }}</span>
          <span class="fcb__file-stats">
            <span class="fcb__added" v-if="entry.totalAdded">+{{ entry.totalAdded }}</span>
            <span class="fcb__removed" v-if="entry.totalRemoved">−{{ entry.totalRemoved }}</span>
          </span>
          <button
            class="fcb__diff-btn"
            :title="t('chat.fileChanges.viewDiff')"
            @click.stop="$emit('openDiff', entry)"
          >
            <DiffIcon class="fcb__diff-icon" />
            <span>Diff</span>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown12Regular,
  ChevronRight12Regular,
} from "@vicons/fluent";
import { previewFile } from "@/utils/workspacePreview";
import type { FileChangeEntry } from "@/composables/useFileChanges";

const { t } = useI18n();

// Inline diff icon (simple SVG, no extra dep)
const DiffIcon = () =>
  h("svg", { viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg" }, [
    h("path", {
      d: "M4 2v12M4 2L2 4M4 2l2 2M12 14V2M12 14l2-2M12 14l-2-2",
      stroke: "currentColor",
      "stroke-width": "1.3",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);

const props = defineProps<{
  changes: FileChangeEntry[];
}>();

defineEmits<{
  openDiff: [entry: FileChangeEntry];
}>();

const expanded = ref(false);

const totalAdded = computed(() =>
  props.changes.reduce((sum, e) => sum + e.totalAdded, 0),
);
const totalRemoved = computed(() =>
  props.changes.reduce((sum, e) => sum + e.totalRemoved, 0),
);

function dirPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function openFile(filePath: string) {
  previewFile(filePath);
}
</script>

<style scoped>
.file-changes-bar {
  margin-top: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-surface);
  font-size: 12px;
}

.fcb__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.fcb__header:hover {
  background: var(--color-surface-hover);
}

.fcb__icon {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.fcb__doc-icon {
  width: 15px;
  height: 15px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.fcb__summary {
  font-size: 13px;
  color: var(--el-text-color-regular);
  flex: 1;
}

.fcb__stats {
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.fcb__added {
  color: var(--el-color-success);
}

.fcb__removed {
  color: var(--el-color-danger);
}

.fcb__list {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 4px 0;
}

.fcb__file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.fcb__file-row:hover {
  background: var(--el-fill-color);
}

.fcb__file-icon {
  display: flex;
  align-items: center;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.fcb__file-path {
  font-size: 13px;
  color: var(--el-text-color-primary);
  font-weight: 500;
  white-space: nowrap;
}

.fcb__file-dir {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.fcb__file-stats {
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  flex-shrink: 0;
}

.fcb__diff-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  transition: all 0.15s;
  flex-shrink: 0;
}

.fcb__diff-btn:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.fcb__diff-icon {
  width: 12px;
  height: 12px;
}

.fcb__ops {
  color: var(--el-text-color-placeholder);
}

/* 展开动画 */
.fcb-expand-enter-active,
.fcb-expand-leave-active {
  transition: all 0.2s ease;
  max-height: 500px;
  opacity: 1;
}

.fcb-expand-enter-from,
.fcb-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
