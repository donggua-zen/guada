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
                        <el-carousel autoplay direction="horizontal" indicator-position="none" :interval="5000"
                            arrow="never" height="256px">
                            <el-carousel-item>
                                <img class="carousel-img w-full h-full object-contain" src="/images/girl_book_512.webp"
                                    alt="插画1">
                            </el-carousel-item>
                            <el-carousel-item>
                                <img class="carousel-img w-full h-full object-contain" src="/images/boy_book_512.webp"
                                    alt="插画2">
                            </el-carousel-item>
                        </el-carousel>
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
                <div class="flex justify-center mb-6 custom-segmented">
                    <el-segmented v-model="loginType" :options="loginTypeOptions" block />
                </div>

                <!-- 手机登录表单 -->
                <div v-show="loginType === 'phone'">
                    <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="mt-4">
                        <el-form-item prop="phone" class="mb-4">
                            <el-input v-model="form.phone" placeholder="请输入手机号" size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400">
                                        <PhoneIcon class="w-4 h-4" />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>

                        <el-form-item prop="password" class="mb-6">
                            <el-input v-model="form.password" type="password" show-password placeholder="请输入密码"
                                size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400 text-base">
                                        <LockIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>
                    </el-form>
                </div>

                <!-- 邮箱登录表单 -->
                <div v-show="loginType === 'email'">
                    <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="mt-4">
                        <el-form-item prop="email" class="mb-4">
                            <el-input v-model="form.email" placeholder="请输入邮箱地址" size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400 text-base">
                                        <MailIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>

                        <el-form-item prop="password" class="mb-6">
                            <el-input v-model="form.password" type="password" show-password placeholder="请输入密码"
                                size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400">
                                        <LockIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>
                    </el-form>
                </div>

                <!-- 记住我和忘记密码 -->
                <div class="flex justify-between items-center mb-6">
                    <el-checkbox v-model="rememberMe" label="记住我" />
                    <el-button type="primary" link @click="handleForgetPassword">
                        忘记密码？
                    </el-button>
                </div>

                <!-- 登录按钮 -->
                <el-button type="primary" round size="large" :loading="loading" @click="handleLogin"
                    class="mb-6 py-3 font-medium rounded-lg shadow-md hover:shadow-lg transition-shadow w-full">
                    <template #icon>
                        <LoginIcon />
                    </template>
                    {{ loading ? '登录中...' : '立即登录' }}
                </el-button>

                <!-- 注册链接 -->
                <div class="text-center text-gray-600 text-sm flex justify-center items-center">
                    <span>还没有账户？</span>
                    <el-button type="primary" link>
                        立即注册
                    </el-button>
                </div>
            </div>
        </div>
    </div>
</template>

<!-- @ts-ignore - Element Plus 组件类型缺失 -->
<script setup lang="ts">
import { ref, reactive } from 'vue'
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

// Element Plus 组件导入
import {
    ElForm,
    ElFormItem,
    ElInput,
    ElSegmented,
    ElIcon,
    ElCheckbox,
    ElCarousel,
    ElCarouselItem,
    ElButton
} from 'element-plus'

const authStore = useAuthStore()
// 消息提示
const { toast } = usePopup()

const router = useRouter()

// 登录方式切换 - 类型化
const loginType = useStorage<string>('login-type', 'phone')

// 登录选项 - 类型化
const loginTypeOptions = [
    {
        label: '手机登录',
        value: 'phone'
    },
    {
        label: '邮箱登录',
        value: 'email'
    }
]

// 表单数据 - 类型化
interface LoginForm {
    phone: string;
    email: string;
    password: string;
}

const form = reactive<LoginForm>({
    phone: '',
    email: '',
    password: ''
})

// 记住我 - 类型化
const rememberMe = ref(false)

// 加载状态 - 类型化
const loading = ref(false)

// 表单验证规则 - 类型化
const rules = reactive({
    phone: {
        required: true,
        trigger: ['input', 'blur'],
        validator: (rule: any, value: string, callback: any) => {
            if (loginType.value === 'phone') {
                if (!value) {
                    callback(new Error('请输入手机号'))
                    return
                }
                const phoneRegex = /^1[3-9]\d{9}$/
                if (!phoneRegex.test(value)) {
                    callback(new Error('请输入正确的手机号'))
                    return
                }
            }
            callback()
        }
    },
    email: {
        required: true,
        trigger: ['input', 'blur'],
        validator: (rule: any, value: string, callback: any) => {
            if (loginType.value === 'email') {
                if (!value) {
                    callback(new Error('请输入邮箱'))
                    return
                }
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                if (!emailRegex.test(value)) {
                    callback(new Error('请输入正确的邮箱'))
                    return
                }
            }
            callback()
        }
    },
    password: {
        required: true,
        trigger: ['input', 'blur'],
        message: '请输入密码'
    }
})

// 表单引用 - 类型化
const formRef = ref<any>(null)

// 登录处理 - 类型化
const handleLogin = async (): Promise<void> => {
    formRef.value?.validate(async (valid: boolean) => {
        if (valid) {
            loading.value = true
            try {
                // 根据登录方式构建不同的登录参数
                const loginData = {
                    type: loginType.value,
                    username: loginType.value === 'phone' ? form.phone : form.email,
                    password: form.password
                }
                
                await authStore.login(loginData)
                router.replace('/')
            } catch (error: any) {
                console.error(error)
                toast.error(error.message || error.toString())
            } finally {
                loading.value = false
            }
        } else {
            toast.error('请检查输入信息')
        }
    })
}

const handleForgetPassword = (): void => {
    router.push('/password')
}
</script>

<style scoped>
/* 自定义样式 */
.carousel-img {
    border-radius: 12px;
}

:deep(.el-input__wrapper) {
    box-shadow: 0 0 0 1px #e5e7eb inset;
}

:deep(.el-input.is-focus .el-input__wrapper) {
    box-shadow: 0 0 0 1px #4f46e5 inset;
}

:deep(.el-button--primary) {
    --el-button-bg-color: #4f46e5;
    --el-button-border-color: #4f46e5;
    --el-button-hover-bg-color: #4338ca;
    --el-button-hover-border-color: #4338ca;
    --el-button-active-bg-color: #3730a3;
    --el-button-active-border-color: #3730a3;
}

:deep(.custom-segmented .el-segmented) {
    --el-segmented-item-selected-color: var(--el-text-color-primary);
    --el-segmented-item-selected-bg-color: white;
    --el-border-radius-base: 12px;
    /* background-color: rgb(247, 247, 250); */
    padding: 8px 8px;
}

:deep(.custom-segmented .el-segmented__item) {
    border-radius: 12px;
    transition: all 0.2s ease;
    padding: 5px 30px;
    margin-left: 10px;

}

:deep(.custom-segmented .el-segmented__item:first-child) {
    margin-left: 0;
}

:deep(.custom-segmented .el-segmented__item.is-selected) {
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

:deep(.el-form-item__label) {
    font-weight: 500;
    color: #374151;
}

/* 自定义轮播图指示器 */
:deep(.el-carousel__indicators) {
    bottom: -10px;
}

:deep(.el-carousel__indicator) {
    background-color: rgba(255, 255, 255, 0.5);
    width: 8px;
    height: 8px;
}

:deep(.el-carousel__indicator.is-active) {
    background-color: white;
    width: 20px;
    border-radius: 4px;
}
</style>