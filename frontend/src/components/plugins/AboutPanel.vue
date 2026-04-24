<template>
    <div v-if="isElectron" class="about-panel p-4">
        <div class="flex flex-col items-center justify-center space-y-6 text-center">
            <!-- 应用图标与版本 -->
            <div class="space-y-2">
                <img src="/images/logo.png" alt="AI Chat Logo" class="w-24 h-24 mx-auto rounded-xl shadow-lg" />
                <h2 class="text-2xl font-bold text-(--color-text-primary)">AI Chat</h2>
                <p class="text-sm text-(--color-text-secondary)">当前版本: {{ appVersion }}</p>
            </div>

            <!-- 更新状态区域 -->
            <div class="w-full max-w-md bg-(--color-surface-elevated) rounded-lg p-6 border border-(--color-border)">
                <div class="flex flex-col items-center space-y-4">
                    <div v-if="updateStatus === 'checking'" class="flex items-center space-x-2 text-blue-500">
                        <el-icon class="is-loading"><Loading /></el-icon>
                        <span>正在检查更新...</span>
                    </div>
                    
                    <div v-else-if="updateStatus === 'not-available'" class="text-green-500 flex items-center space-x-2">
                        <el-icon><CircleCheck /></el-icon>
                        <span>已是最新版本</span>
                    </div>

                    <div v-else-if="updateStatus === 'available'" class="space-y-3 w-full">
                        <div class="text-orange-500 font-medium">发现新版本: {{ updateInfo?.version }}</div>
                        <p class="text-xs text-(--color-text-secondary) whitespace-pre-wrap">{{ updateInfo?.releaseNotes || '' }}</p>
                        <el-button type="primary" @click="handleDownload" :loading="isDownloading" class="w-full">
                            {{ isDownloading ? `下载中 ${downloadProgress}%` : '立即下载' }}
                        </el-button>
                    </div>

                    <div v-else-if="updateStatus === 'downloaded'" class="space-y-3 w-full">
                        <div class="text-green-600 font-medium">更新包已就绪</div>
                        <el-button type="success" @click="handleInstall" class="w-full">
                            立即重启并安装
                        </el-button>
                    </div>

                    <div v-else-if="updateStatus === 'error'" class="text-red-500 text-sm">
                        检查更新失败: {{ errorMessage }}
                    </div>

                    <el-button v-if="updateStatus === 'idle' || updateStatus === 'not-available' || updateStatus === 'error'" 
                               @click="checkForUpdates" 
                               :disabled="isChecking" 
                               class="w-full">
                        检查更新
                    </el-button>
                </div>
            </div>
        </div>
    </div>
    <div v-else class="p-8 text-center text-(--color-text-secondary)">
        此功能仅在桌面客户端中可用
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElButton, ElIcon } from 'element-plus'
import { Loading, CircleCheck } from '@element-plus/icons-vue'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const appVersion = ref('')
const updateStatus = ref<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'>('idle')
const updateInfo = ref<any>(null)
const downloadProgress = ref(0)
const isChecking = ref(false)
const isDownloading = ref(false)
const errorMessage = ref('')

const checkForUpdates = async () => {
    if (!window.electronAPI) return
    isChecking.value = true
    updateStatus.value = 'checking'
    errorMessage.value = ''
    
    try {
        const res = await window.electronAPI.checkForUpdates()
        if (!res.success) {
            updateStatus.value = 'error'
            errorMessage.value = res.error
        }
    } catch (e: any) {
        updateStatus.value = 'error'
        errorMessage.value = e.message
    } finally {
        isChecking.value = false
    }
}

const handleDownload = () => {
    if (!window.electronAPI) return
    isDownloading.value = true
    window.electronAPI.startDownloadUpdate()
}

const handleInstall = () => {
    if (!window.electronAPI) return
    window.electronAPI.installAndRestart()
}

const handleUpdateStatus = (status: any) => {
    switch (status.status) {
        case 'checking':
            updateStatus.value = 'checking'
            break
        case 'available':
            updateStatus.value = 'available'
            updateInfo.value = status.info
            break
        case 'not-available':
            updateStatus.value = 'not-available'
            break
        case 'downloading':
            updateStatus.value = 'downloading'
            downloadProgress.value = Math.round(status.progress)
            break
        case 'downloaded':
            updateStatus.value = 'downloaded'
            isDownloading.value = false
            break
        case 'error':
            updateStatus.value = 'error'
            errorMessage.value = status.error
            isChecking.value = false
            isDownloading.value = false
            break
    }
}

onMounted(async () => {
    if (window.electronAPI) {
        const info = await window.electronAPI.getAppInfo()
        appVersion.value = info.version
        
        // 监听更新状态
        window.electronAPI.onUpdateStatus(handleUpdateStatus)
    }
})

onUnmounted(() => {
    // 注意：ipcRenderer 监听器在 preload 中处理，这里无需手动移除
    // 如果需要更精细的控制，可以在 preload 中返回一个取消监听的函数
})
</script>

<style scoped>
.about-panel {
    height: 100%;
    overflow-y: auto;
}
</style>
