<template>
  <div class="flex flex-col h-full">
    <CustomTitlebar />
    <div class="flex-1 flex items-center justify-center bg-(--gd-color-bg) p-5">
    <div class="w-full max-w-md p-10 transition-all duration-300 ease-in-out">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 mb-3">
          <h1 class="text-4xl font-semibold text-(--gd-color-text) m-0">GuaDa</h1>
        </div>
        <p class="text-sm text-(--gd-color-text-gray) m-0">{{ t('ui.login.welcome') }}</p>
      </div>

      <div class="flex flex-col gap-5" @keyup.enter="handleLogin">
        <GdFormField :error="errors.username || undefined">
          <GdInput v-model="form.username" :placeholder="t('ui.login.username')" size="large" clearable
            :error="!!errors.username" @blur="validateField('username')">
            <template #prefix>
                <UserIcon class="text-gray-400 size-4" />
            </template>
          </GdInput>
        </GdFormField>

        <GdFormField :error="errors.password || undefined">
          <GdInput v-model="form.password" type="password" show-password :placeholder="t('ui.login.password')" size="large"
            :error="!!errors.password" @blur="validateField('password')">
            <template #prefix>
                <LockIcon class="text-gray-400 size-4" />
            </template>
          </GdInput>
        </GdFormField>

        <div class="flex justify-between items-center">
          <GdCheckbox v-model="rememberMe">{{ t('ui.login.rememberMe') }}</GdCheckbox>
        </div>

        <GdButton type="primary" size="large" :loading="loading" @click="handleLogin" class="mt-2 h-11 text-base font-medium rounded-xl">
          {{ loading ? t('ui.login.logging') : t('ui.login.submit') }}
        </GdButton>
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    Person16Regular as UserIcon,
    LockClosed16Regular as LockIcon
} from '@vicons/fluent'

import { useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'
import { NetworkError } from '@/utils/errors'
import { getApiErrorStatus, getErrorMessage } from '@/utils/errorMessage'
import { toast } from '@/components/ui/toastService';
import GdButton from '@/components/ui/GdButton.vue';
import GdCheckbox from '@/components/ui/GdCheckbox.vue';
import GdInput from '@/components/ui/GdInput.vue';
import GdFormField from '@/components/ui/GdFormField.vue';
import { useFormValidation } from '@/composables/useFormValidation';
import CustomTitlebar from './CustomTitlebar.vue'

const authStore = useAuthStore()
// 消息提示
const { t } = useI18n()

const router = useRouter()

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

// 校验（原 el-form :rules → useFormValidation；错误经 GdFormField 行内红字展示）
const { errors, validate, validateField } = useFormValidation({
  username: [{
    validator: (v) => {
      const value = String(v ?? '')
      if (!value) return t('ui.login.requireUsername')
      return /^[a-zA-Z0-9_]{3,20}$/.test(value) ? null : t('ui.login.usernameFormat')
    },
  }],
  password: [{
    validator: (v) => (String(v ?? '') ? null : t('ui.login.requirePassword')),
  }],
}, () => form)

// 登录处理 - 类型化
const handleLogin = async (): Promise<void> => {
  const valid = await validate()
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
      } catch (error) {
        console.error('登录失败:', error)

        // 根据错误类型显示友好的提示信息
        let errorMessage = t('ui.login.failed')
        const msg = getErrorMessage(error)

        // 网络错误
        if (error instanceof NetworkError) {
          errorMessage = t('ui.login.cannotConnect')
        }
        // 用户名或密码错误（401）
        else if (getApiErrorStatus(error) === 401 || msg.includes('用户名或密码错误')) {
          errorMessage = t('ui.login.invalidCredentials')
        }
        // 必填字段缺失（400）
        else if (getApiErrorStatus(error) === 400 || msg.includes('不能为空')) {
          errorMessage = t('ui.login.requireBoth')
        }
        // 其他已知错误
        else if (error instanceof Error && error.message) {
          errorMessage = msg
        }

        toast.error(errorMessage)
      } finally {
        loading.value = false
      }
    } else {
      toast.error(t('ui.login.checkInput'))
    }
  }
</script>

<style scoped>
</style>