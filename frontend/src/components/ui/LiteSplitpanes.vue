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
  /** pane1 最小百分比（拖拽和初始化时均会 clamp 到此值以上） */
  minSize: {
    type: Number,
    default: 0,
  },
  /** pane1 最大百分比（拖拽和初始化时均会 clamp 到此值以下） */
  maxSize: {
    type: Number,
    default: 100,
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

/**
 * 将 splitSize 钳制到合法范围 [minSize, maxSize] ∩ [0, 100]
 * 对 NaN / undefined / 非法旧数据做兜底
 */
function clampSplitSize(size: number): number {
  if (typeof size !== 'number' || isNaN(size)) return props.minSize;
  let v = size;
  if (v < 0) v = 0;
  if (v > 100) v = 100;
  if (v < props.minSize) v = props.minSize;
  if (v > props.maxSize) v = props.maxSize;
  return v;
}

// 响应式拆分明细（非拖拽时与 props 同步）
const clampedSize = computed(() => clampSplitSize(props.splitSize));
const currentSplitSize = ref(clampSplitSize(props.splitSize));

// pane 折叠状态
const isPane1Collapsed = ref(false);
const isPane2Collapsed = ref(false);

const SPLITTER_SIZE = 4;

function calcPctWithSplitter(pct: number): string {
  const share = SPLITTER_SIZE * pct / 100;
  return "calc(" + pct + "% - " + share + "px)";
}

/**
 * Pane1 样式
 */
const pane1Style = computed(() => {
  if (isPane2Collapsed.value) {
    return { flex: '1', minWidth: '0', minHeight: '0' } as any;
  }
  return {
    width: calcPctWithSplitter(currentSplitSize.value),
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
    width: calcPctWithSplitter(100 - currentSplitSize.value),
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
  resizeStartSize = currentSplitSize.value;

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

    if (!containerRef.value || !pane1Ref.value || !pane2Ref.value) return;

    const delta = ev.clientX - resizeStartPos;
    const containerWidth = containerRef.value.getBoundingClientRect().width;
    if (containerWidth === 0) return;

    const availableSpace = containerWidth - SPLITTER_SIZE;
    if (availableSpace <= 0) return;

    const deltaPercent = (delta / availableSpace) * 100;
    let newSize = resizeStartSize + deltaPercent;

    // 应用 min/max 限制，同时保证 pane2 >= 0
    if (newSize < props.minSize) newSize = props.minSize;
    if (newSize > props.maxSize) newSize = props.maxSize;
    if (newSize < 0) newSize = 0;
    if (newSize > 100) newSize = 100;

    // 直接操作 DOM 避免 Vue 响应式开销
    const p1Px = availableSpace * newSize / 100;
    const p2Px = availableSpace * (100 - newSize) / 100;
    pane1Ref.value.style.width = p1Px + 'px';
    pane2Ref.value.style.width = p2Px + 'px';

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

  // 从 DOM 读取最终尺寸同步到响应式状态
  if (pane1Ref.value && containerRef.value) {
    const containerWidth = containerRef.value.getBoundingClientRect().width;
    const availableSpace = containerWidth - SPLITTER_SIZE;
    if (availableSpace > 0) {
      const p1Px = parseFloat(pane1Ref.value.style.width || '0');
      currentSplitSize.value = (p1Px / availableSpace) * 100;
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

// 容器尺寸变化时重新计算折叠状态
const resizeObserver = new ResizeObserver(() => {
  updateCollapseState();
});

watch(containerRef, (el) => {
  if (el) {
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

/* 暗色模式适配 */
.dark .lite-splitpanes__splitter {
  background-color: #25262a;
}

.dark .lite-splitpanes__splitter:hover {
  background-color: var(--el-color-primary-light-8, #4a4d55);
}
</style>
