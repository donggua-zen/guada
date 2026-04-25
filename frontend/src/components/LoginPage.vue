<template>
  <div class="flex-1 flex items-center justify-center bg-surface p-5">
    <div class="w-full max-w-md p-10 transition-all duration-300 ease-in-out">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 mb-3"> 
          <h1 class="text-4xl font-semibold text-text m-0">GuaDa</h1>
        </div>
        <p class="text-sm text-text-gray m-0">欢迎回来，请登录您的账户</p>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="flex flex-col gap-5" @keyup.enter="handleLogin">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" size="large" clearable>
            <template #prefix>
              <el-icon class="text-gray-400">
                <UserIcon />
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

        <div class="flex justify-between items-center">
          <el-checkbox v-model="rememberMe">记住我</el-checkbox>
        </div>

        <el-button type="primary" size="large" :loading="loading" @click="handleLogin" class="mt-2 h-11 text-base font-medium rounded-xl">
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
  PersonOutlined as UserIcon,
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
  username: string;
  password: string;
}

const form = reactive<LoginForm>({
  username: '',
  password: ''
})

// 记住我 - 类型化
const rememberMe = ref(false)

// 加载状态 - 类型化
const loading = ref(false)

// 表单验证规则 - 类型化
const rules = reactive({
  username: {
    required: true,
    trigger: ['input', 'blur'],
    validator: (rule: any, value: string, callback: any) => {
      if (!value) {
        callback(new Error('请输入用户名'))
        return
      }
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/
      if (!usernameRegex.test(value)) {
        callback(new Error('用户名只能包含字母、数字和下划线，长度为3-20位'))
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
        // 构建登录参数
        const loginData = {
          type: 'email' as const,
          username: form.username,
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
/* Element Plus 深度样式定制 */
:deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--color-border) inset;
  border-radius: 10px;
  background-color: #ffffff;
  transition: all 0.2s ease;
  padding: 4px 12px;
}

.dark :deep(.el-input__wrapper) {
  background-color: #2a2a2a;
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