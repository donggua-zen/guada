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
      :class="{ 'lite-splitpanes__splitter--horizontal': horizontal }"
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

interface PaneConfig {
  size: number | string
  minSize: number | string
  maxSize: number | string
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
  resize: [event: { panes: Array<{ size: number | string }> }]
  resized: [event: { panes: Array<{ size: number | string }> }]
}>();

const containerRef = ref<HTMLElement | null>(null);
const pane1Ref = ref<HTMLElement | null>(null);
const pane2Ref = ref<HTMLElement | null>(null);
const isResizing = ref(false);

// 当前尺寸状态（拖拽结束后同步）
const currentSize1 = ref<number | string>(props.pane1.size);
const currentSize2 = ref<number | string>(props.pane2.size);

// pane 折叠状态
const isPane1Collapsed = ref(false);
const isPane2Collapsed = ref(false);

// 容器尺寸缓存，用于响应式更新样式
const containerSizeCache = ref(0);

/**
 * 解析 minSize 为像素值
 */
function getMinPixelSize(paneConfig: PaneConfig): number {
  if (isPixelMode(paneConfig.size)) {
    return parseLimitToPixel(paneConfig.minSize, 0);
  }
  // 百分比模式：minSize 视为百分比，需要容器尺寸才能转像素
  // 这里返回 0，在计算时结合容器尺寸处理
  return 0;
}

/**
 * 计算自动填充 pane 的最小像素尺寸
 * 如果 pane2 是自动填充，返回其 minSize 对应的像素值
 */
function getAutoPaneMinPixel(paneConfig: PaneConfig, containerSize: number): number {
  if (isPixelMode(paneConfig.minSize)) {
    return parseLimitToPixel(paneConfig.minSize, 0);
  }
  // 百分比
  return ((paneConfig.minSize as number) / 100) * containerSize;
}

/**
 * 判断是否为像素模式（字符串且以 px 结尾）
 */
function isPixelMode(size: number | string): boolean {
  return typeof size === 'string' && size.trim().toLowerCase().endsWith('px');
}

/**
 * 判断是否为自动填充模式
 */
function isAutoMode(size: number | string): boolean {
  return typeof size === 'string' && size.trim().toLowerCase() === 'auto';
}

/**
 * 将 size 解析为像素数值
 */
function parsePixelSize(size: number | string): number {
  if (typeof size === 'number') return size;
  const match = size.trim().match(/^([\d.]+)\s*px$/i);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * 将 min/max 限制值解析为像素数值
 */
function parseLimitToPixel(limit: number | string, defaultValue: number): number {
  if (typeof limit === 'number') return limit;
  const match = limit.trim().match(/^([\d.]+)\s*px$/i);
  return match ? parseFloat(match[1]) : defaultValue;
}

/**
 * 判断 pane1 是否为固定像素模式
 */
const isPane1Pixel = computed(() => isPixelMode(props.pane1.size));

/**
 * 判断 pane1 是否为自动填充模式
 */
const isPane1Auto = computed(() => isAutoMode(props.pane1.size));

/**
 * 判断 pane2 是否为固定像素模式
 */
const isPane2Pixel = computed(() => isPixelMode(props.pane2.size));

/**
 * 判断 pane2 是否为自动填充模式
 */
const isPane2Auto = computed(() => isAutoMode(props.pane2.size));

/**
 * 获取容器当前尺寸
 */
function getContainerSize(): number {
  if (!containerRef.value) return 0;
  const size = props.horizontal
    ? containerRef.value.getBoundingClientRect().height
    : containerRef.value.getBoundingClientRect().width;
  containerSizeCache.value = size;
  return size;
}

/**
 * 计算固定像素 pane 的受限尺寸
 */
function getClampedPixelSize(
  pixelSize: number,
  minLimit: number | string,
  maxLimit: number | string,
  containerSize: number
): number {
  const minPixel = parseLimitToPixel(minLimit, 0);
  const maxPixel = parseLimitToPixel(maxLimit, Infinity);
  let result = pixelSize;
  if (result < minPixel) result = minPixel;
  if (result > maxPixel) result = maxPixel;
  if (containerSize > 0 && result > containerSize) {
    result = containerSize;
  }
  return result;
}

/**
 * 更新 pane 折叠状态
 * 当自动填充 pane 的可用空间小于其 minSize 时，自动折叠
 */
function updateCollapseState() {
  const containerSize = getContainerSize();
  if (containerSize === 0) return;

  // pane1 固定像素，pane2 自动填充的情况
  if (isPane1Pixel.value && isPane2Auto.value) {
    const pixelSize = parsePixelSize(currentSize1.value);
    // 固定 pane 的实际显示尺寸（不超过容器）
    const actualPixel = Math.min(pixelSize, containerSize);
    // 自动填充 pane 的可用空间
    const autoPaneAvailable = containerSize - actualPixel;
    // 自动填充 pane 的最小像素需求
    const autoPaneMinPixel = getAutoPaneMinPixel(props.pane2, containerSize);

    // 如果自动填充 pane 空间不足（小于等于 minSize），折叠它
    isPane2Collapsed.value = autoPaneAvailable <= autoPaneMinPixel;
    isPane1Collapsed.value = false;
    return;
  }

  // pane2 固定像素，pane1 自动填充的情况
  if (isPane2Pixel.value && isPane1Auto.value) {
    const pixelSize = parsePixelSize(currentSize2.value);
    const actualPixel = Math.min(pixelSize, containerSize);
    const autoPaneAvailable = containerSize - actualPixel;
    const autoPaneMinPixel = getAutoPaneMinPixel(props.pane1, containerSize);

    isPane1Collapsed.value = autoPaneAvailable <= autoPaneMinPixel;
    isPane2Collapsed.value = false;
    return;
  }

  // 其他模式：检查是否有 pane 尺寸为 0，是则折叠
  if (isPane1Pixel.value && parsePixelSize(currentSize1.value) <= 0) {
    isPane1Collapsed.value = true;
    isPane2Collapsed.value = false;
    return;
  }
  if (isPane2Pixel.value && parsePixelSize(currentSize2.value) <= 0) {
    isPane1Collapsed.value = false;
    isPane2Collapsed.value = true;
    return;
  }
  isPane1Collapsed.value = false;
  isPane2Collapsed.value = false;
}

/**
 * Pane1 样式
 */
const pane1Style = computed(() => {
  // 依赖容器尺寸缓存，确保容器变化时重新计算
  const _cache = containerSizeCache.value;
  const sizeProp = props.horizontal ? 'height' : 'width';
  // 如果 pane2 被折叠，pane1 铺满容器
  if (isPane2Collapsed.value) {
    return {
      flex: '1',
      minWidth: '0',
      minHeight: '0'
    } as Record<string, string>;
  }
  if (isPane1Pixel.value) {
    const pixelSize = parsePixelSize(currentSize1.value);
    const containerSize = getContainerSize();
    // 固定 pane 上限为容器尺寸，超出则压缩
    const maxAllowed = containerSize > 0 ? containerSize : Infinity;
    const clampedSize = getClampedPixelSize(pixelSize, props.pane1.minSize, props.pane1.maxSize, maxAllowed);
    return {
      [sizeProp]: clampedSize + 'px',
      flexShrink: 0
    } as Record<string, string>;
  }
  if (isPane1Auto.value) {
    // 自动填充模式：不设置固定尺寸，依靠 CSS flex: 1
    return {
      flex: '1',
      minWidth: '0',
      minHeight: '0'
    } as Record<string, string>;
  }
  // 百分比模式
  return {
    [sizeProp]: currentSize1.value + '%',
    flexShrink: 0
  } as Record<string, string>;
});

/**
 * Pane2 样式
 */
const pane2Style = computed(() => {
  // 依赖容器尺寸缓存，确保容器变化时重新计算
  const _cache = containerSizeCache.value;
  const sizeProp = props.horizontal ? 'height' : 'width';
  // 如果 pane1 被折叠，pane2 铺满容器
  if (isPane1Collapsed.value) {
    return {
      flex: '1',
      minWidth: '0',
      minHeight: '0'
    } as Record<string, string>;
  }
  if (isPane2Pixel.value) {
    const pixelSize = parsePixelSize(currentSize2.value);
    const containerSize = getContainerSize();
    // 固定 pane 上限为容器尺寸，超出则压缩
    const maxAllowed = containerSize > 0 ? containerSize : Infinity;
    const clampedSize = getClampedPixelSize(pixelSize, props.pane2.minSize, props.pane2.maxSize, maxAllowed);
    return {
      [sizeProp]: clampedSize + 'px',
      flexShrink: 0
    } as Record<string, string>;
  }
  if (isPane2Auto.value) {
    // 自动填充模式：不设置固定尺寸，依靠 CSS flex: 1
    return {
      flex: '1',
      minWidth: '0',
      minHeight: '0'
    } as Record<string, string>;
  }
  // 百分比模式
  return {
    [sizeProp]: currentSize2.value + '%',
    flexShrink: 0
  } as Record<string, string>;
});

// 拖拽状态
let resizeStartPos = 0;
let resizeStartSize1: number | string = 0;
let resizeStartSize2: number | string = 0;
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

    const sizeProp = props.horizontal ? 'height' : 'width';

    // 获取容器当前尺寸，用于像素模式的边界限制
    const containerSize = props.horizontal
      ? containerRef.value.getBoundingClientRect().height
      : containerRef.value.getBoundingClientRect().width;

    // pane1 为固定像素模式，pane2 自动填充
    if (isPane1Pixel.value && isPane2Auto.value) {
      const startPixel = parsePixelSize(resizeStartSize1);
      const minPixel = parseLimitToPixel(props.pane1.minSize, 0);
      const maxPixel = parseLimitToPixel(props.pane1.maxSize, Infinity);
      // 自动填充 pane 的最小像素需求
      const autoPaneMinPixel = getAutoPaneMinPixel(props.pane2, containerSize);

      let newPixel = startPixel + delta;
      if (newPixel < minPixel) newPixel = minPixel;
      if (newPixel > maxPixel) newPixel = maxPixel;
      // 限制固定 pane 不超过容器减去自动 pane 最小需求，确保自动 pane 有空间
      const maxAllowed = containerSize - autoPaneMinPixel;
      if (maxAllowed > 0 && newPixel > maxAllowed) {
        newPixel = maxAllowed;
      }
      // 绝对上限为容器尺寸
      if (containerSize > 0 && newPixel > containerSize) {
        newPixel = containerSize;
      }

      pane1Ref.value.style[sizeProp] = newPixel + 'px';

      emit('resize', {
        panes: [{ size: newPixel + 'px' }, { size: 'auto' }]
      });
      return;
    }

    // pane2 为固定像素模式，pane1 自动填充
    if (isPane2Pixel.value && isPane1Auto.value) {
      const startPixel = parsePixelSize(resizeStartSize2);
      const minPixel = parseLimitToPixel(props.pane2.minSize, 0);
      const maxPixel = parseLimitToPixel(props.pane2.maxSize, Infinity);
      // 自动填充 pane 的最小像素需求
      const autoPaneMinPixel = getAutoPaneMinPixel(props.pane1, containerSize);

      // 拖拽方向与 pane2 尺寸变化相反
      // 水平布局（上下分割）时，向下拖拽（delta > 0）意味着 pane2 应该变大
      // 垂直布局（左右分割）时，向右拖拽（delta > 0）意味着 pane2 应该变小
      let newPixel = props.horizontal ? startPixel + delta : startPixel - delta;
      if (newPixel < minPixel) newPixel = minPixel;
      if (newPixel > maxPixel) newPixel = maxPixel;
      // 限制固定 pane 不超过容器减去自动 pane 最小需求
      const maxAllowed = containerSize - autoPaneMinPixel;
      if (maxAllowed > 0 && newPixel > maxAllowed) {
        newPixel = maxAllowed;
      }
      // 绝对上限为容器尺寸
      if (containerSize > 0 && newPixel > containerSize) {
        newPixel = containerSize;
      }

      pane2Ref.value.style[sizeProp] = newPixel + 'px';

      emit('resize', {
        panes: [{ size: 'auto' }, { size: newPixel + 'px' }]
      });
      return;
    }

    // 百分比模式（原有逻辑）
    if (containerSize === 0) return;

    const deltaPercent = (delta / containerSize) * 100;

    let newSize1 = (resizeStartSize1 as number) + deltaPercent;
    let newSize2 = (resizeStartSize2 as number) - deltaPercent;

    const totalSize = (resizeStartSize1 as number) + (resizeStartSize2 as number);

    // 应用最小/最大限制
    const min1 = props.pane1.minSize as number;
    const max1 = props.pane1.maxSize as number;
    const min2 = props.pane2.minSize as number;
    const max2 = props.pane2.maxSize as number;

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

    if (isPane1Pixel.value) {
      const style1 = pane1Ref.value.style[sizeProp];
      if (style1) currentSize1.value = style1;
    } else if (isPane2Pixel.value) {
      const style2 = pane2Ref.value.style[sizeProp];
      if (style2) currentSize2.value = style2;
    } else {
      const style1 = pane1Ref.value.style[sizeProp];
      const style2 = pane2Ref.value.style[sizeProp];
      if (style1) currentSize1.value = parseFloat(style1);
      if (style2) currentSize2.value = parseFloat(style2);
    }
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
      // props 变化时重新计算折叠状态
      nextTick(() => updateCollapseState());
    }
  }
);

// 监听容器尺寸变化，更新折叠状态
const resizeObserver = new ResizeObserver(() => {
  updateCollapseState();
});

watch(containerRef, (el) => {
  if (el) {
    resizeObserver.observe(el);
    updateCollapseState();
  }
});

// 生命周期
onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
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

.lite-splitpanes--horizontal {
  flex-direction: column;
}

.lite-splitpanes__pane {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  /* 自动填充 pane 依靠 flex: 1 填充剩余空间 */
  flex-basis: auto;
}

/* 自动填充 pane：当没有固定尺寸时填充剩余空间 */
.lite-splitpanes__pane:not([style*="width"]):not([style*="height"]) {
  flex: 1;
  min-width: 0;
  min-height: 0;
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
.lite-splitpanes--horizontal .lite-splitpanes__splitter,
.lite-splitpanes__splitter--horizontal {
  width: 100% !important;
  height: 4px !important;
  min-height: 4px !important;
  max-height: 4px !important;
  cursor: row-resize !important;
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
