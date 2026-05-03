<template>
    <!-- 主题切换遮罩层 -->
    <div 
        v-if="showThemeTransition" 
        class="theme-transition-overlay"
        :class="{ 'theme-transition-active': isTransitioning }"
        :style="{ backgroundColor: transitionColor }"
    ></div>
    
    <!-- 自定义标题栏（仅在 Electron 环境显示） -->
    <div class="flex flex-col h-full bg-(--color-sidebar-bg)">
        <CustomTitlebar @open-guide="openGuide" />
        <SetupGuide ref="guideRef" />
        <RouterView></RouterView>
    </div>
    <!-- Mock 控制面板（仅开发环境） -->
    <MockControlPanel v-if="isDev" />
</template>

<script setup>
import { ref, provide, onMounted, watch } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { useTitle } from './composables/useTitle'
import { useTheme } from './composables/useTheme'
import MockControlPanel from './components/dev/MockControlPanel.vue'
import CustomTitlebar from './components/CustomTitlebar.vue'
import SetupGuide from './components/SetupGuide.vue'
import ContextMenuManager from './utils/ContextMenuManager'

const router = useRouter()
const title = useTitle()
const theme = useTheme() //不要删除，这里会执行dark模式设置
const isDev = import.meta.env.DEV
const guideRef = ref(null)

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
            }, 800)
            
            // 1000ms 后完全移除遮罩
            setTimeout(() => {
                showThemeTransition.value = false
            }, 1000)
        }
    }
)

// 初始化全局右键菜单管理器
onMounted(() => {
  ContextMenuManager.getInstance().init()
})

// 提供打开引导的方法给全局使用
const openGuide = () => {
  if (guideRef.value) {
    guideRef.value.openGuide()
  }
}
provide('openGuide', openGuide)

router.beforeEach((to, from, next) => {
    if (to.meta.title) {
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