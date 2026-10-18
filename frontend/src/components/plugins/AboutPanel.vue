<template>
    <div v-if="isElectron" class="about-panel p-4">
        <div class="flex flex-col items-center justify-center space-y-6 text-center">
            <!-- 应用图标与版本 -->
            <div class="space-y-2">
                <img :src="logoPath" alt="GuaDa Logo" class="w-24 h-24 mx-auto rounded-xl shadow-lg" />
                <h2 class="text-2xl font-bold text-(--gd-color-text-primary)">GuaDa</h2>
                <p class="text-sm text-(--gd-color-text-secondary)">{{ t('plugins.about.version', { version: appVersion }) }}</p>
            </div>

            <!-- 更新状态区域 -->
            <div class="w-full bg-(--gd-color-surface-elevated) rounded-lg p-6 border border-(--gd-color-border)">
                <div class="flex flex-col items-center space-y-4">
                    <div v-if="updateStore.status === 'checking'" class="flex items-center space-x-2 text-blue-500">
                        <el-icon class="is-loading"><Loading /></el-icon>
                        <span>{{ t('plugins.about.checking') }}</span>
                    </div>

                    <div v-else-if="updateStore.status === 'not-available'" class="text-green-500 flex items-center space-x-2">
                        <el-icon><CircleCheck /></el-icon>
                        <span>{{ t('plugins.about.upToDate') }}</span>
                    </div>

                    <div v-else-if="showUpdateSection" class="space-y-3 w-full">
                        <div class="text-orange-500 font-medium">{{ t('plugins.about.newVersion', { version: updateStore.info?.version }) }}</div>
                        <p class="text-xs text-(--gd-color-text-secondary) whitespace-pre-wrap">{{ updateStore.info?.description || t('plugins.about.noUpdateDesc') }}</p>

                        <!-- 下载进度 -->
                        <div v-if="updateStore.isDownloading" class="space-y-2 rounded-lg bg-(--gd-color-surface) p-3 text-left">
                            <div class="flex items-center justify-between text-xs text-(--gd-color-text-secondary)">
                                <span>{{ t('ui.update.downloading', { percent: progressPercent }) }}</span>
                                <span>{{ speedText }}</span>
                            </div>
                            <el-progress :percentage="progressPercent" :stroke-width="8" :show-text="false" :indeterminate="!updateStore.progress?.total" />
                        </div>

                        <!-- 已下载 / 安装中 -->
                        <div v-else-if="updateStore.isDownloaded" class="space-y-1 rounded-lg bg-green-500/10 p-3 text-xs text-green-600 dark:text-green-400 text-left">
                            <div>{{ t('ui.update.downloadComplete') }}</div>
                            <div class="opacity-80">{{ t('ui.update.installTip') }}</div>
                        </div>
                        <div v-else-if="updateStore.status === 'installing'" class="flex items-center justify-center gap-2 rounded-lg bg-blue-500/10 p-3 text-xs text-blue-500">
                            <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></span>
                            <span>{{ t('ui.update.installing') }}</span>
                        </div>

                        <div class="flex gap-2">
                            <template v-if="updateStore.isDownloading">
                                <el-button class="flex-1" @click="updateStore.cancelDownload()">
                                    {{ t('ui.update.cancelDownload') }}
                                </el-button>
                            </template>
                            <template v-else-if="updateStore.isDownloaded">
                                <el-button type="primary" class="flex-1" @click="updateStore.installAndRestart()">
                                    {{ t('ui.update.installAndRestart') }}
                                </el-button>
                            </template>
                            <template v-else-if="updateStore.status === 'installing'">
                                <el-button type="primary" class="flex-1" disabled>
                                    {{ t('ui.update.installing') }}
                                </el-button>
                            </template>
                            <template v-else>
                                <el-button type="primary" class="flex-1" @click="handleDownload">
                                    {{ t('plugins.about.downloadUpdate') }}
                                </el-button>
                                <el-button class="flex-1" @click="updateStore.openChangelog()">
                                    {{ t('plugins.about.viewChangelog') }}
                                </el-button>
                            </template>
                        </div>
                    </div>

                    <div v-else-if="updateStore.status === 'error'" class="text-red-500 text-sm">
                        {{ errorText }}
                    </div>

                    <el-button v-if="canCheck" @click="updateStore.checkForUpdates()" :disabled="updateStore.isChecking" class="w-full">
                        {{ t('plugins.about.checkUpdate') }}
                    </el-button>
                </div>
            </div>

            <!-- 仓库地址 -->
            <div class="w-full bg-(--gd-color-surface-elevated) rounded-lg p-6 border border-(--gd-color-border)">
                <h3 class="text-sm font-medium text-(--gd-color-text-primary) mb-4">{{ t('plugins.about.repository') }}</h3>
                <div class="flex flex-col space-y-3">
                    <div v-for="repo in repositories" :key="repo.url"
                        class="flex items-center justify-between cursor-pointer p-2 rounded-md hover:bg-(--gd-color-bg) transition-colors"
                        @click="openRepo(repo.url)">
                        <div class="flex items-center space-x-3">
                            <span class="text-lg">{{ repo.icon }}</span>
                            <div>
                                <div class="text-sm text-(--gd-color-text-primary)">{{ repo.name }}</div>
                                <div class="text-xs text-(--gd-color-text-secondary)">{{ repo.url }}</div>
                            </div>
                        </div>
                        <el-icon class="text-(--gd-color-text-secondary)"><Link /></el-icon>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div v-else class="p-8 text-center text-(--gd-color-text-secondary)">
        {{ t('plugins.about.desktopOnly') }}
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElIcon, ElProgress } from 'element-plus'
import { Loading, CircleCheck, Link } from '@element-plus/icons-vue'
import { fixFrontendAssetUrl } from '@/utils/url'
import { openInExternalBrowser } from '@/utils/browserUtils'
import { useUpdateStore } from '@/stores/update'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const { t } = useI18n()
const updateStore = useUpdateStore()
const appVersion = ref('')

const repositories = [
    { name: 'GitHub', url: 'https://github.com/donggua-zen/guada', icon: '🐙' },
    { name: 'Gitee', url: 'https://gitee.com/zhendongdong/guada_ai', icon: '🇨' },
    { name: 'GitCode', url: 'https://atomgit.com/donggua_sherlock/GuaDaAI', icon: '📦' },
]

const openRepo = (url: string) => {
    openInExternalBrowser(url)
}

// 计算属性：自适应 Logo 路径
const logoPath = computed(() => fixFrontendAssetUrl('/images/logo.png'))

const showUpdateSection = computed(() =>
    ['available', 'downloading', 'downloaded', 'installing'].includes(updateStore.status),
)

const canCheck = computed(() =>
    ['idle', 'not-available', 'error'].includes(updateStore.status),
)

const progressPercent = computed(() =>
    Math.max(0, Math.min(99, Math.round(updateStore.progress?.percent || 0))),
)

const speedText = computed(() => {
    const speed = updateStore.progress?.bytesPerSecond || 0
    if (!speed) return ''
    if (speed >= 1024 * 1024) return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
    return `${Math.max(1, Math.round(speed / 1024))} KB/s`
})

const errorText = computed(() => {
    const error = updateStore.error || ''
    if (updateStore.errorPhase === 'download') {
        return t('plugins.about.downloadFailed', { error })
    }
    if (updateStore.errorPhase === 'install') {
        return t('plugins.about.installFailed', { error })
    }
    return t('plugins.about.checkFailed', { error })
})

const handleDownload = () => {
    if (updateStore.canInPlaceUpdate) {
        void updateStore.startDownload()
    } else {
        updateStore.openManualDownload()
    }
}

onMounted(async () => {
    if (window.electronAPI) {
        const info = await window.electronAPI.getAppInfo()
        appVersion.value = info.version
        updateStore.init()
    }
})
</script>

<style scoped>
.about-panel {
    height: 100%;
    overflow-y: auto;
}
</style>
