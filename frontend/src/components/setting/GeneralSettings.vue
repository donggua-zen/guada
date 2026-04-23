<template>
    <div class="flex-1 overflow-hidden">
        <!-- 头部区域 -->
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
            <span>通用设置</span>
        </div>

        <!-- 设置内容 -->
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-[#1e1e1e]">
            <div class="p-6">
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-base font-medium">免登录模式</span>
                            <el-tooltip 
                                content="开启后将自动使用主账户登录，无需输入密码。适用于个人本地使用场景。" 
                                placement="top"
                            >
                                <el-icon class="text-gray-400 cursor-help" :size="16">
                                    <HelpOutlineOutlined />
                                </el-icon>
                            </el-tooltip>
                        </div>
                        <div class="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            开启后，刷新页面或访问应用时会自动使用主账户登录，无需手动输入用户名和密码。
                        </div>
                        <div class="text-xs text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 rounded border border-orange-200 dark:border-orange-800">
                            <el-icon class="inline-block mr-1" :size="14">
                                <WarningOutlined />
                            </el-icon>
                            注意：开启此功能后，任何访问此应用的人都将自动获得主账户权限，请谨慎使用。
                        </div>
                    </div>
                    <div class="ml-6">
                        <el-switch 
                            v-model="autoLoginEnabled" 
                            @change="handleAutoLoginChange"
                            :loading="saving"
                            size="large"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElSwitch, ElTooltip, ElIcon } from 'element-plus'
import { HelpOutlineOutlined, WarningOutlined } from '@vicons/material'
import { useAuthStore } from '../../stores/auth'
import { usePopup } from '../../composables/usePopup'

const authStore = useAuthStore()
const { toast } = usePopup()

const autoLoginEnabled = ref(false)
const saving = ref(false)

// 加载免登录状态
const loadAutoLoginStatus = async () => {
    try {
        await authStore.checkAutoLoginStatus()
        autoLoginEnabled.value = authStore.autoLoginEnabled
    } catch (error) {
        console.error('加载免登录状态失败:', error)
        toast.error('加载配置失败')
    }
}

// 处理开关变化
const handleAutoLoginChange = async (value: string | number | boolean) => {
    const enabled = value === true
    saving.value = true
    try {
        await authStore.setAutoLoginEnabled(enabled)
        toast.success(enabled ? '已开启免登录模式' : '已关闭免登录模式')
        
        // 如果关闭了免登录，且当前没有 token，提示用户重新登录
        if (!enabled && !authStore.isAuthenticated) {
            toast.info('请重新登录以继续使用')
            setTimeout(() => {
                window.location.href = '/login'
            }, 1500)
        }
    } catch (error: any) {
        console.error('保存免登录状态失败:', error)
        toast.error(error.message || '保存配置失败')
        // 恢复原值
        autoLoginEnabled.value = !enabled
    } finally {
        saving.value = false
    }
}

onMounted(() => {
    loadAutoLoginStatus()
})
</script>
