<script setup lang="ts">
import { ref, computed, watch, useSlots, onBeforeUnmount, useId } from 'vue'
import { t } from '@/locales'

defineOptions({ inheritAttrs: false })

/**
 * 右侧抽屉（替代 el-drawer）。
 * 浮层基建与 GdDialog 同模式：Teleport body + 引用计数滚动锁 + 模块级单调 z-index。
 * 动效：遮罩 fade + 面板 translateX 滑入。
 */

const slots = useSlots()

// 与 GdDialog 同一基线：后打开的浮层永远在上层
const BASE_Z_INDEX = 2000
let zIndexCounter = 0

// 背景滚动锁：引用计数，支持多浮层嵌套（与 GdDialog 共享同一契约）
let scrollLockCount = 0
let savedBodyOverflow = ''

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

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  /** 面板宽度（css 长度），默认 '480px' */
  size?: string
  /** 关闭后卸载内容 */
  destroyOnClose?: boolean
  closeOnClickModal?: boolean
  closeOnPressEscape?: boolean
  lockScroll?: boolean
}>(), {
  title: '',
  size: '480px',
  destroyOnClose: true,
  closeOnClickModal: true,
  closeOnPressEscape: true,
  lockScroll: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  close: []
  closed: []
}>()

const uid = useId()
const titleId = `gd-drawer-title-${uid}`
const visible = ref(props.modelValue)
// 首次打开前不渲染 slot，避免隐藏抽屉里的请求提前执行
const rendered = ref(props.modelValue)
const zIndexValue = ref<number | undefined>(undefined)
let scrollLocked = false

watch(() => props.modelValue, (val) => {
  if (val === visible.value) return
  if (val) {
    rendered.value = true
    visible.value = true
    emit('open')
  } else {
    visible.value = false
    emit('close')
  }
})

watch(visible, (val) => {
  if (!val) return
  zIndexCounter += 1
  zIndexValue.value = BASE_Z_INDEX + zIndexCounter * 10
  if (props.lockScroll && !scrollLocked) {
    lockBodyScroll()
    scrollLocked = true
  }
})

function close() {
  if (!props.modelValue) return
  emit('update:modelValue', false)
  emit('close')
}

function handleAfterLeave() {
  if (scrollLocked) {
    unlockBodyScroll()
    scrollLocked = false
  }
  if (props.destroyOnClose) {
    rendered.value = false
  }
  emit('closed')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closeOnPressEscape) {
    e.stopPropagation()
    close()
  }
}

const panelStyle = computed(() => ({ width: props.size, maxWidth: '100vw' }))

onBeforeUnmount(() => {
  if (visible.value) {
    emit('update:modelValue', false)
    emit('close')
  }
  if (scrollLocked) {
    unlockBodyScroll()
    scrollLocked = false
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="l-drawer" @after-leave="handleAfterLeave">
      <div
        v-show="visible"
        class="l-drawer__overlay gd-drawer__overlay"
        :style="{ zIndex: zIndexValue }"
        @click="closeOnClickModal && close()"
        @keydown="handleKeydown"
        tabindex="-1"
      >
        <section
          class="l-drawer gd-drawer"
          v-bind="$attrs"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? titleId : undefined"
        >
          <header class="l-drawer__header">
            <slot name="header">
              <span :id="titleId" class="l-drawer__title">{{ title }}</span>
            </slot>
            <button
              class="l-drawer__close-btn"
              type="button"
              :aria-label="t('common.close')"
              @click="close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </header>
          <div v-if="rendered || !destroyOnClose" class="l-drawer__body">
            <slot />
          </div>
          <div v-if="slots.footer" class="l-drawer__footer">
            <slot name="footer" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.l-drawer__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--gd-z-modal, 2000);
  outline: none;
}

.l-drawer__overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: var(--gd-color-overlay-bg, rgba(0, 0, 0, 0.5));
  opacity: var(--gd-dialog-overlay-opacity, 0.8);
  pointer-events: none;
}

.l-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--gd-color-dialog-bg, var(--gd-color-bg));
  border-left: 1px solid var(--gd-color-dialog-border, var(--gd-color-border));
  box-shadow: var(--gd-dialog-shadow, 0 0 10px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.08));
  outline: none;
}

.l-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 10px;
  flex-shrink: 0;
}

.l-drawer__title {
  font-size: var(--gd-dialog-title-size, 14px);
  font-weight: var(--gd-dialog-title-weight, 600);
  color: var(--gd-color-text);
  line-height: 1.5;
}

.l-drawer__close-btn {
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

.l-drawer__close-btn:hover {
  background: var(--gd-color-surface-hover, rgba(0, 0, 0, 0.06));
  color: var(--gd-color-text);
}

.l-drawer__close-btn:focus-visible {
  outline: 2px solid var(--gd-color-primary);
  outline-offset: 2px;
}

.l-drawer__body {
  flex: 1;
  padding: 0 16px 16px;
  overflow-y: auto;
  min-height: 0;
}

.l-drawer__footer {
  padding: 8px 16px 12px;
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Transition：遮罩 fade + 面板 translateX 滑入 */
.l-drawer-enter-active,
.l-drawer-leave-active {
  transition: opacity var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease);
}

.l-drawer-enter-active .l-drawer,
.l-drawer-leave-active .l-drawer {
  transition: transform var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease);
}

.l-drawer-enter-from,
.l-drawer-leave-to {
  opacity: 0;
}

.l-drawer-enter-from .l-drawer,
.l-drawer-leave-to .l-drawer {
  transform: translateX(100%);
}
</style>
