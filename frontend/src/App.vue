<template>
    <!-- 主题切换遮罩层 -->
    <div v-if="showThemeTransition" class="theme-transition-overlay"
        :class="{ 'theme-transition-active': isTransitioning }" :style="{ backgroundColor: transitionColor }"></div>

    <!-- 主内容区域 -->
    <div class="flex flex-col h-full">
        <SetupGuide ref="guideRef" />
        <el-config-provider :locale="elLocale">
            <RouterView></RouterView>
        </el-config-provider>
    </div>

    <!-- 全局右键菜单 (Electron 剪贴板操作) -->
    <ContextMenu :visible="globalMenuVisible" :x="globalMenuX" :y="globalMenuY" :items="globalMenuItems.map(item => ({
        label: item.label,
        onClick: item.action || (() => { }),
    }))" @close="globalMenuVisible = false" />

</template>

<script setup>
import { ref, provide, onMounted, watch, computed } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import { useTitle } from './composables/useTitle'
import { useTheme } from './composables/useTheme'
import { useTrayStats } from './composables/useTrayStats'
import { i18n, getLocale } from './locales'
import { useLanguage } from './composables/useLanguage'
import MockControlPanel from './components/dev/MockControlPanel.vue'
import SetupGuide from './components/SetupGuide.vue'
import ContextMenuManager from './utils/ContextMenuManager'

const router = useRouter()
const title = useTitle()
const theme = useTheme() //不要删除，这里会执行dark模式设置
useTrayStats() // 托盘悬浮窗统计推送（仅 Electron 生效）
const isDev = import.meta.env.DEV
const guideRef = ref(null)
const { initLanguage } = useLanguage()

// Element Plus 组件内置文案随语言切换
const elLocale = computed(() => (getLocale() === 'en-US' ? en : zhCn))

// 主题切换过渡状态
const showThemeTransition = ref(false)
const isTransitioning = ref(false)
const transitionColor = ref('var(--color-sidebar-bg)') // 使用 CSS 变量,自动适配主题

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
    initLanguage()
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