<template>
  <div
    ref="wrapEl"
    class="session-title-wrap"
    :class="{
      'actions-visible': actionsVisible,
      'is-scrolling': isScrolling,
    }"
  >
    <div ref="textEl" class="session-title-text" :style="scrollStyle">
      {{ title }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  title: string
  /** 右侧是否显示更多按钮（hover/当前会话时为 true）→ 标题渐隐区扩大，给按钮腾出空间 */
  actionsVisible?: boolean
  /** 是否处于滚动查看全文状态（由父级 item 的 hover 驱动，覆盖整个 item 含更多按钮区） */
  scrollActive?: boolean
}>()

/**
 * 滚动避让宽度：取 mask 渐隐区宽度（36px，actions-visible 时右缘渐隐区），
 * 同时覆盖 more 按钮遮盖（26px）。滚动停止时末尾停在渐隐区之前，
 * 既不被按钮遮挡、也不落入 mask 透明区。
 */
const ACTIONS_OFFSET = 36

/** 恒定滚动速度（px/s），与标题长度无关；时长 = 滚动距离 / 速度 */
const SCROLL_SPEED = 20

/** hover 后延迟启动滚动（ms），避免鼠标快速划过时标题闪动 */
const SCROLL_DELAY_MS = 300

const wrapEl = ref<HTMLElement | null>(null)
const textEl = ref<HTMLElement | null>(null)
const isScrolling = ref(false)
const scrollDist = ref(0)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

/** 有效可视宽度 = 容器宽度 - more 按钮遮盖区（被按钮遮挡的文字也算被截断） */
function visibleWidth(): number {
  const wrap = wrapEl.value
  if (!wrap) return 0
  return Math.max(0, wrap.clientWidth - ACTIONS_OFFSET)
}

/** 标题文本是否超出有效可视区（需要滚动） */
const overflows = computed(() => {
  const text = textEl.value
  if (!text) return false
  return text.scrollWidth > visibleWidth()
})

/** 滚动时通过 CSS 变量传入滚动距离与时长 */
const scrollStyle = computed(() => {
  if (!isScrolling.value) return undefined
  const duration = scrollDist.value / SCROLL_SPEED
  return {
    '--scroll-dist': `${scrollDist.value}px`,
    '--scroll-duration': `${duration.toFixed(1)}s`,
  }
})

/** 测量滚动距离：末尾停在 more 按钮左缘（mask 渐隐区之前），避免被遮挡 */
function measure() {
  const text = textEl.value
  if (!text) return
  scrollDist.value = Math.max(0, text.scrollWidth - visibleWidth())
}

function startScroll() {
  // hover 后延迟 100ms 再滚动，避免快速划过时闪动
  if (scrollTimer) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
  scrollTimer = setTimeout(() => {
    measure()
    if (overflows.value && scrollDist.value > 0) {
      isScrolling.value = true
    }
  }, SCROLL_DELAY_MS)
}

function stopScroll() {
  if (scrollTimer) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
  isScrolling.value = false
}

watch(
  () => props.scrollActive,
  (active) => {
    if (active) {
      startScroll()
    } else {
      stopScroll()
    }
  },
)

onBeforeUnmount(() => {
  if (scrollTimer) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
})
</script>

<style scoped>
/* 容器：mask 固定在右缘（不随文本移动），文本在其内部滚动；遮罩始终保留 */
.session-title-wrap {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  /* 渐变遮罩自然淡出：mask 作用于自身 alpha，不依赖背景色，兼容壁纸/毛玻璃背景 */
  -webkit-mask-image: linear-gradient(to right,
    black 0%,
    black calc(100% - 10px),
    rgba(0, 0, 0, 0.5) calc(100% - 7px),
    transparent calc(100% - 3px));
  mask-image: linear-gradient(to right,
    black 0%,
    black calc(100% - 10px),
    rgba(0, 0, 0, 0.5) calc(100% - 7px),
    transparent calc(100% - 3px));
}

/* 右侧显示更多按钮时：渐隐区扩大且快速归零，标题文字在按钮左侧完全消失，避免重叠 */
.session-title-wrap.actions-visible {
  -webkit-mask-image: linear-gradient(to right,
    black 0%,
    black calc(100% - 36px),
    rgba(0, 0, 0, 0.5) calc(100% - 32px),
    transparent calc(100% - 26px));
  mask-image: linear-gradient(to right,
    black 0%,
    black calc(100% - 36px),
    rgba(0, 0, 0, 0.5) calc(100% - 32px),
    transparent calc(100% - 26px));
}

.session-title-text {
  display: block;
  width: max-content;
  white-space: nowrap;
  font-size: 0.875rem; /* text-sm */
  font-weight: 500; /* font-medium */
  line-height: 1.25rem;
}

/* 滚动查看全文：文本在遮罩下向左滚动，滚到末尾停住；遮罩全程保留 */
.session-title-wrap.is-scrolling .session-title-text {
  animation: session-title-scroll var(--scroll-duration, 3s) linear forwards;
  will-change: transform;
}

@keyframes session-title-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-1 * var(--scroll-dist)));
  }
}
</style>
