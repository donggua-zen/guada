<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { t } from '@/locales'

defineOptions({ inheritAttrs: false })

/**
 * 全屏图片查看器（替代 el-image-viewer）。
 * 聊天图片预览场景：点击缩略图打开，左右切换 / Esc / 点遮罩关闭。
 * 层级高于弹窗（--gd-z-viewer: 3000），低于 toast（4000）。
 */

const props = withDefaults(defineProps<{
  /** 图片地址列表（原图优先） */
  urls: string[]
  /** 受控显示（v-model:visible） */
  visible: boolean
  /** 打开时定位到的索引 */
  initialIndex?: number
  /** 点击遮罩是否关闭 */
  closeOnClickModal?: boolean
  /** Esc 是否关闭 */
  closeOnPressEscape?: boolean
}>(), {
  initialIndex: 0,
  closeOnClickModal: true,
  closeOnPressEscape: true,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

// 循环切换：-1 收敛到末尾，越界回到头部
const currentIndex = ref(0)
const failed = ref(false)
const loading = ref(false)

watch(() => props.visible, (val) => {
  if (val) {
    currentIndex.value = clampIndex(props.initialIndex)
    failed.value = false
    loading.value = false
    lockBodyScroll()
  } else {
    unlockBodyScroll()
  }
})

watch(() => props.urls, () => {
  failed.value = false
  loading.value = false
})

const currentUrl = computed(() => props.urls[currentIndex.value] ?? '')
const counterText = computed(() => `${currentIndex.value + 1} / ${props.urls.length}`)

function clampIndex(i: number): number {
  const len = props.urls.length
  if (len === 0) return 0
  return (i % len + len) % len
}

function prev() {
  if (props.urls.length < 2) return
  currentIndex.value = clampIndex(currentIndex.value - 1)
  failed.value = false
}

function next() {
  if (props.urls.length < 2) return
  currentIndex.value = clampIndex(currentIndex.value + 1)
  failed.value = false
}

function close() {
  if (!props.visible) return
  emit('update:visible', false)
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closeOnPressEscape) {
    e.stopPropagation()
    close()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    next()
  }
}

function handleImgLoad() {
  loading.value = false
}

function handleImgError() {
  loading.value = false
  failed.value = true
}

function handleImgLoadStart() {
  loading.value = true
  failed.value = false
}

function handleOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget && props.closeOnClickModal) close()
}

// ── 背景滚动锁：与 GdDialog 同一引用计数模式 ──
let scrollLocked = false
let savedBodyOverflow = ''

function lockBodyScroll() {
  if (typeof document === 'undefined' || scrollLocked) return
  savedBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  scrollLocked = true
}

function unlockBodyScroll() {
  if (!scrollLocked || typeof document === 'undefined') return
  document.body.style.overflow = savedBodyOverflow
  scrollLocked = false
}

// 键盘监听挂在 document 上：查看器内无输入焦点元素，全局监听最简
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', handleKeydown)
}
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (scrollLocked) unlockBodyScroll()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="l-viewer-fade">
      <div
        v-if="visible && urls.length > 0"
        class="l-viewer gd-image-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="t('common.imagePreview')"
        @click="handleOverlayClick"
      >
        <!-- 顶部：计数 + 关闭 -->
        <div class="l-viewer__bar">
          <span class="l-viewer__counter">{{ counterText }}</span>
          <button class="l-viewer__btn" type="button" :aria-label="t('common.close')" @click="close">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <!-- 左右切换（多图才显示） -->
        <button
          v-if="urls.length > 1"
          class="l-viewer__nav l-viewer__nav--prev"
          type="button"
          :aria-label="t('common.prevImage')"
          @click.stop="prev"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          v-if="urls.length > 1"
          class="l-viewer__nav l-viewer__nav--next"
          type="button"
          :aria-label="t('common.nextImage')"
          @click.stop="next"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <!-- 图片主体 -->
        <img
          :key="currentUrl"
          :src="currentUrl"
          class="l-viewer__img"
          :data-failed="failed"
          alt=""
          @load="handleImgLoad"
          @error="handleImgError"
          @loadstart="handleImgLoadStart"
        >
        <div v-if="loading" class="l-viewer__spinner" aria-hidden="true" />
        <div v-if="failed" class="l-viewer__error">{{ t('common.imageLoadFailed') }}</div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.l-viewer {
  position: fixed;
  inset: 0;
  z-index: var(--gd-z-viewer, 3000);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--gd-color-overlay-strong, rgba(0, 0, 0, 0.82));
}

.l-viewer__bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  z-index: 1;
}

.l-viewer__counter {
  color: var(--gd-color-text-white, #fff);
  font-size: 13px;
  opacity: 0.85;
  user-select: none;
}

.l-viewer__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--gd-color-text-white, #fff);
  cursor: pointer;
  transition: background var(--gd-motion-duration-fast, 0.12s) ease;
  padding: 0;
}

.l-viewer__btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.l-viewer__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--gd-color-text-white, #fff);
  cursor: pointer;
  transition: background var(--gd-motion-duration-fast, 0.12s) ease;
  z-index: 1;
  padding: 0;
}

.l-viewer__nav:hover {
  background: rgba(255, 255, 255, 0.2);
}

.l-viewer__nav--prev {
  left: 16px;
}

.l-viewer__nav--next {
  right: 16px;
}

.l-viewer__img {
  max-width: calc(100vw - 120px);
  max-height: calc(100vh - 80px);
  object-fit: contain;
  user-select: none;
}

.l-viewer__img[data-failed='true'] {
  display: none;
}

.l-viewer__spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: l-viewer-spin 0.8s linear infinite;
}

@keyframes l-viewer-spin {
  to {
    transform: rotate(360deg);
  }
}

.l-viewer__error {
  position: absolute;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
}

/* Transition */
.l-viewer-fade-enter-active,
.l-viewer-fade-leave-active {
  transition: opacity var(--gd-motion-duration-dialog, 0.2s) var(--gd-motion-ease-dialog, ease);
}

.l-viewer-fade-enter-from,
.l-viewer-fade-leave-to {
  opacity: 0;
}
</style>
