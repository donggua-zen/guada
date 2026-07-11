<template>
  <div
    ref="containerRef"
    class="lite-splitpanes"
    :class="{ 'lite-splitpanes--resizing': isResizing }"
  >
    <!-- 第一个 Pane -->
    <div
      v-show="!isPane1Collapsed"
      ref="pane1Ref"
      class="lite-splitpanes__pane"
      :style="pane1Style"
    >
      <slot name="pane1" />
    </div>

    <!-- 分割条 -->
    <div
      v-show="!isPane1Collapsed && !isPane2Collapsed"
      class="lite-splitpanes__splitter"
      @mousedown="handleSplitterMouseDown"
    />

    <!-- 第二个 Pane -->
    <div
      v-show="!isPane2Collapsed"
      ref="pane2Ref"
      class="lite-splitpanes__pane"
      :style="pane2Style"
    >
      <slot name="pane2" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch, nextTick } from 'vue';

const props = defineProps({
  /** pane1 的百分比尺寸 (0~100)，pane2 = 100 - splitSize */
  splitSize: {
    type: Number,
    default: 75,
  },
  /** pane1 最小百分比 */
  minSize: {
    type: Number,
    default: 0,
  },
  /** pane1 最大百分比 */
  maxSize: {
    type: Number,
    default: 100,
  },
  /** pane2 最小像素宽度 */
  minPane2Size: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits<{
  resize: [size: number]
  resized: [size: number]
}>();

const containerRef = ref<HTMLElement | null>(null);
const pane1Ref = ref<HTMLElement | null>(null);
const pane2Ref = ref<HTMLElement | null>(null);
const isResizing = ref(false);

// 容器实际像素宽度（由 ResizeObserver 实时更新）
const containerWidth = ref(0);

// pane 折叠状态
const isPane1Collapsed = ref(false);
const isPane2Collapsed = ref(false);

const SPLITTER_SIZE = 4;

/**
 * 将 splitSize 钳制到合法范围
 * 100 和 0 是折叠信号，不进行约束钳制
 */
function clampSplitSize(size: number): number {
  if (typeof size !== 'number' || isNaN(size)) return props.minSize;
  if (size >= 100) return 100;
  if (size <= 0) return 0;
  let v = size;
  if (v < props.minSize) v = props.minSize;
  if (v > props.maxSize) v = props.maxSize;
  return v;
}

const currentSplitSize = ref(clampSplitSize(props.splitSize));

/**
 * 计算两个 pane 的实际像素宽度，考虑所有约束
 * 这是唯一的布局计算入口，同时服务于非拖拽态和拖拽态
 * @param applyConstraints 是否应用约束（折叠状态时不应用，否则无法完全折叠）
 */
function computePixelWidths(cw: number, pct: number, applyConstraints = true): { p1Px: number; p2Px: number } {
  const available = cw - SPLITTER_SIZE;
  if (available <= 0) return { p1Px: 0, p2Px: 0 };

  let p1Px = available * pct / 100;
  let p2Px = available - p1Px;

  if (applyConstraints) {
    // pane2 最小百分比约束（来自 max-size）
    const p2MinPct = 100 - props.maxSize;
    let p2Min = 0;
    if (p2MinPct > 0) p2Min = Math.max(p2Min, available * p2MinPct / 100);
    // pane2 最小像素约束
    if (props.minPane2Size > 0) p2Min = Math.max(p2Min, props.minPane2Size);

    if (p2Min > 0 && p2Px < p2Min) {
      p2Px = Math.min(p2Min, available);
      p1Px = available - p2Px;
    }

    // pane1 最小/最大百分比约束
    const p1Min = available * props.minSize / 100;
    const p1Max = available * props.maxSize / 100;
    if (p1Px < p1Min) { p1Px = p1Min; p2Px = available - p1Px; }
    if (p1Px > p1Max) { p1Px = p1Max; p2Px = available - p1Px; }
  }

  // 兜底非负
  p1Px = Math.max(0, p1Px);
  p2Px = Math.max(0, p2Px);

  return { p1Px, p2Px };
}

/**
 * 核心：响应式计算像素宽度，驱动 :style 绑定
 * 依赖 currentSplitSize、containerWidth 和所有约束 props
 * 任何变化都会自动触发重新计算和样式更新
 */
const paneWidths = computed(() => {
  const cw = containerWidth.value;
  if (cw <= 0) return { p1: '0px', p2: '0px' };

  // 折叠状态不应用约束（否则 pane2 像素最小值会阻止完全折叠）
  const isCollapsing = currentSplitSize.value >= 100 || currentSplitSize.value <= 0;
  const { p1Px, p2Px } = computePixelWidths(cw, currentSplitSize.value, !isCollapsing);
  return { p1: p1Px + 'px', p2: p2Px + 'px' };
});

/**
 * Pane1 样式
 */
const pane1Style = computed(() => {
  if (isPane2Collapsed.value) {
    return { flex: '1', minWidth: '0', minHeight: '0' } as any;
  }
  return {
    width: paneWidths.value.p1,
    flexShrink: 0,
  } as any;
});

/**
 * Pane2 样式
 */
const pane2Style = computed(() => {
  if (isPane1Collapsed.value) {
    return { flex: '1', minWidth: '0', minHeight: '0' } as any;
  }
  return {
    width: paneWidths.value.p2,
    flexShrink: 0,
  } as any;
});

// ==================== 拖拽逻辑 ====================

let resizeStartPos = 0;
let resizeStartSize = 0;
let rafId: number | null = null;
let pendingMouseEvent: MouseEvent | null = null;

function handleSplitterMouseDown(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  isResizing.value = true;
  resizeStartPos = e.clientX;

  // 从 DOM 获取实际布局作为拖拽起点
  if (pane1Ref.value && containerRef.value) {
    const cw = containerRef.value.getBoundingClientRect().width;
    const available = cw - SPLITTER_SIZE;
    if (available > 0) {
      const p1Actual = pane1Ref.value.getBoundingClientRect().width;
      resizeStartSize = Math.min(100, Math.max(0, (p1Actual / available) * 100));
    } else {
      resizeStartSize = currentSplitSize.value;
    }
  } else {
    resizeStartSize = currentSplitSize.value;
  }

  document.addEventListener('mousemove', handleSplitterMouseMove);
  document.addEventListener('mouseup', handleSplitterMouseUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function handleSplitterMouseMove(e: MouseEvent) {
  pendingMouseEvent = e;
  if (rafId !== null) return;

  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!pendingMouseEvent) return;
    const ev = pendingMouseEvent;
    pendingMouseEvent = null;

    if (!containerRef.value) return;

    const delta = ev.clientX - resizeStartPos;
    const cw = containerRef.value.getBoundingClientRect().width;
    const available = cw - SPLITTER_SIZE;
    if (available <= 0) return;

    const deltaPct = (delta / available) * 100;
    let newSize = resizeStartSize + deltaPct;

    // 应用 pane1 约束
    newSize = Math.max(newSize, props.minSize);
    newSize = Math.min(newSize, props.maxSize);
    newSize = Math.max(newSize, 0);
    newSize = Math.min(newSize, 100);

    // 应用 pane2 约束（像素最小值 + 百分比最小值）
    const p2MinPct = 100 - props.maxSize;
    let p2Min = 0;
    if (p2MinPct > 0) p2Min = Math.max(p2Min, available * p2MinPct / 100);
    if (props.minPane2Size > 0) p2Min = Math.max(p2Min, props.minPane2Size);
    if (p2Min > 0) {
      const maxPane1Pct = ((available - p2Min) / available) * 100;
      newSize = Math.min(newSize, maxPane1Pct);
    }

    // 更新 currentSplitSize → 触发 paneWidths computed → :style 自动更新
    currentSplitSize.value = newSize;
    emit('resize', newSize);
  });
}

function handleSplitterMouseUp() {
  isResizing.value = false;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingMouseEvent = null;

  document.removeEventListener('mousemove', handleSplitterMouseMove);
  document.removeEventListener('mouseup', handleSplitterMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  // 从 DOM 读取实际布局，同步到 currentSplitSize
  if (pane1Ref.value && containerRef.value) {
    const cw = containerRef.value.getBoundingClientRect().width;
    const available = cw - SPLITTER_SIZE;
    if (available > 0) {
      const p1Actual = pane1Ref.value.getBoundingClientRect().width;
      const p2Actual = pane2Ref.value ? pane2Ref.value.getBoundingClientRect().width : 0;
      const total = p1Actual + p2Actual;
      const pct = total > 0 ? (p1Actual / total) * 100 : 50;
      currentSplitSize.value = Math.min(100, Math.max(0, pct));
    }
  }

  emit('resized', currentSplitSize.value);
}

// ==================== 折叠与尺寸同步 ====================

function updateCollapseState() {
  const size = currentSplitSize.value;
  if (size >= 100) {
    isPane2Collapsed.value = true;
    isPane1Collapsed.value = false;
  } else if (size <= 0) {
    isPane1Collapsed.value = true;
    isPane2Collapsed.value = false;
  } else {
    isPane1Collapsed.value = false;
    isPane2Collapsed.value = false;
  }
}

// 监听 props.splitSize 变化
watch(
  () => props.splitSize,
  (newSize) => {
    if (!isResizing.value) {
      currentSplitSize.value = clampSplitSize(newSize);
      nextTick(() => updateCollapseState());
    }
  },
);

// 容器尺寸变化时更新 containerWidth → 触发 paneWidths 重新计算
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    containerWidth.value = entry.contentRect.width;
  }
  updateCollapseState();
});

watch(containerRef, (el) => {
  if (el) {
    // 初始化容器宽度
    containerWidth.value = el.getBoundingClientRect().width;
    resizeObserver.observe(el);
    updateCollapseState();
  }
});

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  document.removeEventListener('mousemove', handleSplitterMouseMove);
  document.removeEventListener('mouseup', handleSplitterMouseUp);
  resizeObserver.disconnect();
});
</script>

<style scoped>
.lite-splitpanes {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.lite-splitpanes__pane {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  flex-basis: auto;
}

/* 当 pane 没有内联尺寸时（理论上不会发生，兜底） */
.lite-splitpanes__pane:not([style*="width"]):not([style*="height"]) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.lite-splitpanes__splitter {
  flex-shrink: 0;
  width: 4px;
  cursor: col-resize;
  background-color: var(--color-surface, #f5f5f5);
  transition: background-color 0.2s ease;
  position: relative;
}

.lite-splitpanes__splitter:hover {
  background-color: var(--el-color-primary-light-8, #d9ecff);
}

/* 拖拽期间禁用所有过渡动画 */
.lite-splitpanes--resizing,
.lite-splitpanes--resizing * {
  transition: none !important;
}

/* 拖拽期间禁用 iframe 指针事件，防止 iframe 截获鼠标事件导致拖拽中断 */
.lite-splitpanes--resizing :deep(iframe) {
  pointer-events: none !important;
}

/* 暗色模式适配 */
.dark .lite-splitpanes__splitter {
  background-color: #25262a;
}

.dark .lite-splitpanes__splitter:hover {
  background-color: var(--el-color-primary-light-8, #4a4d55);
}

/* 拖拽覆盖层：防止 iframe 截获鼠标事件 */
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 9999;
  cursor: col-resize;
}
</style>