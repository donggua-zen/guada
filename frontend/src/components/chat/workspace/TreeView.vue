<template>
  <!-- 公共目录树组件：扁平行行模型 + 插槽自定义行内容。
       统一处理缩进、chevron、hover/选中/键盘高亮、滚动定位、点击/右键转发。
       文件树（WorkspaceSidebar）与 git 变更树（GitChangesPanel）共用。 -->
  <div ref="scrollRef" class="tree-view-scroll" :class="{ focused }" tabindex="0"
    @keydown="onKeydown" @focus="focused = true" @blur="focused = false">
    <div v-for="row in rows" :key="row.key" :data-row-key="row.key" class="tree-view-row"
      :class="{
        'tree-view-row--dir': row.isDir,
        'tree-view-row--group': row.isGroup,
        'is-selected': selectedKey === row.key,
        'is-active': activeKey === row.key,
      }"
      :style="{ paddingLeft: 8 + row.depth * indent + 'px', '--indent': row.depth * indent + 'px' }"
      @click="onRowClick(row)" @dblclick="onRowDblClick(row)" @contextmenu.prevent="(e) => emit('contextmenu', e, row)">
      <!-- 组头行：纯标题，无 chevron / 无选中 -->
      <template v-if="row.isGroup">
        <slot name="row" :row="row" :collapsed="false" />
      </template>
      <!-- 目录行 chevron（展开旋转 90°）；文件行占位对齐 -->
      <template v-else>
        <span v-if="row.isDir" class="tree-view-chevron" :class="{ expanded: !isCollapsed(row) }"
          @click.stop="onToggle(row)">
          <el-icon :size="12"><ArrowRight /></el-icon>
        </span>
        <span v-else class="tree-view-chevron-placeholder" />
        <!-- 行内容插槽：图标 / 名称 / 操作按钮由调用方提供 -->
        <slot name="row" :row="row" :collapsed="isCollapsed(row)" />
      </template>
    </div>
    <!-- 空态插槽：仅当没有任何行时渲染（有文件/变更时不再显示"暂无文件"等提示） -->
    <template v-if="rows.length === 0">
      <slot name="empty" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, type CSSProperties } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";

/**
 * 扁平行树节点：key 唯一标识（如 'path' 或 'group:path'）、depth 缩进层级、
 * isDir 是否为目录行。其余字段（name/path/row 等）由调用方附加，插槽读取。
 */
export interface TreeViewRow {
  key: string;
  depth: number;
  isDir: boolean;
  /** 组头行（git 变更树的分组标题）：不参与选中/折叠，仅展示 */
  isGroup?: boolean;
  [k: string]: any;
}

const props = withDefaults(
  defineProps<{
    rows: TreeViewRow[];
    /** 当前选中行 key（高亮用；文件行才应选中，目录行传 null 无碍） */
    selectedKey?: string | null;
    /** 键盘导航高亮行 key（可选，与选中区分：VS Code 风格焦点行） */
    activeKey?: string | null;
    /** 折叠的目录 key 集合：在集合中 = 折叠（chevron 右向） */
    collapsedKeys?: Set<string>;
    /** 每层缩进 px（默认 14，与 git 树一致） */
    indent?: number;
    /** 是否启用方向键键盘导航（可选；git 树启用，文件树可关） */
    keyboardNav?: boolean;
  }>(),
  {
    selectedKey: null,
    activeKey: null,
    collapsedKeys: undefined,
    indent: 14,
    keyboardNav: false,
  },
);

const emit = defineEmits<{
  select: [row: TreeViewRow];
  /** 文件行双击（目录/组头不触发）：调用方用于"固定为持久标签"等语义 */
  dblclick: [row: TreeViewRow];
  toggle: [row: TreeViewRow, expanded: boolean];
  contextmenu: [event: MouseEvent, row: TreeViewRow];
}>();

const scrollRef = ref<HTMLElement | null>(null);
const focused = ref(false);

function isCollapsed(row: TreeViewRow): boolean {
  return !!props.collapsedKeys?.has(row.key);
}

function onRowClick(row: TreeViewRow): void {
  if (row.isGroup) return; // 组头不响应
  if (row.isDir) {
    onToggle(row);
    return;
  }
  emit("select", row);
}

/** 双击仅对文件行生效（目录行由单击展开/折叠） */
function onRowDblClick(row: TreeViewRow): void {
  if (row.isGroup || row.isDir) return;
  emit("dblclick", row);
}

function onToggle(row: TreeViewRow): void {
  // expanded 参数 = 目标展开状态：当前折叠(在 collapsedKeys 中) → 展开 true；
  // 当前展开 → 折叠 false。父组件按此更新折叠集合。
  emit("toggle", row, isCollapsed(row));
}

// ── 键盘导航（方向键移动/Home/End 跳首尾/Enter 确认，VS Code 风格） ──
const flatSelectable = computed(() =>
  props.rows.filter((r) => !r.isDir && !r.isGroup),
);

function onKeydown(e: KeyboardEvent): void {
  if (!props.keyboardNav) return;
  const list = flatSelectable.value;
  if (!list.length) return;
  let curIdx = list.findIndex((r) => r.key === (props.activeKey ?? props.selectedKey));
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      curIdx = curIdx < 0 ? 0 : Math.min(curIdx + 1, list.length - 1);
      emit("select", list[curIdx]);
      break;
    case "ArrowUp":
      e.preventDefault();
      curIdx = curIdx < 0 ? list.length - 1 : Math.max(curIdx - 1, 0);
      emit("select", list[curIdx]);
      break;
    case "Home":
      e.preventDefault();
      emit("select", list[0]);
      break;
    case "End":
      e.preventDefault();
      emit("select", list[list.length - 1]);
      break;
    case "Enter": {
      e.preventDefault();
      const anchorKey = props.activeKey ?? props.selectedKey;
      const row = anchorKey ? props.rows.find((r) => r.key === anchorKey) : list[0];
      if (!row) return;
      if (row.isDir) {
        // 同 onToggle：当前折叠 → 展开；当前展开 → 折叠
        emit("toggle", row, isCollapsed(row));
      } else {
        emit("select", row);
      }
      break;
    }
  }
}

/** 滚动到指定行（键盘/定位场景；行不存在则忽略） */
function scrollToKey(key: string): void {
  const el = scrollRef.value?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

watch(
  () => props.activeKey,
  (k) => {
    if (k) void nextTick(() => scrollToKey(k));
  },
);

defineExpose({ scrollToKey });
</script>

<style scoped>
.tree-view-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  outline: none;
}

.tree-view-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--gd-color-text);
  transition: background-color 0.15s;
  user-select: none;
  box-sizing: border-box;
}

/* 缩进指引竖线：每层缩进一条 1px 线，线画在格子中心（6-7px 段），
   depth=0 时 --indent=0px 宽度为 0 不显示；行间 margin 处自然断开 */
.tree-view-row::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 0;
  bottom: 0;
  width: var(--indent, 0px);
  background: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent 6px,
    var(--gd-color-border, #e5e7eb) 6px,
    var(--gd-color-border, #e5e7eb) 7px,
    transparent 7px,
    transparent 14px
  );
  pointer-events: none;
}

.tree-view-row:hover {
  background: var(--gd-color-sidebar-bg-hover);
}

/* 键盘导航高亮行：方向键移动，无需鼠标悬停即可见 */
.tree-view-row.is-active {
  background: var(--gd-color-conversation-bg-active);
}

/* 选中行：与 hover 同一颜色（微透明），不加深 */
.tree-view-row.is-selected {
  background: var(--gd-color-sidebar-bg-hover);
}

.tree-view-row--dir {
  font-weight: 500;
}

/* 组头行：小号标题、灰色，不响应 hover/选中 */
.tree-view-row--group {
  font-size: 11px;
  font-weight: 500;
  color: var(--gd-color-text-gray);
  cursor: default;
  height: 24px;
}

.tree-view-row--group:hover {
  background: transparent;
}

.tree-view-row--group.is-selected,
.tree-view-row--group.is-active {
  background: transparent;
}

.tree-view-chevron {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  color: var(--gd-color-text-disabled);
  transition: transform 0.15s ease;
}

.tree-view-chevron.expanded {
  transform: rotate(90deg);
}

.tree-view-chevron-placeholder {
  flex-shrink: 0;
  width: 12px;
}

.dark .tree-view-row::before {
  border-color: var(--gd-color-surface-border, #2e3035);
}
</style>
