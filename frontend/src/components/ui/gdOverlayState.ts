// Dialog、命令式弹窗和 Drawer 共用同一分配器；不能放在 <script setup> 内，
// 否则每个组件实例都会持有独立计数器。
const BASE_Z_INDEX = 2000
let zIndexCounter = 0

export function acquireOverlayZIndex(): number {
  zIndexCounter += 1
  return BASE_Z_INDEX + zIndexCounter * 10
}

// 滚动锁跨组件引用计数，最后一层关闭后才恢复打开前的样式。
let scrollLockCount = 0
let savedBodyOverflow = ''

export function lockBodyScroll() {
  if (typeof document === 'undefined') return
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

export function unlockBodyScroll() {
  if (typeof document === 'undefined' || scrollLockCount === 0) return
  scrollLockCount -= 1
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow
  }
}
