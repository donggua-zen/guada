<template>
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div class="flex flex-col md:flex-row bg-white rounded-2xl overflow-hidden shadow-xl max-w-4xl w-full">
            <!-- 左侧说明区域 -->
            <div
                class="hidden md:flex md:w-1/2 bg-gradient-to-br from-indigo-500 to-purple-600 items-center justify-center p-8">
                <div class="text-center text-white">
                    <h1 class="text-3xl font-bold mb-4">设置安全密码</h1>
                    <p class="text-indigo-100 mb-6">为了保护您的账户安全，请设置一个强密码</p>
                    <div class="space-y-4 text-left">
                        <div class="flex items-center">
                            <div class="flex-shrink-0 leading-none">
                                <svg class="h-5 w-5 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <p class="ml-3 text-indigo-100 text-sm">使用至少8位字符的密码</p>
                        </div>

                        <div class="flex items-center">
                            <div class="flex-shrink-0 leading-none">
                                <svg class="h-5 w-5 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <p class="ml-3 text-indigo-100 text-sm">混合使用大小写字母、数字和符号</p>
                        </div>

                        <div class="flex items-center">
                            <div class="flex-shrink-0 leading-none">
                                <svg class="h-5 w-5 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <p class="ml-3 text-indigo-100 text-sm">避免使用常见的密码组合</p>
                        </div>

                        <div class="flex items-center">
                            <div class="flex-shrink-0 leading-none">
                                <svg class="h-5 w-5 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <p class="ml-3 text-indigo-100 text-sm">定期更换密码以保障账户安全</p>
                        </div>
                    </div>
                </div>

            </div>

            <!-- 右侧表单区域 -->
            <div class="w-full md:w-1/2 p-8 flex flex-col justify-center">
                <div class="text-center mb-8">
                    <h2 class="text-3xl font-bold text-gray-800 mb-2">设置密码</h2>
                    <p class="text-gray-500" v-if="canReset">这是您首次登录系统，请设置一个安全密码</p>
                    <p class="text-gray-500" v-else>您当前没有权限重置密码</p>
                </div>

                <!-- 登录方式切换 -->
                <div class="flex justify-center mb-6 custom-segmented">
                    <el-segmented v-model="loginType" :options="loginTypeOptions" block v-if="canReset" />
                </div>

                <!-- 手机账户表单 -->
                <div v-show="loginType === 'phone'" v-if="canReset">
                    <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="mt-4">
                        <el-form-item prop="phone" class="mb-4">
                            <el-input v-model="form.phone" placeholder="请输入手机号" size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400">
                                        <PhoneIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>

                        <el-form-item label="密码" prop="password" class="mb-4">
                            <el-input v-model="form.password" type="password" show-password placeholder="请输入密码"
                                size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400">
                                        <LockIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>

                        <el-form-item label="确认密码" prop="confirmPassword" class="mb-6">
                            <el-input v-model="form.confirmPassword" type="password" show-password placeholder="请再次输入密码"
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

                <!-- 邮箱账户表单 -->
                <div v-show="loginType === 'email'" v-if="canReset">
                    <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="mt-4">
                        <el-form-item prop="email" class="mb-4">
                            <el-input v-model="form.email" placeholder="请输入邮箱地址" size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400">
                                        <MailIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>

                        <el-form-item label="密码" prop="password" class="mb-4">
                            <el-input v-model="form.password" type="password" show-password placeholder="请输入密码"
                                size="large">
                                <template #prefix>
                                    <el-icon class="text-gray-400">
                                        <LockIcon />
                                    </el-icon>
                                </template>
                            </el-input>
                        </el-form-item>

                        <el-form-item label="确认密码" prop="confirmPassword" class="mb-6">
                            <el-input v-model="form.confirmPassword" type="password" show-password placeholder="请再次输入密码"
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

                <div v-else class="w-full text-center py-8">
                    <div class="mt-6 bg-red-50 border border-red-200 rounded-xl p-5 text-left shadow-sm">
                        <div class="flex">
                            <div class="flex-shrink-0">
                                <svg class="h-6 w-6 text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <div class="ml-4">
                                <h3 class="text-lg font-medium text-red-800">权限说明</h3>
                                <div class="mt-3 text-sm text-red-700">
                                    <p class="mb-2">您当前没有权限重置密码，请按以下步骤操作：</p>
                                    <ol class="list-decimal pl-5 space-y-1">
                                        <li>子账户重置请联系系统管理员</li>
                                        <li>主账户如需重置，请删除后端目录下的 <code
                                                class="bg-red-100 px-1.5 py-0.5 rounded text-red-800 font-mono">password_is_set.txt</code>
                                            文件</li>
                                        <li>刷新本页面重新设置密码</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 设置按钮 -->
                <el-button v-if="canReset" type="primary" round size="large" :loading="loading" @click="handleLogin"
                    class="mb-6 py-3 font-medium rounded-lg shadow-md hover:shadow-lg transition-shadow w-full">
                    <template #icon>
                        <LoginIcon />
                    </template>
                    {{ loading ? '设置中...' : '立即设置' }}
                </el-button>

                <!-- 移动端安全提醒 -->
                <div class="md:hidden space-y-4 mb-6" v-if="canReset">
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

                <div v-else class="md:hidden">
                    <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                        <div class="flex">
                            <div class="flex-shrink-0">
                                <svg class="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                            <div class="ml-3">
                                <p class="text-sm text-red-700">
                                    您当前没有权限重置密码，请联系管理员或刷新页面重试。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<!-- @ts-ignore - Element Plus 组件类型缺失 -->
<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import {
    PhoneIphoneOutlined as PhoneIcon,
    MailOutlineOutlined as MailIcon,
    LockOutlined as LockIcon,
    LogInOutlined as LoginIcon
} from '@vicons/material'

import { useRouter } from 'vue-router'

// @ts-ignore - ApiService 尚未迁移到 TypeScript
import { apiService } from '../services/ApiService'
import { usePopup } from '../composables/usePopup'
import { useStorage } from '@vueuse/core'

// Element Plus 组件导入
import {
    ElForm,
    ElFormItem,
    ElInput,
    ElSegmented,
    ElIcon,
    ElButton,
    ElResult
} from 'element-plus'

// 消息提示
const { toast, confirmSuccess } = usePopup()

const router = useRouter()

// 登录方式切换 - 类型化
const loginType = useStorage<string>('login-type', 'phone')

// 登录选项 - 类型化
const loginTypeOptions = [
    {
        label: '手机账户',
        value: 'phone'
    },
    {
        label: '邮箱账户',
        value: 'email'
    }
]

const canReset = ref(false)

// 表单数据 - 类型化
interface PasswordForm {
    phone: string;
    email: string;
    password: string;
    confirmPassword: string;
}

const form = reactive<PasswordForm>({
    phone: '',
    email: '',
    password: '',
    confirmPassword: ''
})

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
    },
    confirmPassword: {
        required: true,
        trigger: ['input', 'blur'],
        validator: (rule: any, value: string, callback: any) => {
            if (!value) {
                callback(new Error('请再次输入密码'))
                return
            }
            if (value !== form.password) {
                callback(new Error('两次输入的密码不一致'))
                return
            }
            callback()
        }
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
                // 根据登录方式构建不同的参数
                const resetData = {
                    username: loginType.value === 'phone' ? form.phone : form.email,
                    password: form.password,
                }
                
                await apiService.resetPrimayPassword(resetData as any);
                await confirmSuccess('设置成功', '密码设置成功，点击确认跳转到首页');
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

onMounted(async (): Promise<void> => {
    try {
        await apiService.checkResetPassword()
        canReset.value = true
    } catch (error) {
        console.error(error)
        canReset.value = false
    }
})

</script>

<style scoped>
/* 自定义样式 */

.custom-segmented .el-segmented {
    --el-segmented-item-selected-color: var(--el-text-color-primary);
    --el-segmented-item-selected-bg-color: white;
    --el-border-radius-base: 12px;
    /* background-color: rgb(247, 247, 250); */
    padding: 8px 8px;
}

.custom-segmented .el-segmented__item {
    border-radius: 12px;
    transition: all 0.2s ease;
    padding: 5px 30px;
    margin-left: 10px;

}

.custom-segmented .el-segmented__item:first-child {
    margin-left: 0;
}

.custom-segmented .el-segmented__item.is-selected {
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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

:deep(.el-form-item__label) {
    font-weight: 500;
    color: #374151;
}
</style>
