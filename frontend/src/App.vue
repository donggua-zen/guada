<template>
    <n-config-provider :theme="theme" :locale="zhCN" :date-locale="dateZhCN">
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
</script>

<style></style>