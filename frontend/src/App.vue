<template>
    <n-config-provider :theme-overrides="themeOverrides" :theme="theme" :locale="zhCN" :date-locale="dateZhCN">
        <n-notification-provider>
            <n-dialog-provider>
                <n-message-provider>
                    <n-loading-bar-provider>
                        <RouterView></RouterView>
                    </n-loading-bar-provider>
                </n-message-provider>
            </n-dialog-provider>
        </n-notification-provider>
    </n-config-provider>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { NConfigProvider, NNotificationProvider, NDialogProvider, NMessageProvider, NLoadingBarProvider } from 'naive-ui'
import { zhCN, dateZhCN } from 'naive-ui'
const theme = ref(null);
import { useTitle } from './composables/useTitle'
/**
  * js 文件下使用这个做类型提示
  * @type import('naive-ui').GlobalThemeOverrides
  */
const themeOverrides = {
    common: {
        primaryColor: '#18a058',
        primaryColorHover: '#18a058',
        primaryColorPressed: '#18a058',
        primaryColorSuppl: '#18a058',
        primaryColorDisabled: '#18a058',

    },
    Button: {
        textColor: '#1F2937',
        color:'#18a058',
        colorFocus:'#18a058'
    },
    Select: {
        // peers: {
        //     InternalSelection: {
        //         textColor: '#FF0000'
        //     }
        // }
    }
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