import { computed, ref, type Ref } from 'vue'

/**
 * 全局「正在调整尺寸」态：拖拽分割条、拖拽侧栏把手、缩放窗口都归入同一个开关。
 *
 * 为什么需要它：这些操作期间每帧都在改布局宽度，任何挂在布局上的「常驻工作」都会被
 * 乘上 60 次/秒——无限 shimmer 动画每帧重绘、backdrop-filter 每帧重算模糊、
 * xterm 每帧 reflow 并给 PTY 发 resize、webview 每帧重算 transform、占位扫描每帧读布局。
 * 这些工作在「手正在动」的瞬间都没有观察价值，停掉它们不改变任何可见结果。
 *
 * 三种进入方式：
 * 1. 指针拖拽：`beginResizeActivity()` / 结束调用返回的释放函数（引用计数，
 *    嵌套分割条各自持有，内层结束不会误释放外层）。
 * 2. 窗口缩放：本模块自带 resize 监听自动进入/退出，调用方无需接线。
 * 3. 显式读取：`isResizeActive` 供组件在回调里短路。
 *
 * 释放走尾延迟（`RESIZE_ACTIVITY_TAIL_MS`）而不是立即清：窗口缩放会连续派发大量 resize
 * 事件、指针拖拽的最后一帧也可能紧跟着一次布局变化，立即清会让下游工作在下一次事件里
 * 又跑一遍。尾延迟把这一串合并成一次收尾。
 *
 * 关键约束：`isResizeActive` 与 <html> 上的 class 必须同源同刻——两者都由同一个
 * `active` 标志驱动。若布尔值提前翻回 false，组件会先恢复工作、CSS 却还在压制动画，
 * 出现「动画停了但重活又开始了」的半吊子状态。
 */

/** 收尾延迟：最后一次活动结束后再等这么久才真正退出调整态。 */
export const RESIZE_ACTIVITY_TAIL_MS = 150

/** 挂在 <html> 上的类名，CSS 侧据此暂停动画 / 关掉 backdrop-filter。 */
export const RESIZE_ACTIVITY_CLASS = 'gd-resizing'

/** 嵌套计数：只有归零才进入收尾流程。 */
let activeCount = 0
/** 唯一权威态：布尔值与 DOM class 都读它。 */
const active = ref(false)
const isResizeActive = computed(() => active.value)

let tailTimer: ReturnType<typeof setTimeout> | null = null
let classApplied = false

function setClass(on: boolean): void {
  if (typeof document === 'undefined') return
  if (on === classApplied) return
  classApplied = on
  document.documentElement.classList.toggle(RESIZE_ACTIVITY_CLASS, on)
}

function clearTail(): void {
  if (tailTimer !== null) {
    clearTimeout(tailTimer)
    tailTimer = null
  }
}

/** 进入调整态并开始续期（尾延迟被推后）。 */
function enter(): void {
  clearTail()
  activeCount += 1
  if (!active.value) {
    active.value = true
    setClass(true)
  }
}

/** 计数归零后启动尾延迟；窗内又有活动则续期，真正到期才退出。 */
function scheduleExit(): void {
  clearTail()
  tailTimer = setTimeout(() => {
    tailTimer = null
    if (activeCount > 0) return
    active.value = false
    setClass(false)
  }, RESIZE_ACTIVITY_TAIL_MS)
}

/**
 * 「持续型」活动的一次续期：确保处于调整态，并把尾延迟重新推后。
 * 与 enter 的区别是不占用引用计数——窗口缩放没有成对的结束事件，靠尾延迟收敛，
 * 若每帧都 enter 却不释放，计数会单调增长。
 */
function touch(): void {
  if (!active.value) {
    active.value = true
    setClass(true)
  }
  scheduleExit()
}

/**
 * 进入调整态。返回幂等的释放函数（重复调用无副作用，便于组件在 onUnmounted 兜底）。
 */
export function beginResizeActivity(): () => void {
  enter()

  let released = false
  return () => {
    if (released) return
    released = true
    activeCount = Math.max(0, activeCount - 1)
    if (activeCount > 0) return
    scheduleExit()
  }
}

/** 强制立即退出（测试与极端场景用；正常路径一律走 begin 返回的释放函数）。 */
export function resetResizeActivity(): void {
  clearTail()
  activeCount = 0
  active.value = false
  setClass(false)
}

/** 非组件环境（工具函数、事件回调）直接读当前态。 */
export function isResizeActivityActive(): boolean {
  return active.value
}

/**
 * 窗口缩放自动进入调整态。
 *
 * 用 rAF 合并：resize 事件可以比帧率更高，合并后每帧最多一次。缩放手势持续期间每帧
 * 续期尾延迟，松手后 `RESIZE_ACTIVITY_TAIL_MS` 自动退出，因此不需要成对的 mouseup。
 *
 * **必须在模块加载时自动绑定，不能只依赖组件调用 `useResizeActivity()`。**
 * 踩过的坑：最初只有 `useResizeActivity()` 里调用 `bindWindowResize()`，但全项目
 * 的消费方都只 import 了 `beginResizeActivity` / `isResizeActivityActive`，
 * 没有一个组件调用 `useResizeActivity()` —— 结果窗口缩放时 `gd-resizing` 从不挂上，
 * 拖分割条正常（直接调 beginResizeActivity）、拖窗口却没有任何降级。
 * 模块级副作用在这里是合理的：本模块本身就是一个全局单例状态机，
 * 绑定 window 监听是它的固有职责，不该由调用方记得触发。
 */
let windowResizeBound = false

function bindWindowResize(): void {
  if (windowResizeBound || typeof window === 'undefined') return
  windowResizeBound = true

  let rafId: number | null = null
  window.addEventListener(
    'resize',
    () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        touch()
      })
    },
    { passive: true },
  )
}

/** 模块加载即绑定：任何 import 本模块的代码都自动获得窗口缩放降级。 */
bindWindowResize()

/**
 * 组件侧入口（可选）。绑定已在模块加载时完成，这里只是提供一个语义化的调用点；
 * 不调用也不会影响窗口缩放的降级生效。
 */
export function useResizeActivity(): { isResizeActive: Ref<boolean> } {
  bindWindowResize()
  return { isResizeActive }
}
