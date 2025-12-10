<template>
    <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div class="flex bg-white rounded-xl overflow-hidden shadow-[0_6px_30px_0_rgba(0,0,0,.08)] py-10 items-center justify-center">
            <div class="flex w-120 items-center justify-center">
                <div class="w-90 h-90">
                    <!-- <img src="/images/girl_book.png" class="w-80 h-80 mx-auto"> -->
                    <n-carousel autoplay direction="horizontal" :show-arrow="false" dot-type="line"
                        dot-placement="bottom">
                        <img class="carousel-img h-full" style="object-fit: cover" src="/images/girl_book_512.webp">
                        <img class="carousel-img h-full" style="object-fit: cover"
                            src="/images/boy_book_512.webp"><template #dots="{ total, currentIndex, to }">
                            <ul class="custom-dots">
                                <li v-for="index of total" :key="index"
                                    :class="{ ['is-active']: currentIndex === index - 1 }" @click="to(index - 1)" />
                            </ul>
                        </template>
                    </n-carousel>
                </div>
            </div>
            <div class="flex items-center justify-centeri flex-col">
                <!-- 登录方式切换 -->
                <div class="flex justify-center px-4 w-full">
                    <n-tabs v-model:value="loginType" type="segment" animated class="w-full">
                        <n-tab-pane name="phone" tab="手机登录"></n-tab-pane>
                        <n-tab-pane name="email" tab="邮箱登录"></n-tab-pane>
                    </n-tabs>
                </div>

                <!-- 登录表单 -->
                <div class="px-8 py-6 min-w-[400px]">
                    <n-form :model="form" :rules="rules" ref="formRef" label-placement="top" :show-label="false">
                        <!-- 手机号/邮箱输入 -->
                        <n-form-item v-if="loginType === 'phone'" label="手机" path="phone" class="mb-2">
                            <n-input name="login-phone" v-model:value="form.phone" placeholder="请输入手机号" size="large">
                                <template #prefix>
                                    <n-icon>
                                        <PhoneIcon />
                                    </n-icon>
                                </template>
                            </n-input>
                        </n-form-item>

                        <n-form-item v-else label="邮箱" path="email" class="mb-2">
                            <n-input name="login-email" v-model:value="form.email" placeholder="请输入邮箱" size="large">
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

                        <!-- 登录按钮 -->
                        <div class="flex justify-center items-center mb-4">
                            <n-button type="primary" round block size="large" :loading="loading" @click="handleLogin">
                                <template #icon>
                                    <n-icon>
                                        <LoginIcon />
                                    </n-icon>
                                </template>
                                {{ loading ? '登录中...' : '立即登录' }}
                            </n-button>
                        </div>

                    </n-form>

                    <!-- 其他选项 -->
                    <div class="flex justify-between items-center text-sm text-gray-500">
                        <n-checkbox v-model:checked="rememberMe">
                            记住我
                        </n-checkbox>
                        <n-button text type="primary" size="small" style="display: none;">
                            忘记密码？
                        </n-button>
                    </div>
                </div>

                <!-- 底部信息 -->
                <div class="px-8 py-4 bg-gray-50 text-center text-sm text-gray-500 border-t display-none"
                    style="display: none;">
                    <p>还没有账号？<n-button text type="primary">立即注册</n-button></p>
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
    NButton,
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
</script>

<style>
/* 自定义样式 */
.n-input {
    --n-border: 1px solid #e5e7eb;
    --n-border-focus: 1px solid #3b82f6;
}

.n-button {
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
<style scoped>
.custom-dots {
    display: flex;
    margin: 0;
    padding: 0;
    position: absolute;
    bottom: 20px;
    left: 20px;
}

.custom-dots li {
    display: inline-block;
    width: 12px;
    height: 4px;
    margin: 0 3px;
    border-radius: 4px;
    background-color: var(--secondary);
    transition:
        width 0.3s,
        background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
}

.custom-dots li.is-active {
    width: 40px;
    background-color: var(--primary);
}
</style>