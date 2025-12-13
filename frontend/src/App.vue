<template>
    <NConfigProvider :theme-overrides="themeOverrides" :theme="theme" :locale="zhCN" :date-locale="dateZhCN">
        <NNotificationProvider>
            <NDialogProvider>
                <NMessageProvider>
                    <RouterView></RouterView>
                </NMessageProvider>
            </NDialogProvider>
        </NNotificationProvider>
    </NConfigProvider>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { NConfigProvider, NNotificationProvider, NDialogProvider, NMessageProvider } from 'naive-ui'
import { zhCN, dateZhCN, darkTheme } from 'naive-ui'
import { useTitle } from './composables/useTitle'
import { useTheme } from './composables/useTheme'
import { computed } from 'vue';
const { isDark, toggleDark } = useTheme()
const theme = computed(() => isDark.value ? darkTheme : null);

/**
  * js 文件下使用这个做类型提示
  * @type import('naive-ui').GlobalThemeOverrides
  */
const themeOverrides = {
    common: {
        primaryColor: '#fb7299',
        primaryColorHover: '#fb7299',
        primaryColorPressed: '#fb72998',
        primaryColorSuppl: '#fb7299',
        primaryColorDisabled: '#fb7299',

    },

    // ...
}
const router = useRouter()
const title = useTitle()
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