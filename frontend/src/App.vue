<template>
    <!-- 自定义标题栏（仅在 Electron 环境显示） -->
    <div class="flex flex-col h-full bg-(--color-surface)">
        <CustomTitlebar />
        <RouterView></RouterView>
    </div>
    <!-- Mock 控制面板（仅开发环境） -->
    <MockControlPanel v-if="isDev" />
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { useTitle } from './composables/useTitle'
import { useTheme } from './composables/useTheme'
import MockControlPanel from './components/dev/MockControlPanel.vue'
import CustomTitlebar from './components/CustomTitlebar.vue'

const router = useRouter()
const title = useTitle()
const theme = useTheme() //不要删除，这里会执行dark模式设置
const isDev = import.meta.env.DEV

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