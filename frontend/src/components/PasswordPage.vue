<template>
    <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div
            class="flex flex-col lg:flex-row bg-white rounded-xl overflow-hidden shadow-[0_6px_30px_0_rgba(0,0,0,.08)] w-full max-w-6xl">
            <!-- 左侧说明区域 - 在移动端位于上方 -->
            <div
                class="lg:w-2/5 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 md:p-8 flex items-center justify-center">
                <div class="max-w-md w-full">
                    <h2 class="text-xl md:text-2xl font-bold text-gray-800 mb-4 md:mb-6 text-center">欢迎使用 AI 聊天系统</h2>
                    <div class="space-y-4">
                        <div class="flex items-start">
                            <div class="flex-shrink-0 mt-1">
                                <svg class="h-5 w-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <p class="ml-3 text-gray-600 text-sm md:text-base">您好！这是您首次登录系统，请设置一个安全密码。</p>
                        </div>

                        <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <svg class="h-5 w-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fill-rule="evenodd"
                                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                            clip-rule="evenodd" />
                                    </svg>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-blue-700">
                                        <strong>安全提示：</strong>请勿使用常用密码，建议使用包含大小写字母、数字和特殊字符的组合。
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-start">
                            <div class="flex-shrink-0 mt-1">
                                <svg class="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <p class="ml-3 text-gray-600 text-sm md:text-base">设置完成后，您将可以正常使用系统的所有功能。</p>
                        </div>

                        <div class="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <svg class="h-5 w-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fill-rule="evenodd"
                                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                            clip-rule="evenodd" />
                                    </svg>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-yellow-700">
                                        <strong>重置说明：</strong>如需再次设置密码，请删除后端目录下的 <code
                                            class="bg-gray-100 px-1 rounded">password_is_set.txt</code> 文件并刷新本页面。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 右侧表单区域 - 在移动端位于下方 -->
            <div class="lg:w-3/5 p-6 md:p-8 flex items-center justify-center">
                <div class="w-full max-w-md">
                    <!-- 登录方式切换 -->
                    <div class="flex justify-center mb-6">
                        <n-tabs v-model:value="loginType" type="segment" animated class="w-full">
                            <n-tab-pane name="phone" tab="手机账户"></n-tab-pane>
                            <n-tab-pane name="email" tab="邮箱账户"></n-tab-pane>
                        </n-tabs>
                    </div>

                    <!-- 登录表单 -->
                    <div class="w-full">
                        <template v-if="canReset">
                            <n-form :model="form" :rules="rules" ref="formRef" label-placement="top"
                                :show-label="false">
                                <!-- 手机号/邮箱输入 -->
                                <n-form-item v-if="loginType === 'phone'" label="手机" path="phone" class="mb-4">
                                    <n-input name="login-phone" v-model:value="form.phone" placeholder="请输入手机号"
                                        size="large">
                                        <template #prefix>
                                            <n-icon>
                                                <PhoneIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>

                                <n-form-item v-else label="邮箱" path="email" class="mb-4">
                                    <n-input name="login-email" v-model:value="form.email" placeholder="请输入邮箱"
                                        size="large">
                                        <template #prefix>
                                            <n-icon>
                                                <MailIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>
                                <!-- 密码输入 -->
                                <n-form-item label="密码" path="password" class="mb-4">
                                    <n-input name="login-password" v-model:value="form.password" type="password"
                                        placeholder="请输入密码" size="large">
                                        <template #prefix>
                                            <n-icon>
                                                <LockIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>

                                <!-- 确认密码输入 -->
                                <n-form-item label="确认密码" path="confirmPassword" class="mb-6">
                                    <n-input name="confirm-password" v-model:value="form.confirmPassword"
                                        type="password" placeholder="请再次输入密码" size="large">
                                        <template #prefix>
                                            <n-icon>
                                                <LockIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>

                                <!-- 登录按钮 -->
                                <div class="flex justify-center">
                                    <UiButton type="primary" round block size="large" :loading="loading"
                                        @click="handleLogin">
                                        <template #icon>
                                            <LoginIcon />
                                        </template>
                                        {{ loading ? '设置中...' : '立刻设置' }}
                                    </UiButton>
                                </div>
                            </n-form>
                        </template>
                        <template v-else>
                            <div class="text-center py-8">
                                <div class="text-lg text-gray-500 mb-4">无权限重置密码</div>
                                <n-button @click="router.go(0)">刷新页面</n-button>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
    NForm,
    NFormItem,
    NInput,
    NTabs,
    NTabPane,
    NIcon,
    NButton
} from 'naive-ui'

import {
    PhoneIphoneOutlined as PhoneIcon,
    MailOutlineOutlined as MailIcon,
    LockOutlined as LockIcon,
    LogInOutlined as LoginIcon
} from '@vicons/material'

import { useRouter } from 'vue-router'

import { apiService } from '../services/ApiService'
import { usePopup } from '../composables/usePopup'
import { useStorage } from '@vueuse/core'
import { UiButton } from './ui'

// 消息提示
const { toast, confirmSuccess } = usePopup()

const router = useRouter()

// 登录方式切换
const loginType = useStorage('login-type', 'phone')
const canReset = ref(false)

// 表单数据
const form = reactive({
    phone: '',
    email: '',
    password: '',
    confirmPassword: ''
})

// 记住我

// 加载状态
const loading = ref(false)

// 表单验证规则
const rules = {
    phone: {
        required: true,
        trigger: ['input', 'blur'],
        validator: (rule, value) => {
            if (loginType.value === 'phone') {
                if (!value) {
                    return new Error('请输入手机号')
                }
                const phoneRegex = /^1[3-9]\d{9}$/
                if (!phoneRegex.test(value)) {
                    return new Error('请输入正确的手机号')
                }
            }
            return true
        }
    },
    email: {
        required: true,
        trigger: ['input', 'blur'],
        validator: (rule, value) => {
            if (loginType.value === 'email') {
                if (!value) {
                    return new Error('请输入邮箱')
                }
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                if (!emailRegex.test(value)) {
                    return new Error('请输入正确的邮箱')
                }
            }
            return true
        }
    },
    password: {
        required: true,
        trigger: ['input', 'blur'],
        message: '请输入密码'
    },
    confirmPassword: {
        required: true,
        trigger: ['input', 'blur'],
        validator: (rule, value) => {
            if (!value) {
                return new Error('请再次输入密码')
            }
            if (value !== form.password) {
                return new Error('两次输入的密码不一致')
            }
            return true
        }
    }
}

// 表单引用
const formRef = ref(null)

// 登录处理
const handleLogin = async () => {
    await formRef.value?.validate(async (errors) => {
        if (!errors) {
            loading.value = true
            try {

                if (loginType.value === 'phone') {
                    await apiService.resetPrimayPassword({
                        type: loginType.value,
                        email: form.email,
                        password: form.password,
                    });
                } else {
                    await apiService.resetPrimayPassword({
                        type: loginType.value,
                        email: form.email,
                        password: form.password,
                    })
                }
                await confirmSuccess('登录成功', '密码重置成功，点击确认跳转到首页');
                router.replace('/')

            } catch (error) {
                console.error(error)
                toast.error(error)
            } finally {
                loading.value = false
            }
        } else {
            toast.error('请检查输入信息')
        }
    })
}

onMounted(async () => {
    try {
        await apiService.checkResetPassword()
        canReset.value = true
    } catch (error) {
        console.error(error)
        canReset.value = false
    }
})

</script>

<style>
/* 自定义样式 */
.n-input {
    --n-border: 1px solid #e5e7eb;
    --n-border-focus: 1px solid #3b82f6;
}

.UiButton {
    --n-height: 44px;
    --n-font-size: 16px;
}

.n-tabs .n-tabs-nav {
    padding: 0 16px;
}

.n-form-item-label {
    font-weight: 500;
    color: #374151;
}
</style>