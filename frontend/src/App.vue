<template>
    <!-- 主题切换遮罩层 -->
    <div v-if="showThemeTransition" class="theme-transition-overlay"
        :class="{ 'theme-transition-active': isTransitioning }" :style="{ backgroundColor: transitionColor }"></div>

    <!-- 主内容区域 -->
    <div class="flex flex-col h-full">
        <SetupGuide ref="guideRef" />
        <RouterView></RouterView>
        <GdDialogHost />
        <GdToastHost />
    </div>

    <!-- 全局右键菜单 (Electron 剪贴板操作) -->
    <ContextMenu :visible="globalMenuVisible" :x="globalMenuX" :y="globalMenuY" :items="globalMenuItems.map(item => ({
        label: item.label,
        onClick: item.action || (() => { }),
    }))" @close="globalMenuVisible = false" />

</template>

<script setup>
import { ref, provide, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { useTitle } from './composables/useTitle'
import { useTheme } from './composables/useTheme'
import { useTrayStats } from './composables/useTrayStats'
import { useLayoutStore } from './stores/layout'
import { useSessionStore } from './stores/session'
import { apiService } from './services/ApiService'
import { i18n, getLocale } from './locales'
import MockControlPanel from './components/dev/MockControlPanel.vue'
import SetupGuide from './components/SetupGuide.vue'
import GdDialogHost from './components/ui/GdDialogHost.vue'
import GdToastHost from './components/ui/GdToastHost.vue'
import ContextMenuManager from './utils/ContextMenuManager'

const router = useRouter()
const title = useTitle()
const theme = useTheme() //不要删除，这里会执行dark模式设置
useTrayStats() // 桌宠 + 托盘状态推送（仅 Electron 生效）
const isDev = import.meta.env.DEV
const guideRef = ref(null)

const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()

/**
 * 桌宠发起的操作（桌宠窗没有后端 token，统一转回主窗口渲染层执行）
 *
 * - toggle-enabled：托盘菜单/右键菜单改了开关 → 这里落盘，保持后端为单一真相
 * - open-session：点气泡 → 进会话（顺带清未读，与侧边栏点击同语义）
 * - stop-session：点气泡停止 → 走既有 cancelResponse（后端 stop 接口）
 */
let unsubscribePetAction = null
onMounted(() => {
  if (!window.electronAPI?.onPetAction) return
  unsubscribePetAction = window.electronAPI.onPetAction((payload) => {
    if (payload.kind === 'toggle-enabled') {
      const enabled = payload.enabled === true
      layoutStore.setPetEnabled(enabled)
      layoutStore.applyPetSettings()
      void apiService
        .updateGroupSettings('pet', { enabled })
        .catch((error) => console.error('保存桌宠开关失败:', error))
      return
    }
    if (payload.kind === 'open-session') {
      const sessionId = payload.sessionId
      if (!sessionId) return
      sessionStore.setSidebarFlag(sessionId, 'unread', false)
      router.replace({ name: 'Chat', params: { sessionId } })
      return
    }
    if (payload.kind === 'stop-session') {
      const sessionId = payload.sessionId
      if (!sessionId) return
      void apiService
        .cancelResponse(sessionId)
        .catch((error) => console.error('停止会话失败:', error))
    }
  })
})

onUnmounted(() => {
  unsubscribePetAction?.()
  unsubscribePetAction = null
})

// 主题切换过渡状态
const showThemeTransition = ref(false)
const isTransitioning = ref(false)
const transitionColor = ref('var(--gd-color-sidebar-bg)') // 使用 CSS 变量,自动适配主题

// 监听主题变化,触发过渡动画
watch(
    () => theme.isDark.value,
    (newVal, oldVal) => {
        if (oldVal !== undefined && newVal !== oldVal) {
            // 开始过渡动画
            showThemeTransition.value = true
            isTransitioning.value = true

            // 800ms 后开始淡出
            setTimeout(() => {
                isTransitioning.value = false
            }, 400)

            // 1000ms 后完全移除遮罩
            setTimeout(() => {
                showThemeTransition.value = false
            }, 700)
        }
    }
)

// 全局右键菜单状态
const globalMenuVisible = ref(false)
const globalMenuX = ref(0)
const globalMenuY = ref(0)
const globalMenuItems = ref([])

// 初始化全局右键菜单管理器 (Electron 环境下)
onMounted(() => {
    const mgr = ContextMenuManager.getInstance()
    mgr.setShowMenuFn((x, y, items) => {
        globalMenuX.value = x
        globalMenuY.value = y
        globalMenuItems.value = items
        globalMenuVisible.value = true
    })
    mgr.init()
})

// 提供打开引导的方法给全局使用
const openGuide = () => {
    if (guideRef.value) {
        guideRef.value.openGuide()
    }
}
provide('openGuide', openGuide)

router.beforeEach((to, from, next) => {
    if (to.meta.titleKey) {
        title.value = i18n.global.t(to.meta.titleKey);
    } else if (to.meta.title) {
        if (typeof to.meta.title === 'function') {
            title.value = to.meta.title(to);
        } else {
            title.value = to.meta.title;
        }
    }
    next();
});
</script>

<style scoped>
/* 主题切换过渡遮罩层 */
.theme-transition-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease-out;
}

/* 激活状态 - 完全不透明，立即显示 */
.theme-transition-active {
    opacity: 1;
    transition: opacity 0.15s ease-in;
}
</style>