<template>
  <div class="flex relative overflow-hidden" :class="{ 'mobile-drawer-mode': isMobileDrawer }">
    <!-- 遮罩层：仅移动端悬浮抽屉启用时显示（与抽屉容器同级 1500，低于 GdDialog 遮罩 2000） -->
    <div v-if="isMobileDrawer && sidebarVisible" class="absolute inset-0 bg-black opacity-40"
      style="z-index: 1500"
      @click="$emit('update:sidebarVisible', false)"></div>
    <!-- 侧边栏容器 -->
    <!-- 并排布局（桌面与小窗统一）：容器不带 z-index——内容卡片的左侧外阴影要绘制在侧栏右缘之上；
         只有悬浮抽屉（absolute 浮层覆盖内容区）才需要 absolute + z-index，见 isMobileDrawer -->
    <div :class="[
      'h-full relative transform transition-all duration-300 ease-in-out justify-content-end shrink-0',
      isMobileDrawer ? 'max-lg:absolute' : '',
      isResizing ? 'sidebar-resizing' : ''
    ]" :style="{
          width: sidebarContainerWidth,
          maxWidth: sidebarContainerWidth,
          minWidth: sidebarContainerWidth,
          zIndex: isMobileDrawer ? 1500 : undefined
        }">
      <div class="absolute right-0 h-full"
        :style="{ width: (sidebarWidth ?? 278) < 0 ? '100vw' : `${sidebarWidth ?? 278}px` }">
        <slot name="sidebar" :sidebar-visible="sidebarVisible" />
      </div>

      <!-- 折叠展开按钮 -->
      <button v-if="showToggleButton || isMobileDrawer" @click="$emit('update:sidebarVisible', !sidebarVisible)"
        class="absolute  top-1/2 right-0 transition-all transform -translate-y-1/2 w-4 h-16 flex items-center justify-center bg-(--gd-color-surface) dark:bg-gray-800 shadow-sm hover:bg-(--gd-color-surface-hover) focus:outline-none z-10  border-(--gd-color-surface-border) dark:border-gray-800 dark:hover:bg-gray-600"
        :title="sidebarVisible ? '折叠侧边栏' : '展开侧边栏'"
        :class="sidebarVisible ? 'translate-x-1/2 rounded-lg border' : 'translate-x-full rounded-lg border'">
        <slot name="toggle-icon" :sidebar-visible="sidebarVisible">
          <component :is="sidebarVisible ? ArrowLeftTwotone : ArrowRightTwotone"
            class="text-gray-600 dark:text-gray-200" />
        </slot>
      </button>

      <!-- 拖拽调宽把手：并排布局（含小窗）且未折叠时显示；定位与折叠按钮同款（右缘外探一半跨过缝隙）， -->
      <!-- z-10 需盖过内容卡片绘到侧栏右缘上的左阴影（容器不带 z-index，见上方注释） -->
      <div v-if="resizable && sidebarVisible"
        class="sidebar-resize-handle absolute top-0 bottom-0 right-0 z-10 w-1.5 translate-x-1/2 cursor-col-resize"
        :class="{ 'sidebar-resize-handle--active': isResizing }" @mousedown="handleResizeMouseDown"
        @dblclick="handleResizeReset"></div>
    </div>

    <!-- 主体内容 -->
    <div class="h-full flex-1 min-w-0">
      <slot name="content" />
    </div>

    <!-- 拖拽时全屏遮罩：阻止下层 webview/iframe 截获 mousemove 中断拖拽。
         必须留在根 div 内部保持组件单根：Teleport 若作第二根节点会把组件变成
         fragment root，禁用 Vue 的 attribute 透传，外部传入的 class（如
         MainLayout 的 flex-1 撑高度）会静默丢失导致整页塌陷。
         遮罩渲染位置由 Teleport 决定（body），模板里的位置无实际影响 -->
    <Teleport to="body">
      <div v-if="isResizing" class="sidebar-resize-overlay"></div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import {
  ArrowBackIosNewTwotone as ArrowLeftTwotone,
  ArrowForwardIosTwotone as ArrowRightTwotone
} from "@vicons/material";
import { isMobileDevice } from '@/composables/useDevice'

/** 移动设备（手机/平板浏览器）：侧栏改为覆盖内容区的悬浮抽屉。
 *  判定基准是设备类型而非窗口宽度——Electron 小窗（700-800px）绝不触发抽屉。
 *  抽屉层 z-index=1500：低于 GdDialog 遮罩（2000），弹窗在抽屉打开时仍正常置顶；
 *  实现方式给抽屉容器与遮罩统一挂 CSS 变量 --sidebar-drawer-z，模板不再写死。 */
const isMobileDrawer = computed(() => isMobileDevice)
// Props 类型化
const props = withDefaults(defineProps<{
  sidebarVisible?: boolean;
  sidebarWidth?: number;
  showToggleButton?: boolean;
  sidebarPosition?: 'left' | 'right';
  /** @deprecated 抽屉态 z-index 已固定为 1500（低于 GdDialog 遮罩 2000），保留参数避免外部调用报错 */
  zIndex?: number;
  /** 是否启用桌面端拖拽调宽把手 */
  resizable?: boolean;
  /** 拖拽宽度下限（px） */
  minSidebarWidth?: number;
  /** 拖拽宽度上限（px） */
  maxSidebarWidth?: number;
}>(), {
  resizable: false,
  minSidebarWidth: 200,
  maxSidebarWidth: 480,
});

// 计算侧边栏实际位置类 - 类型化
const sidebarContainerWidth = computed((): string => {
  if (props.sidebarVisible === false)
    return '0';
  return (props.sidebarWidth ?? 278) < 0 ? '100%' : (props.sidebarWidth ?? 278) + 'px';
});

// Emits 类型化
const emit = defineEmits<{
  'update:sidebarVisible': [value: boolean]
  toggle: []
  'update:sidebarWidth': [value: number]
}>();

// ==================== 拖拽调宽 ====================

/** 双击把手重置的默认宽度（MainLayout 历史固定值） */
const DEFAULT_SIDEBAR_WIDTH = 285;

const isResizing = ref(false);
let resizeStartX = 0;
let resizeStartWidth = 0;
let resizeRafId: number | null = null;
let pendingResizeEvent: MouseEvent | null = null;

function clampSidebarWidth(width: number): number {
  // max 防御性取不小于 min，避免异常 props 把钳制区间变成空集
  const max = Math.max(props.maxSidebarWidth, props.minSidebarWidth);
  return Math.min(Math.max(Math.round(width), props.minSidebarWidth), max);
}

function applyResizeDelta(e: MouseEvent): void {
  // sidebarPosition 为 right 时把手在左缘，拖拽方向取反
  const dir = (props.sidebarPosition ?? 'left') === 'left' ? 1 : -1;
  emit('update:sidebarWidth', clampSidebarWidth(resizeStartWidth + dir * (e.clientX - resizeStartX)));
}

function handleResizeMouseDown(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();

  isResizing.value = true;
  resizeStartX = e.clientX;
  resizeStartWidth = props.sidebarWidth ?? 278;

  document.addEventListener('mousemove', handleResizeMouseMove);
  document.addEventListener('mouseup', handleResizeMouseUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function handleResizeMouseMove(e: MouseEvent): void {
  pendingResizeEvent = e;
  if (resizeRafId !== null) return;

  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null;
    if (!pendingResizeEvent) return;
    applyResizeDelta(pendingResizeEvent);
    pendingResizeEvent = null;
  });
}

function handleResizeMouseUp(): void {
  // 先消费尚未被 rAF 消费的最后一次移动，保证落点与松手位置一致
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  if (pendingResizeEvent) {
    applyResizeDelta(pendingResizeEvent);
    pendingResizeEvent = null;
  }

  isResizing.value = false;
  document.removeEventListener('mousemove', handleResizeMouseMove);
  document.removeEventListener('mouseup', handleResizeMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

/** 双击把手：重置为默认宽度 */
function handleResizeReset(): void {
  emit('update:sidebarWidth', DEFAULT_SIDEBAR_WIDTH);
}

onUnmounted(() => {
  if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
  document.removeEventListener('mousemove', handleResizeMouseMove);
  document.removeEventListener('mouseup', handleResizeMouseUp);
});
</script>

<style scoped>
/* 拖拽调宽期间禁用折叠过渡：每次 1px 更新若被 300ms 动画拖住会明显滞后 */
.sidebar-resizing {
  transition: none !important;
}

/* 把手本体只是透明命中区（6px），竖线用伪元素画在其中心 */
.sidebar-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 1px;
  background-color: transparent;
  transition: background-color 0.2s ease;
}

.sidebar-resize-handle:hover::after,
.sidebar-resize-handle--active::after {
  background-color: var(--el-color-primary-light-8, #d9ecff);
}

.dark .sidebar-resize-handle:hover::after,
.dark .sidebar-resize-handle--active::after {
  background-color: var(--el-color-primary-light-8, #4a4d55);
}

/* 拖拽时全屏遮罩，阻止下层元素收到 hover/mousemove */
.sidebar-resize-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  cursor: col-resize;
}

/* 移动端抽屉：覆盖内容区而非并排挤压。模板里 max-lg:absolute 只在小窗（<1024）命中，
   移动平板 ≥1024 或细窄屏兜底为恒 absolute；遮罩与容器同层级（1500），
   低于 GdDialog 遮罩 2000，弹窗浮层不受抽屉开合影响。
   选择器用 .h-full.relative（抽屉容器），不用 nth-child——遮罩按需渲染会改变子序 */
.mobile-drawer-mode>div.h-full.relative {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
}

/* 触屏：抽屉里禁用拖宽把手与 hover 高亮（无鼠标，把手无意义） */
.mobile-drawer-mode .sidebar-resize-handle {
  display: none;
}
</style>