<template>
  <div class="file-changes-bar">
    <!-- 折叠态：摘要行（对齐 Qoder：图标块 + 半粗标题 + 增删统计） -->
    <div class="fcb__header" @click="expanded = !expanded">
      <span class="fcb__icon-chip">
        <EditIcon class="fcb__icon-glyph" />
      </span>
      <span class="fcb__summary">
        {{ t('chat.fileChanges.summary', { count: changes.length }) }}
      </span>
      <span class="fcb__stats">
        <span class="fcb__added">+{{ totalAdded }}</span>
        <span class="fcb__removed">−{{ totalRemoved }}</span>
      </span>
      <ChevronDown12Regular class="fcb__chevron w-3 h-3" :class="{ 'is-open': expanded }" />
    </div>

    <!-- 展开态：文件列表（点文件名 → 打开文件标签；点行其余部分 → 侧边栏「编辑记录」标签） -->
    <transition name="fcb-expand">
      <div v-if="expanded" class="fcb__list">
        <div
          v-for="entry in changes"
          :key="entry.filePath"
          class="fcb__file-row"
          @click="$emit('openDiff', entry)"
        >
          <span class="fcb__file-path is-link" :title="entry.filePath"
            @click.stop="$emit('openFile', entry)">{{ entry.fileName }}</span>
          <span class="fcb__file-dir">{{ dirPath(entry.filePath) }}</span>
          <span class="fcb__file-stats">
            <span class="fcb__added" v-if="entry.totalAdded">+{{ entry.totalAdded }}</span>
            <span class="fcb__removed" v-if="entry.totalRemoved">−{{ entry.totalRemoved }}</span>
          </span>
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
} from "@vicons/fluent";
import type { FileChangeEntry } from "@/composables/useFileChanges";

const { t } = useI18n();

// Leading edit/diff glyph for the summary chip (inline SVG, no extra dep)
const EditIcon = () =>
  h("svg", { viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg" }, [
    h("path", {
      d: "M11.5 2.5l2 2L6 12l-2.8.8.8-2.8 7.5-7.5z",
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
  openFile: [entry: FileChangeEntry];
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
</script>

<style scoped>
.file-changes-bar {
  margin-top: 8px;
  border: 1px solid var(--gd-color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--gd-color-surface);
  font-size: 12px;
}

.fcb__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.fcb__header:hover {
  background: var(--gd-color-surface-hover);
}

.fcb__icon-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.fcb__icon-glyph {
  /* 14px（偶数）：20px 圆形块内居中余量 3px 整数；13px 会得到 3.5px 半像素 */
  width: 14px;
  height: 14px;
}

.fcb__summary {
  font-size: 13px;
  /* 整数行高：13px 继承 html 的 line-height:1.5 会得到 19.5px 行盒（半像素），
     行盒高度又会把整行/后续内容顶到小数 y 上 */
  line-height: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  flex: 1;
}

.fcb__stats {
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
}

.fcb__chevron {
  color: var(--el-text-color-secondary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.fcb__chevron.is-open {
  transform: rotate(180deg);
}

.fcb__added {
  color: var(--el-color-success);
}

.fcb__removed {
  color: var(--el-color-danger);
}

.fcb__list {
  border-top: 1px solid var(--gd-color-border);
  padding: 4px 0;
}

.fcb__file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.fcb__file-row:hover {
  background: var(--el-fill-color);
}

.fcb__file-path {
  font-size: 13px;
  /* 整数行高：同上，13px 字号的继承行高是 19.5px */
  line-height: 20px;
  color: var(--el-text-color-primary);
  font-weight: 500;
  white-space: nowrap;
}

/* 文件名＝「打开文件」入口：用链接样式提示（hover 主题色 + 下划线），不加 tooltip；
   行的其余部分（目录/增删统计/空白）仍是「编辑记录」入口 */
.fcb__file-path.is-link {
  cursor: pointer;
}

.fcb__file-path.is-link:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
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
