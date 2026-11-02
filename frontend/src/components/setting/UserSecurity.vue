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
            <GdSwitch :model-value="authStore.passwordSet" size="large" @change="handlePasswordToggle" />
          </div>
        </div>
      </div>

      <!-- 修改密码分组：免密状态下没有原密码，隐藏表单 -->
      <div v-if="authStore.passwordSet">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.userSecurity.changePassword') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <div class="px-4 py-4">
            <div class="max-w-128">
              <GdFormField :label="t('settings.userSecurity.oldPassword')" label-width="80px" :error="errors.oldPassword || undefined">
                <GdInput v-model="passwordForm.oldPassword" type="password" show-password
                  :placeholder="t('settings.userSecurity.oldPasswordPlaceholder')" :error="!!errors.oldPassword" @blur="validateField('oldPassword')" />
              </GdFormField>
              <GdFormField :label="t('settings.userSecurity.newPassword')" label-width="80px" :error="errors.newPassword || undefined">
                <GdInput v-model="passwordForm.newPassword" type="password" show-password
                  :placeholder="t('settings.userSecurity.newPasswordPlaceholder')" :error="!!errors.newPassword" @blur="validateField('newPassword')" />
                <!-- 实时强度指示条：3 段对应 弱/中/强 -->
                <div v-if="passwordForm.newPassword" class="flex items-center gap-2 mt-2 w-full">
                  <div class="flex gap-1 flex-1 max-w-40">
                    <span v-for="i in 3" :key="i" class="h-1 flex-1 rounded-full transition-colors duration-200"
                      :class="i <= strengthSegments ? strengthActiveClass : 'bg-gray-200 dark:bg-[#3a3b3f]'" />
                  </div>
                  <span class="text-xs" :class="strengthTextClass">{{ strengthLabel }}</span>
                </div>
                <div class="text-xs text-gray-500 dark:text-[#8b8d95] leading-5 mt-1">
                  {{ requireStrongPassword ? t('settings.userSecurity.passwordPolicyHintPublic') : t('settings.userSecurity.passwordPolicyHint') }}
                </div>
              </GdFormField>
              <GdFormField :label="t('settings.userSecurity.confirmPassword')" label-width="80px" :error="errors.confirmPassword || undefined">
                <GdInput v-model="passwordForm.confirmPassword" type="password" show-password
                  :placeholder="t('settings.userSecurity.confirmPasswordPlaceholder')" :error="!!errors.confirmPassword" @blur="validateField('confirmPassword')" />
              </GdFormField>
              <GdFormField label-width="80px">
                <GdButton type="primary" @click="handleChangePassword">{{ t('settings.userSecurity.confirmChange') }}</GdButton>
              </GdFormField>
            </div>
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
import { toast, notify } from '@/components/ui/toastService';
import { apiService } from '@/services/ApiService'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/utils/errorMessage'
import { getPasswordErrorCode, evaluatePasswordStrength } from '@/utils/passwordStrength'
import GdButton from '@/components/ui/GdButton.vue';
import GdFormField from '@/components/ui/GdFormField.vue';
import { useFormValidation } from '@/composables/useFormValidation';
import GdInput from '@/components/ui/GdInput.vue';
import GdSwitch from '@/components/ui/GdSwitch.vue';


const { t } = useI18n()
const { prompt, confirm } = usePopup()
const authStore = useAuthStore()

// 原密码表单（el-form → useFormValidation）；错误行内展示 + 控件红描边
const { errors, validate, validateField, clearValidate } = useFormValidation({
  oldPassword: [{ validator: (v) => (String(v ?? '') ? null : t('settings.userSecurity.oldPasswordRequired')) }],
  newPassword: [{ validator: (v) => {
    const value = String(v ?? '');
    if (!value) return t('settings.userSecurity.newPasswordRequired');
    const result = validatePasswordInput(value);
    return result === true ? null : result;
  } }],
  confirmPassword: [{ validator: (v) => {
    const value = String(v ?? '');
    if (!value) return t('settings.userSecurity.confirmPasswordRequired');
    return value === passwordForm.value.newPassword ? null : t('settings.userSecurity.passwordMismatch');
  } }],
}, () => passwordForm.value)

// 公网访问开启时要求高强度密码（后端同样会校验，这里用于即时反馈与提示文案）
const requireStrongPassword = ref(false)

const PASSWORD_ERROR_KEYS = {
  tooShort: 'settings.userSecurity.pwdErrorTooShort',
  tooFewClasses: 'settings.userSecurity.pwdErrorTooFewClasses',
  tooShortForPublic: 'settings.userSecurity.pwdErrorTooShortForPublic',
  tooFewClassesForPublic: 'settings.userSecurity.pwdErrorTooFewClassesForPublic',
  common: 'settings.userSecurity.pwdErrorCommon',
  containsUsername: 'settings.userSecurity.pwdErrorContainsUsername',
}

function validatePasswordInput(password) {
  const code = getPasswordErrorCode(password, {
    requireStrong: requireStrongPassword.value,
    username: authStore.user?.username,
  })
  // validation 新签名：通过返回 null，失败返回错误文案
  return code ? t(PASSWORD_ERROR_KEYS[code]) : null
}

async function loadMobileAccessRequirement() {
  try {
    const config = await apiService.getMobileAccessConfig()
    requireStrongPassword.value = config.publicEnabled
  } catch {
    // 取不到配置时按基础策略提示；后端仍会按真实配置强校验
    requireStrongPassword.value = false
  }
}

const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// 实时强度指示条：3 段对应 弱 / 中 / 强（与校验策略同源）
const passwordStrength = computed(() =>
  evaluatePasswordStrength(passwordForm.value.newPassword || '', authStore.user?.username)
)
const strengthSegments = computed(() =>
  ({ weak: 1, medium: 2, strong: 3 })[passwordStrength.value.level]
)

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
      validation: (input) => validatePasswordInput(input),
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
const handleChangePassword = async () => {
  const valid = await validate()
  if (valid) {
    try {
      await apiService.changePassword(passwordForm.value.oldPassword, passwordForm.value.newPassword)
      // 与访问密码开关保持一致：改密成功后确实已设密码
      authStore.passwordSet = true
      // 重置表单并清校验态
      passwordForm.value = {
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      }
      clearValidate()
      toast.success(t('settings.userSecurity.passwordChanged'))
    } catch (error) {
      toast.error(error.message || t('settings.userSecurity.passwordChangeFailed'))
    }
  } else {
    console.log('验证失败')
  }
}

onMounted(() => {
  // 登录流程通常会写入该状态，这里再查一次兜底，避免直接进入设置页时开关显示过期值
  authStore.fetchPasswordSet()
  void loadMobileAccessRequirement()
})


</script>
