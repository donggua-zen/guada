/**
 * Lightweight singleton tooltip manager.
 *
 * Design goals:
 * - Single shared DOM element (not per-instance like el-tooltip/@popperjs)
 * - No layout computation on scroll — just hide immediately
 * - Position calculated once on show via getBoundingClientRect (read-only, no reflow)
 */

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'
export type TooltipEffect = 'dark' | 'light'

let tipEl: HTMLDivElement | null = null
let contentEl: HTMLSpanElement | null = null
let arrowEl: HTMLDivElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
/** 当前显示的触发元素（已打开状态下刷新内容用） */
let currentTrigger: HTMLElement | null = null

const SHOW_DELAY = 200
const GAP = 14
const VIEWPORT_PAD = 4

function ensureEl(): HTMLDivElement {
  if (tipEl) return tipEl

  tipEl = document.createElement('div')
  tipEl.className = 'l-tooltip'
  tipEl.setAttribute('role', 'tooltip')
  tipEl.style.cssText =
    'position:fixed;z-index:9999;pointer-events:none;'

  contentEl = document.createElement('span')
  contentEl.className = 'l-tooltip__content'
  tipEl.appendChild(contentEl)

  arrowEl = document.createElement('div')
  arrowEl.className = 'l-tooltip__arrow'
  tipEl.appendChild(arrowEl)

  document.body.appendChild(tipEl)
  return tipEl
}

function computePosition(
  trigger: DOMRect,
  tip: DOMRect,
  placement: TooltipPlacement,
): { x: number; y: number; actual: TooltipPlacement } {
  let x = 0
  let y = 0
  let actual = placement

  switch (placement) {
    case 'top':
      y = trigger.top - tip.height - GAP
      if (y < VIEWPORT_PAD) {
        y = trigger.bottom + GAP
        actual = 'bottom'
      }
      x = trigger.left + (trigger.width - tip.width) / 2
      break
    case 'bottom':
      y = trigger.bottom + GAP
      if (y + tip.height > window.innerHeight - VIEWPORT_PAD) {
        y = trigger.top - tip.height - GAP
        actual = 'top'
      }
      x = trigger.left + (trigger.width - tip.width) / 2
      break
    case 'left':
      x = trigger.left - tip.width - GAP
      if (x < VIEWPORT_PAD) {
        x = trigger.right + GAP
        actual = 'right'
      }
      y = trigger.top + (trigger.height - tip.height) / 2
      break
    case 'right':
      x = trigger.right + GAP
      if (x + tip.width > window.innerWidth - VIEWPORT_PAD) {
        x = trigger.left - tip.width - GAP
        actual = 'left'
      }
      y = trigger.top + (trigger.height - tip.height) / 2
      break
  }

  // Clamp X within viewport
  x = Math.max(VIEWPORT_PAD, Math.min(x, window.innerWidth - tip.width - VIEWPORT_PAD))

  return { x, y, actual }
}

export function showTooltip(
  trigger: HTMLElement,
  content: string,
  placement: TooltipPlacement = 'top',
  effect: TooltipEffect = 'dark',
): void {
  if (showTimer) clearTimeout(showTimer)
  if (!content) return

  showTimer = setTimeout(() => {
    showTimer = null
    const tip = ensureEl()
    currentTrigger = trigger

    if (contentEl) contentEl.textContent = content
    tip.setAttribute('data-effect', effect)

    // Show at origin first to measure size（隐藏态不参与布局测量，用 visibility 而非 display）
    tip.style.visibility = 'hidden'
    tip.classList.add('l-tooltip--visible')
    tip.style.left = '0px'
    tip.style.top = '0px'

    const triggerRect = trigger.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    const { x, y, actual } = computePosition(triggerRect, tipRect, placement)

    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
    tip.setAttribute('data-placement', actual)
    // 位置就绪后再进入可见态，过渡从锚点方向播放
    requestAnimationFrame(() => {
      tip.style.visibility = 'visible'
    })
  }, SHOW_DELAY)
}

export function hideTooltip(): void {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  currentTrigger = null
  if (tipEl) {
    tipEl.classList.remove('l-tooltip--visible')
  }
}

/**
 * 已打开状态下刷新内容（如点击后 content prop 变化而 tooltip 仍可见）：
 * 直接更新文本并按新尺寸重定位，不走 SHOW_DELAY。仅当该触发元素当前正显示时生效。
 */
export function refreshTooltip(
  trigger: HTMLElement,
  content: string,
  placement: TooltipPlacement = 'top',
  effect: TooltipEffect = 'dark',
): void {
  if (currentTrigger !== trigger || !content || !tipEl || !tipEl.classList.contains('l-tooltip--visible')) {
    return
  }
  if (contentEl) contentEl.textContent = content
  tipEl.setAttribute('data-effect', effect)
  const triggerRect = trigger.getBoundingClientRect()
  const tipRect = tipEl.getBoundingClientRect()
  const { x, y, actual } = computePosition(triggerRect, tipRect, placement)
  tipEl.style.left = `${x}px`
  tipEl.style.top = `${y}px`
  tipEl.setAttribute('data-placement', actual)
}

// Global listeners — hide on scroll or resize.
// capture:true catches scroll events from all nested scroll containers.
// passive:true avoids blocking the scroll thread.
// The handler only does a style write (no layout read) — zero reflow.
function onScrollOrResize(): void {
  if (tipEl && tipEl.classList.contains('l-tooltip--visible')) {
    tipEl.classList.remove('l-tooltip--visible')
    currentTrigger = null
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true })
  window.addEventListener('wheel', onScrollOrResize, { capture: true, passive: true })
  window.addEventListener('resize', onScrollOrResize, { passive: true })
}
