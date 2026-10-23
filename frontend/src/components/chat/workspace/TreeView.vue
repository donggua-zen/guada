<template>
  <!-- 公共目录树组件：扁平行行模型 + 插槽自定义行内容。
       统一处理缩进、chevron、hover/选中/键盘高亮、滚动定位、点击/右键转发。
       文件树（WorkspaceSidebar）与 git 变更树（GitChangesPanel）共用。 -->
  <div ref="scrollRef" class="tree-view-scroll" :class="{ focused }" tabindex="0"
    @scroll.passive="onScroll" @keydown="onKeydown" @focus="focused = true" @blur="focused = false">
    <!-- 固定行高虚拟化：只渲染可视区间，上下用占位高度撑出真实滚动范围。
         文件树/Git 变更树共用，避免数万行一次性挂 DOM。 -->
    <div v-if="visibleRange.topSpacer > 0" :style="{ height: visibleRange.topSpacer + 'px' }" aria-hidden="true" />
    <div v-for="row in visibleRows" :key="row.key" :data-row-key="row.key" class="tree-view-row"
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
    <div v-if="visibleRange.bottomSpacer > 0" :style="{ height: visibleRange.bottomSpacer + 'px' }" aria-hidden="true" />
    <!-- 空态插槽：仅当没有任何行时渲染（有文件/变更时不再显示"暂无文件"等提示） -->
    <template v-if="rows.length === 0">
      <slot name="empty" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";
import { computeTreeViewVisibleRange } from "./treeViewVirtual";

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
  /** 截断提示行（目录条目超过后端上限）：只读，不响应选中 */
  isTruncated?: boolean;
  // 行为开放扩展点：文件树/git 树各自附加 name/path/file 等字段并由插槽盲读，
  // 收敛为 unknown 会把错误推向范围外的插槽模板，故保留 any 并在此说明
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 白名单：动态边界，见上方说明
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

// ── 固定行高虚拟化 ──
/** 与 .tree-view-row 的 height 保持一致；group 行也统一为 26px，否则占位会漂移 */
const ROW_HEIGHT = 26;
const OVERSCAN = 12;
const scrollTop = ref(0);
const viewportHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;

const visibleRange = computed(() =>
  computeTreeViewVisibleRange(
    props.rows.length,
    scrollTop.value,
    viewportHeight.value,
    ROW_HEIGHT,
    OVERSCAN,
  ),
);

const visibleRows = computed(() =>
  props.rows.slice(visibleRange.value.start, visibleRange.value.end),
);

function onScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

onMounted(() => {
  const el = scrollRef.value;
  if (!el) return;
  viewportHeight.value = el.clientHeight;
  resizeObserver = new ResizeObserver(() => {
    viewportHeight.value = el.clientHeight;
  });
  resizeObserver.observe(el);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

// 行数变少（折叠/刷新）时把滚动位置夹回有效范围，避免停在空白区
watch(
  () => props.rows.length,
  () => {
    const el = scrollRef.value;
    if (!el) return;
    const max = Math.max(0, props.rows.length * ROW_HEIGHT - el.clientHeight);
    if (scrollTop.value > max) {
      scrollTop.value = max;
      el.scrollTop = max;
    }
  },
);

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
  const el = scrollRef.value;
  if (!el) return;
  const index = props.rows.findIndex((r) => r.key === key);
  if (index < 0) return;
  const max = Math.max(0, props.rows.length * ROW_HEIGHT - el.clientHeight);
  // 居中定位；越界时夹到两端。行可能未渲染，所以按索引算 scrollTop，不能查 DOM。
  const centered = index * ROW_HEIGHT - (el.clientHeight - ROW_HEIGHT) / 2;
  const target = Math.min(max, Math.max(0, centered));
  el.scrollTop = target;
  scrollTop.value = el.scrollTop;
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
  /* 单行行盒：禁止换行 + 裁剪溢出。
     此行高固定 26px；若不 nowrap，长名称会在行内折行、撑高内容盒，
     而固定 height 下溢出的后半段会画到相邻行上（表现为行与行文字叠在一起）。
     历史教训：行样式原分散在调用方（.git-tree-row 含 white-space:nowrap），
     迁到本组件统一渲染后该约束丢失，导致部分长名称行换行重叠。 */
  white-space: nowrap;
  overflow: hidden;
}

/* ── 行内文本兜底约束（长文件名重叠修复） ──
   现象：同一棵树里有的行正常省略号截断、有的行文字溢出并与相邻行叠加。
   插槽内容（.node-label / .git-tree-name）由调用方通过 #row 提供，样式命中
   取决于调用方是否写全；本组件必须自己兜住，保证任意调用方都获得一致行为：
     - min-width:0  → 允许在 flex 行内收缩（默认 min-width:auto 会撑破行宽）
     - nowrap       → 硬约束：长文本一旦换行会撑高行盒、压到相邻行上
     - ellipsis     → 收缩后用省略号表达"被截断"
   只针对文本容器 span 生效，不干扰调用方插入的 img / el-button。 */
.tree-view-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  /* 与 ROW_HEIGHT 一致：虚拟化按固定行高计算占位，group 行不能更矮 */
  height: 26px;
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
