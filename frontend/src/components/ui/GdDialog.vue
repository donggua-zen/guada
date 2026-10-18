<script setup lang="ts">
import { ref, computed, watch, nextTick, useSlots, onBeforeUnmount, useAttrs, useId } from 'vue'
import { t } from '@/locales'

defineOptions({ inheritAttrs: false })

type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE_WIDTH: Record<DialogSize, string> = {
  xs: 'var(--gd-dialog-width-xs, 400px)',
  sm: 'var(--gd-dialog-width-sm, 480px)',
  md: 'var(--gd-dialog-width-md, 600px)',
  lg: 'var(--gd-dialog-width-lg, 760px)',
  xl: 'var(--gd-dialog-width-xl, 900px)',
  full: 'var(--gd-dialog-width-full, min(1200px, calc(100vw - 32px)))',
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// 层级：模块级单调递增，保证后打开的弹窗永远在上层。声明式与命令式弹窗共用。
const BASE_Z_INDEX = 2000
let zIndexCounter = 0

// 背景滚动锁：引用计数，支持多弹窗嵌套。
let scrollLockCount = 0
let savedBodyOverflow = ''
// 当前打开的弹窗数：只有全部关闭后才归还焦点，避免关掉上层时抢走下层焦点
let openDialogCount = 0

function lockBodyScroll() {
  if (typeof document === 'undefined') return
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow
  }
}

const attrs = useAttrs()

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  size?: DialogSize
  width?: string | number
  align?: 'center' | 'top'
  alignCenter?: boolean
  closeOnClickModal?: boolean
  closeOnPressEscape?: boolean
  destroyOnClose?: boolean
  appendToBody?: boolean
  lockScroll?: boolean
  trapFocus?: boolean
  showClose?: boolean
  zIndex?: number
}>(), {
  title: '',
  size: 'md',
  width: undefined,
  align: undefined,
  alignCenter: true,
  closeOnClickModal: true,
  closeOnPressEscape: true,
  destroyOnClose: true,
  appendToBody: true,
  lockScroll: true,
  trapFocus: true,
  showClose: true,
  zIndex: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  close: []
  closed: []
}>()

const slots = useSlots()
const uid = useId()
const titleId = `gd-dialog-title-${uid}`
const visible = ref(props.modelValue)
// 首次打开前不渲染 slot，避免隐藏弹窗里的表单/请求提前执行
const rendered = ref(props.modelValue)
const dialogEl = ref<HTMLElement | null>(null)
const zIndexValue = ref<number | undefined>(props.zIndex)
let previousActiveElement: HTMLElement | null = null
let scrollLocked = false
let countedOpen = false

watch(() => props.modelValue, (val) => {
  if (val === visible.value) return
  if (val) {
    open()
  } else {
    close()
  }
})

watch(visible, (val) => {
  if (val) {
    handleOpened()
  }
}, { immediate: true })

function open() {
  rendered.value = true
  visible.value = true
  emit('update:modelValue', true)
  emit('open')
}

function close() {
  if (!visible.value) return
  visible.value = false
  emit('update:modelValue', false)
  emit('close')
}

function handleOpened() {
  if (!countedOpen) {
    openDialogCount += 1
    countedOpen = true
  }
  acquireZIndex()
  if (props.lockScroll && !scrollLocked) {
    lockBodyScroll()
    scrollLocked = true
  }
  if (typeof document !== 'undefined') {
    previousActiveElement = document.activeElement as HTMLElement | null
  }
  nextTick(() => {
    if (!visible.value || !dialogEl.value) return
    const target = dialogEl.value.querySelector<HTMLElement>('[autofocus]')
      || getFocusableElements()[0]
      || dialogEl.value
    target.focus()
  })
}

function handleAfterLeave() {
  if (countedOpen) {
    openDialogCount = Math.max(0, openDialogCount - 1)
    countedOpen = false
  }
  if (scrollLocked) {
    unlockBodyScroll()
    scrollLocked = false
  }
  if (openDialogCount === 0 && previousActiveElement && previousActiveElement.isConnected) {
    previousActiveElement.focus()
  }
  previousActiveElement = null
  if (props.destroyOnClose) {
    rendered.value = false
  }
  emit('closed')
}

function acquireZIndex() {
  if (props.zIndex !== undefined) {
    zIndexValue.value = props.zIndex
    return
  }
  zIndexCounter += 1
  zIndexValue.value = BASE_Z_INDEX + zIndexCounter * 10
}

function getFocusableElements(): HTMLElement[] {
  if (!dialogEl.value) return []
  return Array.from(dialogEl.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null || el === document.activeElement)
}

// 记录遮罩上的按下是否直接发生在遮罩本身（而非弹窗内部拖拽起手）。
// 只有"按下和松开都在遮罩上"才关闭，避免在弹窗内选中文本后拖到遮罩松手误关。
let downOnOverlay = false

function handleOverlayMouseDown(e: MouseEvent) {
  downOnOverlay = e.target === e.currentTarget
}

function handleOverlayClick(e: MouseEvent) {
  if (downOnOverlay && e.target === e.currentTarget && props.closeOnClickModal) {
    close()
  }
  downOnOverlay = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (props.closeOnPressEscape) {
      e.stopPropagation()
      close()
    }
    return
  }

  if (e.key !== 'Tab' || !props.trapFocus || !dialogEl.value) return

  const focusables = getFocusableElements()
  if (focusables.length === 0) {
    e.preventDefault()
    dialogEl.value.focus()
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement

  if (e.shiftKey && (active === first || active === dialogEl.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

const hasHeader = computed(() => {
  return !!(props.title || slots.header)
})

const hasFooter = computed(() => {
  return !!slots.footer
})

const isTopAligned = computed(() => {
  return props.align ? props.align === 'top' : !props.alignCenter
})

const dialogStyle = computed(() => {
  let width: string
  if (props.width !== undefined && props.width !== '') {
    width = typeof props.width === 'number' ? `${props.width}px` : props.width
  } else {
    width = SIZE_WIDTH[props.size]
  }
  return { width, maxWidth: 'calc(100vw - 32px)' }
})

onBeforeUnmount(() => {
  if (visible.value) {
    emit('update:modelValue', false)
    emit('close')
  }
  if (countedOpen) {
    openDialogCount = Math.max(0, openDialogCount - 1)
    countedOpen = false
  }
  if (scrollLocked) {
    unlockBodyScroll()
    scrollLocked = false
  }
})
</script>

<template>
  <Teleport :to="appendToBody ? 'body' : undefined" :disabled="!appendToBody">
    <Transition name="l-dialog-fade" @after-leave="handleAfterLeave">
      <div
        v-show="visible"
        class="l-dialog__overlay gd-dialog__overlay"
        :class="{ 'l-dialog__overlay--top': isTopAligned }"
        :style="{ zIndex: zIndexValue }"
        @mousedown="handleOverlayMouseDown"
        @click="handleOverlayClick"
        @keydown="handleKeydown"
        tabindex="-1"
      >
        <div
          ref="dialogEl"
          class="l-dialog gd-dialog"
          v-bind="attrs"
          :style="dialogStyle"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="hasHeader ? titleId : undefined"
          tabindex="-1"
        >
          <!-- Header: only rendered when title or header slot exists -->
          <div v-if="hasHeader" class="l-dialog__header">
            <slot name="header">
              <span :id="titleId" class="l-dialog__title">{{ title }}</span>
            </slot>
            <button
              v-if="showClose"
              class="l-dialog__close-btn"
              type="button"
              :aria-label="t('common.close')"
              @click="close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <!-- Floating close button when no header -->
          <button
            v-else-if="showClose"
            class="l-dialog__close-btn l-dialog__close-btn--floating"
            type="button"
            :aria-label="t('common.close')"
            @click="close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>

          <!-- Body -->
          <div v-if="rendered" class="l-dialog__body">
            <slot />
          </div>

          <!-- Footer -->
          <div v-if="hasFooter" class="l-dialog__footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.l-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--gd-z-modal, 2000);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 5vh 16px;
}

.l-dialog__overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: var(--gd-color-overlay-bg, rgba(0, 0, 0, 0.5));
  opacity: var(--gd-dialog-overlay-opacity, 0.8);
  pointer-events: none;
}

.l-dialog__overlay > .l-dialog {
  position: relative;
  z-index: 1;
}

.l-dialog__overlay--top {
  align-items: flex-start;
}

.l-dialog {
  margin: 0 auto;
  max-height: 85vh;
  border-radius: var(--gd-size-dialog-rounded-radius, 12px);
  background-color: var(--gd-color-dialog-bg, var(--gd-color-bg));
  box-shadow: var(--gd-dialog-shadow, 0 0 10px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.08));
  border: 1px solid var(--gd-color-dialog-border, var(--gd-color-border));
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  outline: none;
}

.l-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px var(--gd-dialog-padding-x, 16px) 8px;
  flex-shrink: 0;
}

.l-dialog__title {
  font-size: var(--gd-dialog-title-size, 14px);
  font-weight: var(--gd-dialog-title-weight, 600);
  color: var(--gd-color-text);
  line-height: 1.5;
}

.l-dialog__close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--gd-color-text-gray, #999);
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
  padding: 0;
}

.l-dialog__close-btn:hover {
  background: var(--gd-color-surface-hover, rgba(0, 0, 0, 0.06));
  color: var(--gd-color-text);
}

.l-dialog__close-btn:focus-visible {
  outline: 2px solid var(--gd-color-primary);
  outline-offset: 2px;
}

.l-dialog__close-btn--floating {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

.l-dialog__body {
  flex: 1;
  padding: var(--gd-dialog-padding-y, 12px) var(--gd-dialog-padding-x, 16px);
  overflow-y: auto;
  min-height: 0;
}

.l-dialog__footer {
  padding: 8px var(--gd-dialog-padding-x, 16px) 10px;
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--gd-dialog-gap, 8px);
}

/* Transition */
.l-dialog-fade-enter-active,
.l-dialog-fade-leave-active {
  transition: opacity var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease);
}

.l-dialog-fade-enter-active .l-dialog {
  transition: transform var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease),
    opacity var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease);
}

.l-dialog-fade-leave-active .l-dialog {
  transition: transform var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease),
    opacity var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease);
}

.l-dialog-fade-enter-from {
  opacity: 0;
}

.l-dialog-fade-enter-from .l-dialog {
  transform: translateY(-20px) scale(0.96);
  opacity: 0;
}

.l-dialog-fade-leave-to {
  opacity: 0;
}

.l-dialog-fade-leave-to .l-dialog {
  transform: translateY(-10px) scale(0.98);
  opacity: 0;
}
</style>
