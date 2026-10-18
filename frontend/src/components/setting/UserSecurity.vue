<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 登录分组：密码存在与否即免登录开关 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.userSecurity.login') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.userSecurity.accessPassword') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.userSecurity.accessPasswordDesc') }}</span>
            </div>
            <el-switch :model-value="authStore.passwordSet" size="large" @change="handlePasswordToggle" />
          </div>
        </div>
      </div>

      <!-- 修改密码分组：免密状态下没有原密码，隐藏表单 -->
      <div v-if="authStore.passwordSet">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.userSecurity.changePassword') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-4">
            <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-position="left"
              label-width="80px" size="large" class="max-w-128">
              <el-form-item :label="t('settings.userSecurity.oldPassword')" prop="oldPassword">
                <el-input v-model="passwordForm.oldPassword" type="password" show-password
                  :placeholder="t('settings.userSecurity.oldPasswordPlaceholder')" />
              </el-form-item>
              <el-form-item :label="t('settings.userSecurity.newPassword')" prop="newPassword">
                <el-input v-model="passwordForm.newPassword" type="password" show-password
                  :placeholder="t('settings.userSecurity.newPasswordPlaceholder')" />
              </el-form-item>
              <el-form-item :label="t('settings.userSecurity.confirmPassword')" prop="confirmPassword">
                <el-input v-model="passwordForm.confirmPassword" type="password" show-password
                  :placeholder="t('settings.userSecurity.confirmPasswordPlaceholder')" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="handleChangePassword">{{ t('settings.userSecurity.confirmChange') }}</el-button>
              </el-form-item>
            </el-form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePopup } from '@/composables/usePopup'
import { apiService } from '@/services/ApiService'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/utils/errorMessage'
// Element Plus 组件导入
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElButton,
  ElSwitch
} from 'element-plus'

const { t } = useI18n()
const { toast, notify, prompt, confirm } = usePopup()
const authStore = useAuthStore()

const passwordFormRef = ref(null)

const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// 添加密码表单验证规则
const passwordRules = computed(() => ({
  oldPassword: [
    {
      required: true,
      message: t('settings.userSecurity.oldPasswordRequired'),
      trigger: 'blur'
    }
  ],
  newPassword: [
    {
      required: true,
      message: t('settings.userSecurity.newPasswordRequired'),
      trigger: 'blur'
    },
    {
      min: 6,
      message: t('settings.userSecurity.passwordMinLength'),
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    {
      required: true,
      message: t('settings.userSecurity.confirmPasswordRequired'),
      trigger: 'blur'
    },
    {
      validator: (rule, value, callback) => {
        if (value !== passwordForm.value.newPassword) {
          callback(new Error(t('settings.userSecurity.passwordMismatch')))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}))

/**
 * 访问密码开关：
 * - 打开 → 提示输入新密码（调 /user/password/change，未设密码时无需旧密码）
 * - 关闭 → 清除密码（DELETE /user/password），回到免登录模式
 */
const handlePasswordToggle = async (enabled) => {
  const wantSet = enabled === true

  if (wantSet) {
    const value = await prompt(t('settings.userSecurity.setPasswordTitle'), {
      placeholder: t('settings.userSecurity.setPasswordPrompt'),
      inputType: 'password',
      required: true,
      validation: (input) => input.length >= 6 ? true : t('settings.userSecurity.passwordTooShort'),
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
    })
    if (value === null) return

    try {
      await apiService.changePassword(undefined, value)
      authStore.passwordSet = true
      notify.success(t('common.updateSuccess'), t('settings.userSecurity.passwordSetSuccess'))
    } catch (e) {
      notify.error(t('common.saveFailed'), getErrorMessage(e) || t('settings.userSecurity.passwordOpFailed'))
    }
    return
  }

  const ok = await confirm(
    t('settings.userSecurity.clearPasswordTitle'),
    t('settings.userSecurity.clearPasswordConfirm'),
    { type: 'warning' },
  )
  if (!ok) return

  try {
    await apiService.clearPassword()
    authStore.passwordSet = false
    notify.success(t('common.updateSuccess'), t('settings.userSecurity.passwordClearedSuccess'))
  } catch (e) {
    notify.error(t('common.saveFailed'), getErrorMessage(e) || t('settings.userSecurity.passwordOpFailed'))
  }
}

// 添加修改密码处理函数
const handleChangePassword = (e) => {
  e.preventDefault()
  passwordFormRef.value?.validate(async (valid) => {
    if (valid) {
      try {
        await apiService.changePassword(passwordForm.value.oldPassword, passwordForm.value.newPassword)
        // 与访问密码开关保持一致：改密成功后确实已设密码
        authStore.passwordSet = true
        // 重置表单
        passwordForm.value = {
          oldPassword: '',
          newPassword: '',
          confirmPassword: ''
        }
        toast.success(t('settings.userSecurity.passwordChanged'))
      } catch (error) {
        toast.error(error.message || t('settings.userSecurity.passwordChangeFailed'))
      }
    } else {
      console.log('验证失败')
    }
  })
}

onMounted(() => {
  // 登录流程通常会写入该状态，这里再查一次兜底，避免直接进入设置页时开关显示过期值
  authStore.fetchPasswordSet()
})

defineExpose({
  passwordFormRef
})
</script>
