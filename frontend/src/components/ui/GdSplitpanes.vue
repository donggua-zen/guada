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
    >
      <div class="lite-splitpanes__hit-area" />
    </div>

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

  <!-- 拖拽时全屏遮罩，阻止鼠标事件穿透到下层元素 -->
  <Teleport to="body">
    <div v-if="isResizing" class="lite-splitpanes-drag-overlay"></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch, nextTick, type CSSProperties } from 'vue';
import { beginResizeActivity } from '@/composables/useResizeActivity';
import {
  SPLITTER_SIZE,
  computePixelModeWidths as computePixelModeWidthsPure,
  computePercentModeWidths as computePercentModeWidthsPure,
} from './splitpanesMath';

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
  /**
   * pane2 固定像素宽度：给定数字时按像素定宽 pane2、pane1 吃剩余空间，
   * 忽略 splitSize/minSize/maxSize 的百分比语义。用于「右侧栏宽度固定、左侧预览弹性」
   * 这类布局（Git 审阅面板）：窗口缩放时固定侧不变，不再需要父组件每帧把像素换算成
   * 百分比再喂回来。
   *
   * 数字 0 是合法值（= 完全收起 pane2），因此「未启用」必须用 undefined 表达，
   * 不能靠 0 判断。
   */
  pane2Px: {
    type: Number,
    default: undefined,
  },
  /** pane1 最小像素宽度（仅 pane2Px 模式下生效，替代百分比 minSize） */
  minPane1Size: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits<{
  resize: [size: number]
  resized: [size: number]
  /** pane2Px 模式下的拖拽结束：回传 pane2 的实际像素宽度 */
  'pane2-resized': [px: number]
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

/** pane2 像素模式的当前值（拖拽期间实时更新；props.pane2Px 变化时同步）。 */
const currentPane2Px = ref(props.pane2Px ?? 0);

/** 是否处于「pane2 固定像素」模式 */
const isPixelMode = computed(() => typeof props.pane2Px === 'number');

/**
 * 像素模式：pane2 定宽、pane1 吃剩余空间。
 * 计算细节与边界约定见 splitpanesMath.ts 的 computePixelModeWidths。
 */
function computePixelModeWidths(cw: number, pane2Px: number): { p1Px: number; p2Px: number } {
  return computePixelModeWidthsPure(cw, pane2Px, {
    minPane1Size: props.minPane1Size,
    minPane2Size: props.minPane2Size,
  });
}

/**
 * 百分比模式：按 pane1 百分比计算，应用约束并让 pane2 落偶数。
 * 计算细节见 splitpanesMath.ts 的 computePercentModeWidths。
 *
 * @param applyConstraints 是否应用约束（折叠状态时不应用，否则无法完全折叠）
 */
function computePixelWidths(cw: number, pct: number, applyConstraints = true): { p1Px: number; p2Px: number } {
  return computePercentModeWidthsPure(cw, pct, {
    applyConstraints,
    minSize: props.minSize,
    maxSize: props.maxSize,
    minPane2Size: props.minPane2Size,
  });
}

/**
 * 核心：响应式计算像素宽度，驱动 :style 绑定
 * 依赖 currentSplitSize、containerWidth 和所有约束 props
 * 任何变化都会自动触发重新计算和样式更新
 */
const paneWidths = computed(() => {
  const cw = containerWidth.value;
  if (cw <= 0) return { p1: '0px', p2: '0px' };

  // 像素模式：pane2 定宽、pane1 吃剩余（窗口缩放时固定侧不变）
  if (isPixelMode.value) {
    const { p1Px, p2Px } = computePixelModeWidths(cw, currentPane2Px.value);
    return { p1: p1Px + 'px', p2: p2Px + 'px' };
  }

  // 折叠状态不应用约束（否则 pane2 像素最小值会阻止完全折叠）
  const isCollapsing = currentSplitSize.value >= 100 || currentSplitSize.value <= 0;
  const { p1Px, p2Px } = computePixelWidths(cw, currentSplitSize.value, !isCollapsing);
  return { p1: p1Px + 'px', p2: p2Px + 'px' };
});

/**
 * Pane1 样式
 */
const pane1Style = computed<CSSProperties>(() => {
  if (isPane2Collapsed.value) {
    return { flex: '1', minWidth: '0', minHeight: '0' };
  }
  return {
    width: paneWidths.value.p1,
    flexShrink: 0,
  };
});

/**
 * Pane2 样式
 */
const pane2Style = computed<CSSProperties>(() => {
  if (isPane1Collapsed.value) {
    return { flex: '1', minWidth: '0', minHeight: '0' };
  }
  return {
    width: paneWidths.value.p2,
    flexShrink: 0,
  };
});

// ==================== 拖拽逻辑 ====================

let resizeStartPos = 0;
let resizeStartSize = 0;
let resizeStartPane2Px = 0;
let rafId: number | null = null;
let pendingMouseEvent: MouseEvent | null = null;
/** 拖拽期间持有的全局调整态票据（mouseup / 卸载时归还）。 */
let releaseResizeActivity: (() => void) | null = null;

function handleSplitterMouseDown(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  isResizing.value = true;
  releaseResizeActivity = beginResizeActivity();
  resizeStartPos = e.clientX;

  // 从 DOM 获取实际布局作为拖拽起点
  if (pane1Ref.value && containerRef.value) {
    const cw = containerRef.value.getBoundingClientRect().width;
    const available = cw - SPLITTER_SIZE;
    if (available > 0) {
      const p1Actual = pane1Ref.value.getBoundingClientRect().width;
      resizeStartSize = Math.min(100, Math.max(0, (p1Actual / available) * 100));
      const p2Actual = pane2Ref.value ? pane2Ref.value.getBoundingClientRect().width : 0;
      resizeStartPane2Px = Math.round(p2Actual);
    } else {
      resizeStartSize = currentSplitSize.value;
      resizeStartPane2Px = currentPane2Px.value;
    }
  } else {
    resizeStartSize = currentSplitSize.value;
    resizeStartPane2Px = currentPane2Px.value;
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
    // 用 ResizeObserver 维护的容器宽，而不是每帧 getBoundingClientRect：
    // 后者紧跟上一帧的 style 写入，等于每帧插入一次强制同步布局。
    // 拖拽期间容器宽恒定，只有窗口尺寸变化才会动它。
    const cw = containerWidth.value || containerRef.value.getBoundingClientRect().width;
    const available = cw - SPLITTER_SIZE;
    if (available <= 0) return;

    // 像素模式：分割条左移 = pane2 变宽，故取负 delta
    if (isPixelMode.value) {
      const nextPane2Px = computePixelModeWidths(cw, resizeStartPane2Px - delta).p2Px;
      currentPane2Px.value = nextPane2Px;
      emit('resize', nextPane2Px);
      return;
    }

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
  releaseResizeActivity?.();
  releaseResizeActivity = null;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingMouseEvent = null;

  document.removeEventListener('mousemove', handleSplitterMouseMove);
  document.removeEventListener('mouseup', handleSplitterMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  // 从 DOM 读取实际布局，同步到内部尺寸状态
  if (pane1Ref.value && containerRef.value) {
    const cw = containerRef.value.getBoundingClientRect().width;
    const available = cw - SPLITTER_SIZE;
    if (available > 0) {
      const p1Actual = pane1Ref.value.getBoundingClientRect().width;
      const p2Actual = pane2Ref.value ? pane2Ref.value.getBoundingClientRect().width : 0;
      const total = p1Actual + p2Actual;

      if (isPixelMode.value) {
        // 像素模式：落定 pane2 实际像素，父组件据此持久化
        currentPane2Px.value = Math.round(p2Actual);
        emit('pane2-resized', currentPane2Px.value);
      }

      const pct = total > 0 ? (p1Actual / total) * 100 : 50;
      currentSplitSize.value = Math.min(100, Math.max(0, pct));
    }
  }

  emit('resized', currentSplitSize.value);
}

// ==================== 折叠与尺寸同步 ====================

function updateCollapseState() {
  // 像素模式：折叠由 pane2 像素宽驱动（0 = 收起），与百分比语义相反——
  // 百分比模式里 splitSize=100 表示「pane2 收起」，像素模式里 pane2=0 才是收起。
  // 不单独映射的话，「收起目录树」后 1px 分割条会残留在最右缘。
  if (isPixelMode.value) {
    const p2 = Math.round(currentPane2Px.value);
    isPane2Collapsed.value = p2 <= 0;
    isPane1Collapsed.value = false;
    return;
  }

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

// 像素模式：外部 pane2Px 变化（持久化值、重置等）同步到内部状态。
// 拖拽中不跟随：拖拽期间的真相是鼠标位置，外部值要等 mouseup 后才重新对齐。
watch(
  () => props.pane2Px,
  (px) => {
    if (!isResizing.value && typeof px === 'number') {
      currentPane2Px.value = px;
      // 收起/展开由像素宽驱动，必须同步折叠态（否则分割条残留或 pane 被误隐藏）
      nextTick(() => updateCollapseState());
    }
  },
  { immediate: true },
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
  // 拖拽中被卸载（切换标签/会话）：必须归还调整态票据，否则 html.gd-resizing 永不摘除
  releaseResizeActivity?.();
  releaseResizeActivity = null;
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
  width: 1px;
  cursor: col-resize;
  /* 竖线两端各渐隐 36px（与 Windows 标题栏行等高）：面板贴窗口顶/底时
     线头生硬，渐隐后由窗口边缘自然过渡。hover/拖拽高亮走 background-color
     （实色叠加在渐变之上，见下方两处规则），渐变本体保留在 background-image */
  background-image: linear-gradient(
    to bottom,
    transparent 0,
    var(--gd-color-border, #f5f5f5) 36px,
    var(--gd-color-border, #f5f5f5) calc(100% - 36px),
    transparent 100%
  );
  transition: background-color 0.2s ease;
  position: relative;
  z-index: 10;
}

/* 透明 4px 命中区，真实 DOM 元素确保跨 pane 边界的 hit-testing 可靠 */
.lite-splitpanes__hit-area {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
}

/* hover 高亮：实色画在渐变之上（background-color 位于 background-image 下层，
   直接改 background-color 会被渐变盖住，因此用 ::after 覆盖整条线） */
.lite-splitpanes__splitter::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: transparent;
  transition: background-color 0.2s ease;
  pointer-events: none;
}

.lite-splitpanes__splitter:hover {
  background-color: transparent;
}

.lite-splitpanes__splitter:hover::after {
  background-color: var(--gd-color-primary-200);
}

/* 拖拽中持续高亮分割线，即使鼠标移出分割条区域 */
.lite-splitpanes--resizing .lite-splitpanes__splitter {
  background-color: transparent;
}

.lite-splitpanes--resizing .lite-splitpanes__splitter::after {
  background-color: var(--gd-color-primary-200);
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
  background-image: linear-gradient(
    to bottom,
    transparent 0,
    #25262a 36px,
    #25262a calc(100% - 36px),
    transparent 100%
  );
}

.dark .lite-splitpanes__splitter:hover {
  background-color: transparent;
}

.dark .lite-splitpanes__splitter:hover::after {
  background-color: var(--gd-color-primary-200);
}

/* 拖拽时全屏遮罩，阻止下层元素收到 hover/mousemove 事件 */
.lite-splitpanes-drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  cursor: col-resize;
}
</style>