<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="logo-area">
          <el-icon class="logo-icon">
            <LoginIcon />
          </el-icon>
          <h1 class="app-title">AI Chat</h1>
        </div>
        <p class="app-subtitle">欢迎回来，请登录您的账户</p>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="login-form">
        <el-form-item prop="email">
          <el-input v-model="form.email" placeholder="邮箱地址" size="large" clearable>
            <template #prefix>
              <el-icon class="text-gray-400">
                <MailIcon />
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="密码" size="large">
            <template #prefix>
              <el-icon class="text-gray-400">
                <LockIcon />
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <div class="form-options">
          <el-checkbox v-model="rememberMe">记住我</el-checkbox>
        </div>

        <el-button type="primary" size="large" :loading="loading" @click="handleLogin" class="login-btn">
          {{ loading ? '登录中...' : '登 录' }}
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<!-- @ts-ignore - Element Plus 组件类型缺失 -->
<script setup lang="ts">
import { ref, reactive } from 'vue'
import {
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
  ElIcon,
  ElCheckbox,
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
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-surface);
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 20px;
  padding: 40px;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.05),
    0 2px 4px -1px rgba(0, 0, 0, 0.03),
    0 0 0 1px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
}

.dark .login-card {
  background: rgba(30, 30, 30, 0.85);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.2),
    0 2px 4px -1px rgba(0, 0, 0, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.05);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-area {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 12px;
}

.logo-icon {
  font-size: 28px;
  color: var(--color-primary);
}

.app-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.app-subtitle {
  font-size: 14px;
  color: var(--color-text-gray);
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.login-btn {
  margin-top: 8px;
  height: 44px;
  font-size: 16px;
  font-weight: 500;
  border-radius: 10px;
}

/* Element Plus 深度样式定制 */
:deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--color-border) inset;
  border-radius: 10px;
  background-color: transparent;
  transition: all 0.2s ease;
  padding: 4px 12px;
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
}

:deep(.el-form-item__label) {
  font-weight: 500;
  color: var(--color-text);
  font-size: 14px;
  padding-bottom: 6px;
}

:deep(.el-checkbox__label) {
  font-size: 14px;
  color: var(--color-text-gray);
}
</style>