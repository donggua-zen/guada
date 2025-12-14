<template>
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div class="flex flex-col md:flex-row bg-white rounded-2xl overflow-hidden shadow-xl max-w-4xl w-full">
            <!-- 左侧插画区域 -->
            <div
                class="hidden md:flex md:w-1/2 bg-gradient-to-br from-indigo-500 to-purple-600 items-center justify-center p-8">
                <div class="text-center text-white">
                    <h1 class="text-3xl font-bold mb-4">欢迎来到AI聊天世界</h1>
                    <p class="text-indigo-100 mb-6">与智能AI进行自然对话，提升工作效率</p>
                    <div class="w-64 h-64 mx-auto">
                        <n-carousel autoplay direction="horizontal" :show-arrow="false" dot-type="dot"
                            dot-placement="bottom" interval="5000" :show-dots="true">
                            <img class="carousel-img w-full h-full object-contain" src="/images/girl_book_512.webp"
                                alt="插画1">
                            <img class="carousel-img w-full h-full object-contain" src="/images/boy_book_512.webp"
                                alt="插画2">
                        </n-carousel>
                    </div>
                </div>
            </div>

            <!-- 右侧登录表单 -->
            <div class="w-full md:w-1/2 p-8 flex flex-col justify-center">
                <div class="text-center mb-8">
                    <h2 class="text-3xl font-bold text-gray-800 mb-2">登录账户</h2>
                    <p class="text-gray-500">请输入您的凭证以访问系统</p>
                </div>

                <!-- 登录方式切换 -->
                <div class="flex justify-center mb-6">
                    <n-tabs v-model:value="loginType" type="segment" class="w-full">
                        <n-tab-pane name="phone" tab="手机登录">
                            <n-form :model="form" :rules="rules" ref="formRef" label-placement="top" :show-label="false"
                                class="mt-4">
                                <n-form-item path="phone" class="mb-4">
                                    <n-input name="login-phone" v-model:value="form.phone" placeholder="请输入手机号"
                                        size="large" class="rounded-lg">
                                        <template #prefix>
                                            <n-icon class="text-gray-400">
                                                <PhoneIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>

                                <n-form-item path="password" class="mb-6">
                                    <n-input name="login-password" v-model:value="form.password" type="password"
                                        show-password-on="click" placeholder="请输入密码" size="large" class="rounded-lg">
                                        <template #prefix>
                                            <n-icon class="text-gray-400">
                                                <LockIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>
                            </n-form>
                        </n-tab-pane>

                        <n-tab-pane name="email" tab="邮箱登录">
                            <n-form :model="form" :rules="rules" ref="formRef" label-placement="top" :show-label="false"
                                class="mt-4">
                                <n-form-item path="email" class="mb-4">
                                    <n-input name="login-email" v-model:value="form.email" placeholder="请输入邮箱地址"
                                        size="large" class="rounded-lg">
                                        <template #prefix>
                                            <n-icon class="text-gray-400">
                                                <MailIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>

                                <n-form-item path="password" class="mb-6">
                                    <n-input name="login-password" v-model:value="form.password" type="password"
                                        show-password-on="click" placeholder="请输入密码" size="large" class="rounded-lg">
                                        <template #prefix>
                                            <n-icon class="text-gray-400">
                                                <LockIcon />
                                            </n-icon>
                                        </template>
                                    </n-input>
                                </n-form-item>
                            </n-form>
                        </n-tab-pane>
                    </n-tabs>
                </div>

                <!-- 记住我和忘记密码 -->
                <div class="flex justify-between items-center mb-6">
                    <n-checkbox v-model:checked="rememberMe" class="text-gray-600">
                        记住我
                    </n-checkbox>
                    <UiButton text type="primary" size="small" class="text-indigo-600 hover:text-indigo-800" @click="handleForgetPassword">
                        忘记密码？
                    </UiButton>
                </div>

                <!-- 登录按钮 -->
                <UiButton type="primary" round block size="large" :loading="loading" @click="handleLogin"
                    class="mb-6 py-3 font-medium rounded-lg shadow-md hover:shadow-lg transition-shadow">
                    <template #icon>
                        <LoginIcon />
                    </template>
                    {{ loading ? '登录中...' : '立即登录' }}
                </UiButton>

                <!-- 注册链接 -->
                <div class="text-center text-gray-600 text-sm">
                    <p>还没有账户？
                        <UiButton text type="primary" class="text-indigo-600 hover:text-indigo-800 font-medium">
                            立即注册
                        </UiButton>
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import {
    NForm,
    NFormItem,
    NInput,
    NTabs,
    NTabPane,
    NIcon,
    NCheckbox,
    NCarousel,
} from 'naive-ui'

import {
    PhoneIphoneOutlined as PhoneIcon,
    MailOutlineOutlined as MailIcon,
    LockOutlined as LockIcon,
    LogInOutlined as LoginIcon
} from '@vicons/material'

import { useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'
import { usePopup } from '../composables/usePopup'
import { useStorage } from '@vueuse/core'
import { UiButton } from './ui'

const authStore = useAuthStore()
// 消息提示
const { toast } = usePopup()

const router = useRouter()

// 登录方式切换
const loginType = useStorage('login-type', 'phone')

// 表单数据
const form = reactive({
    phone: '',
    email: '',
    password: ''
})

// 记住我
const rememberMe = ref(false)

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
                    await authStore.login({
                        type: loginType.value,
                        phone: form.phone,
                        password: form.password,
                        rememberMe: rememberMe.value
                    })
                } else {
                    await authStore.login({
                        type: loginType.value,
                        email: form.email,
                        password: form.password,
                        rememberMe: rememberMe.value
                    })
                }
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

const handleForgetPassword = () => {
    router.push('/password')
}
</script>

<style scoped>
/* 自定义样式 */
.carousel-img {
    border-radius: 12px;
}

:deep(.n-input) {
    --n-border: 1px solid #e5e7eb;
    --n-border-focus: 1px solid #4f46e5;
    --n-box-shadow-focus: 0 0 0 2px rgba(79, 70, 229, 0.2);
}

:deep(.UiButton) {
    --n-height: 46px;
    --n-font-size: 16px;
    --n-color-primary: #4f46e5;
    --n-color-primary-hover: #4338ca;
    --n-color-primary-pressed: #3730a3;
}

:deep(.n-tabs .n-tabs-nav) {
    padding: 0;
    border-radius: 12px;
    background-color: rgb(247, 247, 250);
    padding: 4px;
}

:deep(.n-tabs .n-tabs-tab) {
    border-radius: 8px;
    transition: all 0.2s ease;
}

:deep(.n-tabs .n-tabs-tab--active) {
    background-color: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

:deep(.n-form-item-label) {
    font-weight: 500;
    color: #374151;
}

/* 自定义轮播图指示器 */
:deep(.n-carousel .n-carousel__dots) {
    bottom: -10px;
}

:deep(.n-carousel .n-carousel__dots .n-carousel__dot) {
    background-color: rgba(255, 255, 255, 0.5);
    width: 8px;
    height: 8px;
}

:deep(.n-carousel .n-carousel__dots .n-carousel__dot.n-carousel__dot--active) {
    background-color: white;
    width: 20px;
    border-radius: 4px;
}
</style>