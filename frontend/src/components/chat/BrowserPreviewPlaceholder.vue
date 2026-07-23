<template>
  <div v-show="store.activeWebview" class="browser-preview-placeholder">
    <!-- 浏览器导航栏 -->
    <div class="browser-toolbar">
      <!-- 导航按钮组 -->
      <div class="nav-btn-group">
        <button
          class="nav-btn"
          title="后退"
          :disabled="!store.canGoBack"
          @click="goBack"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button
          class="nav-btn"
          title="前进"
          :disabled="!store.canGoForward"
          @click="goForward"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <button
          class="nav-btn"
          :title="store.isLoading ? '停止' : '刷新'"
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
          placeholder="输入网址或搜索"
          autocomplete="none"
          spellcheck="false"
          @focus="addressFocused = true"
          @blur="addressFocused = false"
          @keydown.enter="navigateToUrl"
        />
        <span v-if="store.isLoading" class="loading-spinner"></span>
      </div>

      <!-- 静音切换按钮 -->
      <button class="nav-btn" :title="store.isMuted ? '取消静音' : '静音'" @click="store.toggleMuted()">
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
    </div>

    <!-- 空壳占位区域：webview 实际覆盖在此区域上方（由 BrowserWebviewLayer 定位） -->
    <div ref="placeholderRef" class="placeholder-body"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useBrowserWebviewStore } from '@/stores/browserWebview'

const store = useBrowserWebviewStore()

const placeholderRef = ref<HTMLElement>()
const addressBarRef = ref<HTMLInputElement>()
const addressInput = ref('')
const addressFocused = ref(false)

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
  const wv = store.activeWebviewEl as any
  if (wv && wv.canGoBack) wv.goBack()
}

function goForward(): void {
  const wv = store.activeWebviewEl as any
  if (wv && wv.canGoForward) wv.goForward()
}

function refresh(): void {
  const wv = store.activeWebviewEl as any
  if (wv) wv.reload()
}

function stopLoading(): void {
  const wv = store.activeWebviewEl as any
  if (wv) wv.stop()
}

function navigateToUrl(): void {
  const wv = store.activeWebviewEl as any
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

  wv.setAttribute('src', target)
  addressBarRef.value?.blur()
}

function close(): void {
  store.setActive(null)
  store.setPreviewRect(null)
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
  border-bottom: 1px solid var(--color-border, #d0d0d0);
}

@media (prefers-color-scheme: dark) {
  .browser-toolbar {
    background: transparent;
    border-color: var(--color-border, #3e4147);
  }
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
  color: var(--color-text-secondary, #555);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.nav-btn:hover:not(:disabled) {
  background: var(--color-hover-bg, #e0e0e0);
}

.nav-btn:active:not(:disabled) {
  background: var(--color-border, #d0d0d0);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

@media (prefers-color-scheme: dark) {
  .nav-btn {
    color: #aaa;
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--color-hover-bg, #3e4147);
  }
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
  background: var(--color-bg-primary, #ffffff);
  border: 1px solid var(--color-border, #c0d0d0);
  border-radius: 14px;
  padding: 0 10px;
  height: 26px;
  transition: border-color 0.2s;
}

.address-bar-wrapper.focused {
  border-color: var(--color-primary, #4a90d9);
}

@media (prefers-color-scheme: dark) {
  .address-bar-wrapper {
    background: var(--color-bg-primary, #1a1b1e);
    border-color: var(--color-border, #3e4147);
  }
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
  border: 1.5px solid var(--color-border, #ccc);
  border-top-color: var(--color-primary, #4a90d9);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 占位主体 */
.placeholder-body {
  flex: 1;
  min-height: 0;
  /* 空壳：webview 会覆盖在此区域上方 */
}
</style>
