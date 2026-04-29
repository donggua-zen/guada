<template>
    <!-- 自定义标题栏（仅在 Electron 环境显示） -->
    <div class="flex flex-col h-full bg-(--color-surface)">
        <CustomTitlebar @open-guide="openGuide" />
        <SetupGuide ref="guideRef" />
        <RouterView></RouterView>
    </div>
    <!-- Mock 控制面板（仅开发环境） -->
    <MockControlPanel v-if="isDev" />
</template>

<script setup>
import { ref, provide, onMounted } from 'vue'
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

<style></style>