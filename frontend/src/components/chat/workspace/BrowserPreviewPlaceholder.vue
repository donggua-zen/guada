<template>
  <div v-show="store.activeWebview" class="browser-preview-placeholder">
    <!-- 浏览器导航栏 -->
    <div class="browser-toolbar">
      <!-- 导航按钮组 -->
      <div class="nav-btn-group">
        <button
          class="nav-btn"
          :title="t('chat.workspace.back')"
          :disabled="!store.canGoBack"
          @click="goBack"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button
          class="nav-btn"
          :title="t('chat.workspace.forward')"
          :disabled="!store.canGoForward"
          @click="goForward"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <button
          class="nav-btn"
          :title="store.isLoading ? t('chat.workspace.stop') : t('chat.workspace.refresh')"
          @click="store.isLoading ? stopLoading() : refresh()"
        >
          <!-- 刷新图标 / 停止图标 -->
          <svg v-if="!store.isLoading" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- 地址栏 -->
      <div class="address-bar-wrapper" :class="{ focused: addressFocused }">
        <svg class="security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <input
          ref="addressBarRef"
          v-model="addressInput"
          class="address-input"
          type="text"
          :placeholder="t('chat.workspace.inputUrlPlaceholder')"
          autocomplete="none"
          spellcheck="false"
          @focus="addressFocused = true"
          @blur="addressFocused = false"
          @keydown.enter="navigateToUrl"
        />
        <span v-if="store.isLoading" class="loading-spinner"></span>
      </div>

      <!-- 渲染视口选择（仅当前网页，DevTools 风格） -->
      <div class="viewport-control">
        <button
          ref="viewportBtnRef"
          class="viewport-btn"
          :title="t('chat.workspace.viewportSize')"
          @click="viewportMenuVisible = !viewportMenuVisible"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
          <span class="viewport-label">{{ viewportLabel }}</span>
        </button>
        <GdPopover v-model:show="viewportMenuVisible" :anchor-el="viewportBtnRef" :width="210">
          <div class="viewport-menu">
            <button
              class="viewport-option"
              :class="{ active: isAdaptiveActive }"
              @click="applyAdaptive"
            >
              <span>{{ t('chat.workspace.viewportAdaptive') }}</span>
              <span class="viewport-option-right">
                <span v-if="adaptiveSizeLabel" class="viewport-option-size">{{ adaptiveSizeLabel }}</span>
                <svg v-if="isAdaptiveActive" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
            </button>
            <div class="viewport-divider"></div>
            <button
              v-for="p in VIEWPORT_PRESETS"
              :key="`${p.width}x${p.height}`"
              class="viewport-option"
              :class="{ active: isViewportActive(p) }"
              @click="applyViewport(p.width, p.height, true)"
            >
              <span>{{ p.width }} × {{ p.height }}</span>
              <svg v-if="isViewportActive(p)" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <div class="viewport-custom">
              <span class="viewport-custom-label">{{ t('chat.workspace.viewportCustom') }}</span>
              <div class="viewport-custom-inputs">
                <el-input-number
                  v-model="customWidth"
                  :min="VIEWPORT_MIN.width" :max="VIEWPORT_MAX.width" :step="10"
                  :controls="false" size="small" style="width: 60px"
                  @change="applyCustomViewport"
                />
                <span>×</span>
                <el-input-number
                  v-model="customHeight"
                  :min="VIEWPORT_MIN.height" :max="VIEWPORT_MAX.height" :step="10"
                  :controls="false" size="small" style="width: 60px"
                  @change="applyCustomViewport"
                />
              </div>
            </div>
          </div>
        </GdPopover>
      </div>

      <!-- 静音切换按钮 -->
      <button class="nav-btn" :title="store.isMuted ? t('chat.workspace.unmute') : t('chat.workspace.mute')" @click="store.toggleMuted()">
        <!-- 静音状态：喇叭带斜线 -->
        <svg v-if="store.isMuted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
        <!-- 非静音状态：喇叭带声波 -->
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      </button>

      <!-- 指针锁释放：网页锁定鼠标时显示（也可用 Esc / Ctrl+Alt+R） -->
      <button
        v-if="store.isActivePointerLocked"
        class="pointer-lock-chip"
        :title="t('chat.workspace.pointerLockHint')"
        @click="releasePointerLock"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        </svg>
        <span>{{ t('chat.workspace.releasePointer') }}</span>
      </button>
    </div>

    <!-- 空壳占位区域：webview 实际覆盖在此区域上方（由 BrowserWebviewLayer 定位） -->
    <div ref="placeholderRef" class="placeholder-body"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBrowserWebviewStore } from '@/stores/browserWebview'
import {
  VIEWPORT_PRESETS, VIEWPORT_MIN, VIEWPORT_MAX, isValidViewportSize,
} from '@/utils/browserViewport'

const { t } = useI18n()
const store = useBrowserWebviewStore()

const placeholderRef = ref<HTMLElement>()
const addressBarRef = ref<HTMLInputElement>()
const addressInput = ref('')
const addressFocused = ref(false)

// ── 渲染视口选择（仅当前网页生效，内存保存不持久化） ──
const viewportMenuVisible = ref(false)
const viewportBtnRef = ref<HTMLElement>()
const customWidth = ref(1280)
const customHeight = ref(720)

/** 当前网页是否自适应预览面板 */
const isAdaptiveActive = computed(() => {
  const windowId = store.activeWindowId
  return !!windowId && store.getViewportMode(windowId) === 'adaptive'
})

/** 自适应模式下菜单里显示的实时尺寸（非自适应时为空） */
const adaptiveSizeLabel = computed(() => {
  const windowId = store.activeWindowId
  if (!windowId || store.getViewportMode(windowId) !== 'adaptive') return ''
  const { width, height } = store.getViewportSize(windowId)
  return `${width} × ${height}`
})

/** 当前网页的生效渲染视口（按钮上的标签） */
const viewportLabel = computed(() => {
  const windowId = store.activeWindowId
  if (!windowId) return ''
  if (store.getViewportMode(windowId) === 'adaptive') {
    return t('chat.workspace.viewportAdaptive')
  }
  const { width, height } = store.getViewportSize(windowId)
  return `${width} × ${height}`
})

// 打开菜单时把输入框同步为当前生效值
watch(viewportMenuVisible, (visible) => {
  if (!visible || !store.activeWindowId) return
  const { width, height } = store.getViewportSize(store.activeWindowId)
  customWidth.value = width
  customHeight.value = height
})

function isViewportActive(preset: { width: number; height: number }): boolean {
  const windowId = store.activeWindowId
  if (!windowId) return false
  // 自适应模式下列表项一律不高亮：实时尺寸可能碰巧等于某个预设
  if (store.getViewportMode(windowId) !== 'fixed') return false
  const current = store.getViewportSize(windowId)
  return current.width === preset.width && current.height === preset.height
}

/** 应用视口到当前网页（覆盖仅对 windowId 生效，不影响其他网页） */
function applyViewport(width: number, height: number, closeMenu: boolean): void {
  const windowId = store.activeWindowId
  if (!windowId || !isValidViewportSize(width, height)) return
  store.setWebviewViewport(windowId, width, height)
  if (closeMenu) viewportMenuVisible.value = false
}

/** 当前网页切换为自适应（布局盒跟随预览面板尺寸） */
function applyAdaptive(): void {
  const windowId = store.activeWindowId
  if (!windowId) return
  store.setWebviewAdaptive(windowId, true)
  viewportMenuVisible.value = false
}

function applyCustomViewport(): void {
  const w = Math.round(Number(customWidth.value) || 0)
  const h = Math.round(Number(customHeight.value) || 0)
  if (!isValidViewportSize(w, h)) return
  applyViewport(w, h, false)
}

let resizeObserver: ResizeObserver | null = null
let rafId: number | null = null

/**
 * 通过 ResizeObserver + requestAnimationFrame 实时报告占位区域坐标
 */
function updateRect(): void {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    const el = placeholderRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    store.setPreviewRect({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
  })
}

// ── 浏览器导航操作 ──

function goBack(): void {
  const wv = store.activeWebviewEl as ElectronWebviewElement | null
  if (wv && wv.canGoBack) wv.goBack()
}

function goForward(): void {
  const wv = store.activeWebviewEl as ElectronWebviewElement | null
  if (wv && wv.canGoForward) wv.goForward()
}

function refresh(): void {
  const wv = store.activeWebviewEl as ElectronWebviewElement | null
  if (wv) wv.reload()
}

function stopLoading(): void {
  const wv = store.activeWebviewEl as ElectronWebviewElement | null
  if (wv) wv.stop()
}

/** 强制释放网页对鼠标/键盘的锁定（Pointer Lock / Fullscreen） */
function releasePointerLock(): void {
  const windowId = store.activeWindowId
  if (!windowId) return
  void window.electronAPI?.releaseBrowserInput?.(windowId, { focusHost: true })
}

async function navigateToUrl(): Promise<void> {
  const wv = store.activeWebviewEl as ElectronWebviewElement | null
  if (!wv) return

  let target = addressInput.value.trim()
  if (!target) return

  // URL 格式判断：有协议头或包含域名特征
  if (!/^https?:\/\//.test(target) && !/^file:\/\//.test(target)) {
    if (/\s/.test(target) || !target.includes('.')) {
      // 包含空格或无点号 → 视为搜索
      target = 'https://www.bing.com/search?q=' + encodeURIComponent(target)
    } else {
      target = 'https://' + target
    }
  }

  try {
    await wv.loadURL(target)
  } catch (error) {
    // Chromium may reject loadURL on a redirect or aborted navigation;
    // the webview navigation events remain the source of truth.
    console.warn('浏览器导航请求失败:', error)
  }
  addressBarRef.value?.blur()
}

// ── 监听活跃 webview URL 变化，同步地址栏 ──

watch(
  () => store.activeWebview?.url,
  (url) => {
    // 地址栏未聚焦时自动同步当前 URL
    if (!addressFocused.value) {
      // about: 内部页显示为空，提示用户输入
      addressInput.value = url && !url.startsWith('about:') ? url : ''
    }
  },
)

// 监听活跃窗口变化
watch(
  () => store.activeWindowId,
  async () => {
    if (store.activeWindowId) {
      await nextTick()
      updateRect()
      // 同步地址栏（about: 内部页显示为空）
      const url = store.activeWebview?.url || ''
      addressInput.value = url && !url.startsWith('about:') ? url : ''
    } else {
      store.setPreviewRect(null)
    }
  },
)

onMounted(() => {
  resizeObserver = new ResizeObserver(updateRect)
  if (placeholderRef.value) {
    resizeObserver.observe(placeholderRef.value)
  }
  window.addEventListener('resize', updateRect)
  if (store.activeWindowId) {
    updateRect()
    addressInput.value = store.activeWebview?.url || ''
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (rafId !== null) cancelAnimationFrame(rafId)
  window.removeEventListener('resize', updateRect)
  store.setPreviewRect(null)
})
</script>

<style scoped>
.browser-preview-placeholder {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

/* ── 导航栏 ── */
.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 36px;
  flex-shrink: 0;
  background: transparent;
  border-bottom: 1px solid var(--gd-color-border, #d0d0d0);
}

/* 导航按钮组 */
.nav-btn-group {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.nav-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text-secondary, #555);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.nav-btn:hover:not(:disabled) {
  background: var(--gd-color-hover-bg, #e0e0e0);
}

.nav-btn:active:not(:disabled) {
  background: var(--gd-color-border, #d0d0d0);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.dark .nav-btn {
  color: #aaa;
}

.dark .nav-btn:hover:not(:disabled) {
  background: var(--gd-color-hover-bg, #3e4147);
}

/* 指针锁释放按钮 */
.pointer-lock-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  margin-left: 4px;
  border: 1px solid #f59e0b;
  border-radius: 13px;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.pointer-lock-chip:hover {
  background: rgba(245, 158, 11, 0.2);
}

.dark .pointer-lock-chip {
  border-color: #b45309;
  color: #fbbf24;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* 地址栏 */
.address-bar-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  background: var(--gd-color-bg-primary, #ffffff);
  border: 1px solid var(--gd-color-border, #c0d0d0);
  border-radius: 14px;
  padding: 0 10px;
  height: 26px;
  transition: border-color 0.2s;
}

.address-bar-wrapper.focused {
  border-color: var(--gd-color-primary, #4a90d9);
}

.dark .address-bar-wrapper {
  background: var(--gd-color-bg-primary, #1a1b1e);
  border-color: var(--gd-color-border, #3e4147);
}

.security-icon {
  width: 11px;
  height: 11px;
  opacity: 0.5;
  flex-shrink: 0;
}

.address-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 12px;
  color: inherit;
  font-family: inherit;
  min-width: 0;
}

.address-input::placeholder {
  opacity: 0.5;
}

/* 加载旋转动画 */
.loading-spinner {
  width: 12px;
  height: 12px;
  border: 1px solid var(--gd-color-border, #ccc);
  border-top-color: var(--gd-color-primary, #4a90d9);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── 渲染视口选择器 ── */
.viewport-control {
  flex-shrink: 0;
  margin-left: 4px;
}

.viewport-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--gd-color-border, #c0d0d0);
  border-radius: 13px;
  background: transparent;
  color: var(--gd-color-text-secondary, #555);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s;
}

.viewport-btn:hover {
  border-color: var(--gd-color-primary, #4a90d9);
  color: var(--gd-color-primary, #4a90d9);
}

.viewport-label {
  font-variant-numeric: tabular-nums;
}

/* GdPopover 内容（teleport 到 body，但 slot 编译于本组件作用域，scoped 样式生效） */
.viewport-menu {
  display: flex;
  flex-direction: column;
}

.viewport-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.viewport-option:hover {
  background: var(--gd-color-hover-bg, #e0e0e0);
}

.viewport-option.active {
  color: var(--gd-color-primary, #4a90d9);
  font-weight: 600;
}

/* 自适应行右侧：实时尺寸 + 勾选 */
.viewport-option-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.viewport-option-size {
  font-size: 11px;
  color: var(--gd-color-text-secondary, #888);
  font-variant-numeric: tabular-nums;
}

.viewport-option.active .viewport-option-size {
  color: inherit;
  opacity: 0.8;
}

.viewport-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--gd-color-border, #d0d0d0);
}

.viewport-custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  padding: 7px 10px 4px;
  border-top: 1px solid var(--gd-color-border, #d0d0d0);
}

.viewport-custom-label {
  font-size: 12px;
  color: var(--gd-color-text-secondary, #555);
  white-space: nowrap;
}

.viewport-custom-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--gd-color-text-secondary, #555);
  font-variant-numeric: tabular-nums;
}

/* 占位主体 */
.placeholder-body {
  flex: 1;
  min-height: 0;
  /* 空壳：webview 会覆盖在此区域上方 */
}
</style>
