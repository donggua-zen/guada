<script setup lang="ts">
import { ref, computed, watch, nextTick, useSlots, onBeforeUnmount, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  width?: string | number
  alignCenter?: boolean
  closeOnClickModal?: boolean
  closeOnPressEscape?: boolean
  destroyOnClose?: boolean
  appendToBody?: boolean
  showClose?: boolean
}>(), {
  title: '',
  width: '50%',
  alignCenter: true,
  closeOnClickModal: true,
  closeOnPressEscape: true,
  destroyOnClose: false,
  appendToBody: false,
  showClose: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  close: []
  closed: []
}>()

const slots = useSlots()
const visible = ref(props.modelValue)
const rendered = ref(true) // when destroyOnClose, controls inner DOM existence

watch(() => props.modelValue, (val) => {
  if (val === visible.value) return
  if (val) {
    open()
  } else {
    close()
  }
})

function open() {
  visible.value = true
  rendered.value = true
  emit('update:modelValue', true)
  emit('open')
}

function close() {
  visible.value = false
  emit('update:modelValue', false)
  emit('close')
  if (props.destroyOnClose) {
    // wait for transition to finish before destroying inner DOM
    nextTick(() => {
      rendered.value = false
      emit('closed')
    })
  } else {
    nextTick(() => emit('closed'))
  }
}

function handleOverlayClick() {
  if (props.closeOnClickModal) {
    close()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closeOnPressEscape) {
    close()
  }
}

const hasHeader = computed(() => {
  return !!(props.title || slots.header)
})

const hasFooter = computed(() => {
  return !!slots.footer
})

const dialogStyle = computed(() => {
  const w = typeof props.width === 'number' ? `${props.width}px` : props.width
  return { width: w, maxWidth: 'calc(100vw - 32px)' }
})

onBeforeUnmount(() => {
  if (visible.value) {
    emit('update:modelValue', false)
    emit('close')
  }
})
</script>

<template>
  <Teleport :to="appendToBody ? 'body' : undefined" :disabled="!appendToBody">
    <Transition name="l-dialog-fade">
      <div
        v-if="visible"
        class="l-dialog__overlay"
        :class="{ 'l-dialog__overlay--top': !alignCenter }"
        @click.self="handleOverlayClick"
        @keydown.esc="handleKeydown"
        tabindex="-1"
      >
        <div
          class="l-dialog"
          v-bind="attrs"
          :style="dialogStyle"
          role="dialog"
          aria-modal="true"
        >
          <!-- Header: only rendered when title or header slot exists -->
          <div v-if="hasHeader" class="l-dialog__header">
            <slot name="header">
              <span class="l-dialog__title">{{ title }}</span>
            </slot>
            <button
              v-if="showClose"
              class="l-dialog__close-btn"
              type="button"
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
  z-index: 2000;
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
  background-color: var(--color-overlay-bg, rgba(0, 0, 0, 0.5));
  opacity: 0.8;
  pointer-events: none;
}

html.dark .l-dialog__overlay::before {
  opacity: 0.75;
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
  border-radius: var(--size-dialog-rounded-radius, 12px);
  background-color: var(--color-dialog-bg, var(--color-bg));
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.08);
  border: 1px solid var(--color-dialog-border, var(--color-border));
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

html.dark .l-dialog {
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1), 0 8px 32px rgba(0, 0, 0, 0.4);
}

.l-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  flex-shrink: 0;
}

.l-dialog__title {
  font-size: var(--size-text-sm, 14px);
  font-weight: 600;
  color: var(--color-text);
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
  color: var(--color-text-gray, #999);
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
  padding: 0;
}

.l-dialog__close-btn:hover {
  background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
  color: var(--color-text);
}

.l-dialog__close-btn--floating {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

.l-dialog__body {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  min-height: 0;
}

.l-dialog__footer {
  padding: 8px 12px 10px;
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Transition */
.l-dialog-fade-enter-active,
.l-dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.l-dialog-fade-enter-active .l-dialog {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.l-dialog-fade-leave-active .l-dialog {
  transition: transform 0.2s ease, opacity 0.2s ease;
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
