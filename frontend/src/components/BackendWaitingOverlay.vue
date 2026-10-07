<template>
  <div class="startup-loading">
    <!-- 36px 拖拽条：与画布同色浑然一体，仅承担窗口拖拽；
         右上角窗口按钮由 Windows 原生 titleBarOverlay 绘制 -->
    <div class="startup-dragbar"></div>

    <main class="startup-stage">
      <!-- 加载视图 -->
      <template v-if="!error">
        <img class="startup-logo" :src="logoUrl" alt="GuaDa" draggable="false" />
        <div class="progress-track">
          <div class="progress-thumb"></div>
        </div>
        <p class="status-text">{{ t('ui.backend.starting') }}</p>
        <Transition name="hint-fade">
          <p v-if="showDelayedHint" class="delayed-hint">
            {{ t('ui.backend.startingDesc') }}
          </p>
        </Transition>
      </template>

      <!-- 错误视图 -->
      <template v-else>
        <div class="error-badge-wrap">
          <img class="startup-logo error-logo" :src="logoUrl" alt="GuaDa" draggable="false" />
          <svg class="error-badge" viewBox="0 0 24 24" width="30" height="30">
            <circle cx="12" cy="12" r="11" fill="#f56c6c" />
            <line x1="12" y1="6.5" x2="12" y2="13.5" stroke="#ffffff" stroke-width="2.4"
              stroke-linecap="round" />
            <circle cx="12" cy="17.2" r="1.4" fill="#ffffff" />
          </svg>
        </div>
        <h2 class="error-title">{{ t('ui.backend.startFailed') }}</h2>
        <p class="error-text">{{ error }}</p>
        <button class="retry-button" @click="retry">{{ t('ui.backend.retry') }}</button>
      </template>
    </main>

    <footer class="startup-foot">
      <span>GuaDa<template v-if="appVersion">&nbsp;v{{ appVersion }}</template></span>
      <span>© {{ year }} GuaDa</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fixFrontendAssetUrl } from '@/utils/url'
import { useTheme } from '@/composables/useTheme'
import { backendError } from '@/composables/useBackendStatus'

const { t } = useI18n()
const { isDark } = useTheme()

// 直接读全局后端状态：main.js 在超时（60s）/启动失败时写入 backendError，
// 此处自动切换为错误视图
const error = computed(() => backendError.value)

const logoUrl = fixFrontendAssetUrl('/images/guada_logo_small.png')
const appVersion = ref('')
const year = new Date().getFullYear()

// 启动 8 秒仍未就绪时淡入"首次启动需初始化数据"提示（无真实阶段事件，不做假进度）
const showDelayedHint = ref(false)
const hintTimer = setTimeout(() => {
  showDelayedHint.value = true
}, 8000)
onUnmounted(() => clearTimeout(hintTimer))

// 拖拽条上不再挂 CustomTitlebar，需在此按暗/浅（而非主题）同步窗口按钮符号色，
// 避免浅色画布上默认白色符号不可见
function syncWindowControlsColor(): void {
  if (window.electronAPI?.platform !== 'win32') return
  window.electronAPI?.setWindowControlsColor?.({
    symbolColor: isDark.value ? '#ffffff' : '#000000',
  })
}

onMounted(() => {
  syncWindowControlsColor()
  window.electronAPI
    ?.getAppInfo()
    .then((info) => {
      appVersion.value = info.version
    })
    .catch(() => {})
})

watch(isDark, syncWindowControlsColor)

function retry(): void {
  window.location.reload()
}
</script>

<style scoped>
/* ═══ 启动加载页：只跟随暗/浅，不跟随自定义主题 ═══
   本页所有颜色写死（取值对照 style.css 默认主题的暗/浅两态），
   不引用任何 --gd-* 变量、不使用 data-theme 选择器——
   主题 CSS（异步 <link> 注入）到达前后本页像素零变化，杜绝跳变。
   暗/浅切换仅依赖 html.dark class（index.html 首帧脚本已同步好），
   同款先例见 style.css 壁纸遮罩层。 */

.startup-loading {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fdfdfd;
  color: #222222;
}

/* 高度与 electron/main.ts 的 TITLEBAR_HEIGHT 对应，两侧需同步修改 */
.startup-dragbar {
  height: 36px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.startup-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 内容重心略上移，视觉更稳 */
  padding-bottom: 48px;
}

.startup-logo {
  height: 64px;
  width: auto;
  animation: logo-breathe 1.6s ease-in-out infinite alternate;
}

.progress-track {
  width: 160px;
  height: 3px;
  margin-top: 32px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.progress-thumb {
  width: 40%;
  height: 100%;
  border-radius: inherit;
  background: #fb7299;
  animation: progress-slide 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

.status-text {
  margin: 16px 0 0;
  font-size: 14px;
  font-weight: 500;
}

.delayed-hint {
  margin: 8px 0 0;
  max-width: 320px;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  color: #909399;
}

.startup-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px 14px;
  font-size: 12px;
  color: #b9bcc2;
}

/* ── 错误态 ── */

.error-badge-wrap {
  position: relative;
}

.error-logo {
  animation: none;
  opacity: 0.4;
}

.error-badge {
  position: absolute;
  right: -8px;
  bottom: -4px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.15));
}

.error-title {
  margin: 24px 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.error-text {
  margin: 0;
  max-width: 360px;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
  color: #909399;
  word-break: break-word;
}

.retry-button {
  margin-top: 24px;
  padding: 8px 32px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
  background: #fb7299;
  cursor: pointer;
  transition: background 0.2s ease;
}

.retry-button:hover {
  background: #f45c8c;
}

.retry-button:active {
  background: #e64f80;
}

/* ── 暗色：仅按 html.dark 门控切换写死色值 ── */

.dark .startup-loading {
  background: #222222;
  color: #d3d3d3;
}

.dark .progress-track {
  background: rgba(255, 255, 255, 0.09);
}

.dark .delayed-hint,
.dark .error-text {
  color: #8b8f98;
}

.dark .startup-foot {
  color: #6f737c;
}

/* ── 动效 ── */

@keyframes logo-breathe {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}

@keyframes progress-slide {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(260%);
  }
}

.hint-fade-enter-active {
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}

.hint-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

@media (prefers-reduced-motion: reduce) {
  .startup-logo {
    animation: none;
    opacity: 0.85;
  }

  .progress-thumb {
    animation: none;
    transform: translateX(60%);
  }
}
</style>
