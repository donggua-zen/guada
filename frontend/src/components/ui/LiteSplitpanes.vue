<template>
  <div
    ref="containerRef"
    class="lite-splitpanes"
    :class="{
      'lite-splitpanes--horizontal': horizontal,
      'lite-splitpanes--resizing': isResizing
    }"
  >
    <!-- 第一个 Pane -->
    <div
      ref="pane1Ref"
      class="lite-splitpanes__pane"
      :style="pane1Style"
    >
      <slot name="pane1" />
    </div>

    <!-- 分割条 -->
    <div
      class="lite-splitpanes__splitter"
      :class="{ 'lite-splitpanes__splitter--horizontal': horizontal }"
      @mousedown="handleSplitterMouseDown"
    />

    <!-- 第二个 Pane -->
    <div
      ref="pane2Ref"
      class="lite-splitpanes__pane"
      :style="pane2Style"
    >
      <slot name="pane2" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';

interface PaneConfig {
  size: number
  minSize: number
  maxSize: number
}

const props = defineProps({
  horizontal: {
    type: Boolean,
    default: false
  },
  pane1: {
    type: Object as () => PaneConfig,
    default: () => ({ size: 50, minSize: 0, maxSize: 100 })
  },
  pane2: {
    type: Object as () => PaneConfig,
    default: () => ({ size: 50, minSize: 0, maxSize: 100 })
  }
});

const emit = defineEmits<{
  resize: [event: { panes: Array<{ size: number }> }]
  resized: [event: { panes: Array<{ size: number }> }]
}>();

const containerRef = ref<HTMLElement | null>(null);
const pane1Ref = ref<HTMLElement | null>(null);
const pane2Ref = ref<HTMLElement | null>(null);
const isResizing = ref(false);

// 当前尺寸状态（拖拽结束后同步）
const currentSize1 = ref(props.pane1.size);
const currentSize2 = ref(props.pane2.size);

/**
 * Pane1 样式
 */
const pane1Style = computed(() => {
  const sizeProp = props.horizontal ? 'height' : 'width';
  return {
    [sizeProp]: currentSize1.value + '%',
    flexShrink: 0
  } as Record<string, string>;
});

/**
 * Pane2 样式
 */
const pane2Style = computed(() => {
  const sizeProp = props.horizontal ? 'height' : 'width';
  return {
    [sizeProp]: currentSize2.value + '%',
    flexShrink: 0
  } as Record<string, string>;
});

// 拖拽状态
let resizeStartPos = 0;
let resizeStartSize1 = 0;
let resizeStartSize2 = 0;
let rafId: number | null = null;
let pendingMouseEvent: MouseEvent | null = null;

/**
 * 处理分割条鼠标按下
 */
function handleSplitterMouseDown(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  isResizing.value = true;

  // 记录起始状态
  resizeStartPos = props.horizontal ? e.clientY : e.clientX;
  resizeStartSize1 = currentSize1.value;
  resizeStartSize2 = currentSize2.value;

  // 添加全局事件监听
  document.addEventListener('mousemove', handleSplitterMouseMove);
  document.addEventListener('mouseup', handleSplitterMouseUp);

  // 禁用文本选择
  document.body.style.cursor = props.horizontal ? 'row-resize' : 'col-resize';
  document.body.style.userSelect = 'none';
}

/**
 * 处理鼠标移动 - 使用 RAF 节流
 */
function handleSplitterMouseMove(e: MouseEvent) {
  pendingMouseEvent = e;

  if (rafId !== null) return;

  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!pendingMouseEvent) return;

    const ev = pendingMouseEvent;
    pendingMouseEvent = null;

    if (!containerRef.value || !pane1Ref.value || !pane2Ref.value) return;

    const currentPos = props.horizontal ? ev.clientY : ev.clientX;
    const delta = currentPos - resizeStartPos;

    // 获取容器尺寸
    const containerSize = props.horizontal
      ? containerRef.value.getBoundingClientRect().height
      : containerRef.value.getBoundingClientRect().width;

    if (containerSize === 0) return;

    const deltaPercent = (delta / containerSize) * 100;

    let newSize1 = resizeStartSize1 + deltaPercent;
    let newSize2 = resizeStartSize2 - deltaPercent;

    const totalSize = resizeStartSize1 + resizeStartSize2;

    // 应用最小/最大限制
    const min1 = props.pane1.minSize;
    const max1 = props.pane1.maxSize;
    const min2 = props.pane2.minSize;
    const max2 = props.pane2.maxSize;

    // 限制 Pane1
    if (newSize1 < min1) {
      newSize1 = min1;
      newSize2 = totalSize - min1;
    } else if (newSize1 > max1) {
      newSize1 = max1;
      newSize2 = totalSize - max1;
    }

    // 限制 Pane2
    if (newSize2 < min2) {
      newSize2 = min2;
      newSize1 = totalSize - min2;
    } else if (newSize2 > max2) {
      newSize2 = max2;
      newSize1 = totalSize - max2;
    }

    // 直接操作 DOM，避免 Vue 响应式更新导致的重渲染
    const sizeProp = props.horizontal ? 'height' : 'width';
    pane1Ref.value.style[sizeProp] = newSize1 + '%';
    pane2Ref.value.style[sizeProp] = newSize2 + '%';

    // 触发 resize 事件
    emit('resize', {
      panes: [{ size: newSize1 }, { size: newSize2 }]
    });
  });
}

/**
 * 处理鼠标释放
 */
function handleSplitterMouseUp() {
  isResizing.value = false;

  // 取消未执行的 RAF
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingMouseEvent = null;

  // 移除全局事件监听
  document.removeEventListener('mousemove', handleSplitterMouseMove);
  document.removeEventListener('mouseup', handleSplitterMouseUp);

  // 恢复文本选择和光标
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  // 从 DOM 读取最终尺寸并同步到响应式状态
  if (pane1Ref.value && pane2Ref.value) {
    const sizeProp = props.horizontal ? 'height' : 'width';
    const style1 = pane1Ref.value.style[sizeProp];
    const style2 = pane2Ref.value.style[sizeProp];
    if (style1) currentSize1.value = parseFloat(style1);
    if (style2) currentSize2.value = parseFloat(style2);
  }

  // 触发 resized 事件
  emit('resized', {
    panes: [{ size: currentSize1.value }, { size: currentSize2.value }]
  });
}

// 监听 props 变化，同步更新内部状态
watch(
  () => [props.pane1.size, props.pane2.size],
  ([newSize1, newSize2]) => {
    // 只在非拖拽状态下更新，避免干扰用户操作
    if (!isResizing.value) {
      currentSize1.value = newSize1;
      currentSize2.value = newSize2;
    }
  }
);

// 生命周期
onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  document.removeEventListener('mousemove', handleSplitterMouseMove);
  document.removeEventListener('mouseup', handleSplitterMouseUp);
});
</script>

<style scoped>
.lite-splitpanes {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.lite-splitpanes--horizontal {
  flex-direction: column;
}

.lite-splitpanes__pane {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  /* 使用 flex-basis 作为基础尺寸，配合 width/height 实现精确控制 */
  flex-basis: auto;
}

.lite-splitpanes__splitter {
  flex-shrink: 0;
  background-color: var(--color-surface, #f5f5f5);
  transition: background-color 0.2s ease;
  position: relative;
}

.lite-splitpanes__splitter:hover {
  background-color: var(--el-color-primary-light-8, #d9ecff);
}

/* 垂直布局：分割条为竖线 */
.lite-splitpanes:not(.lite-splitpanes--horizontal) .lite-splitpanes__splitter {
  width: 4px;
  cursor: col-resize;
}

/* 水平布局：分割条为横线 */
.lite-splitpanes__splitter--horizontal {
  height: 4px;
  cursor: row-resize;
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
