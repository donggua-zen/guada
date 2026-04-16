<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
    <div class="w-full max-w-4xl flex bg-white rounded-lg shadow-2xl overflow-hidden">
      <!-- 左侧品牌区域 -->
      <div
        class="hidden md:flex md:w-1/2 bg-linear-to-br from-blue-500 to-blue-700 text-white p-12 flex-col justify-between">
        <div>
          <div class="flex items-center mb-8">
            <div class="w-12 h-12 rounded-full bg-white bg-opacity-20 flex items-center justify-center mr-4">
              <el-icon class="text-white text-2xl">
                <LoginIcon />
              </el-icon>
            </div>
            <h1 class="text-3xl font-bold">AI Chat</h1>
          </div>
          <p class="text-blue-100 text-xl mb-6">智能对话，让思考更高效</p>
          <p class="text-blue-200 text-base leading-relaxed">
            开源好用的大语言模型对话平台<br>
            提供流畅自然的对话体验
          </p>
        </div>
        <div class="text-blue-300 text-sm">
          &copy; 2026 AI Chat. All rights reserved.
        </div>
      </div>

      <!-- 右侧登录表单区域 -->
      <div class="w-full md:w-1/2 p-12">
        <div class="mb-10">
          <h2 class="text-2xl font-semibold text-gray-800">登录</h2>
          <p class="text-gray-500 text-base mt-2">欢迎回来，请登录您的账户</p>
        </div>

        <!-- 邮箱登录表单 -->
        <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="space-y-6">
          <el-form-item prop="email">
            <el-input v-model="form.email" placeholder="请输入邮箱地址" size="large" clearable>
              <template #prefix>
                <el-icon class="text-gray-400">
                  <MailIcon />
                </el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" size="large">
              <template #prefix>
                <el-icon class="text-gray-400">
                  <LockIcon />
                </el-icon>
              </template>
            </el-input>
          </el-form-item>

          <!-- 记住我与忘记密码 -->
          <div class="flex items-center justify-between text-base">
            <el-checkbox v-model="rememberMe" class="text-gray-600">
              记住我
            </el-checkbox>
          </div>

          <!-- 登录按钮 -->
          <el-button type="primary" size="large" :loading="loading" @click="handleLogin"
            class="w-full py-4 font-medium rounded-md text-base">
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form>
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

// 登录方式 - 固定为邮箱登录
const loginType = 'email'

// 表单数据 - 类型化
interface LoginForm {
  email: string;
  password: string;
}

const form = reactive<LoginForm>({
  email: '',
  password: ''
})

// 记住我 - 类型化
const rememberMe = ref(false)

// 加载状态 - 类型化
const loading = ref(false)

// 表单验证规则 - 类型化
const rules = reactive({
  email: {
    required: true,
    trigger: ['input', 'blur'],
    validator: (rule: any, value: string, callback: any) => {
      if (!value) {
        callback(new Error('请输入邮箱'))
        return
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(value)) {
        callback(new Error('请输入正确的邮箱'))
        return
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
        // 构建邮箱登录参数
        const loginData = {
          type: 'email' as const,
          username: form.email,
          password: form.password,
          rememberMe: rememberMe.value  // 传递记住我状态
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
</script>

<style scoped>
/* 自定义样式 */
:deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px #e5e7eb inset;
  border-radius: 8px;
  transition: all 0.2s ease;
}

:deep(.el-input.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}

:deep(.el-button--primary) {
  --el-button-bg-color: var(--color-primary);
  --el-button-border-color: var(--color-primary);
  --el-button-hover-bg-color: var(--color-primary-hover);
  --el-button-hover-border-color: var(--color-primary-hover);
  --el-button-active-bg-color: var(--color-primary-active);
  --el-button-active-border-color: var(--color-primary-active);
  font-size: 16px;
}

:deep(.el-button--large) {
  padding: 16px 20px;
}

:deep(.el-form-item__label) {
  font-weight: 500;
  color: #374151;
}

/* 复选框样式优化 */
:deep(.el-checkbox__label) {
  font-size: 14px;
  color: #6b7280;
}
</style>