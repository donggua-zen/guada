<template>
  <div class="max-w-128">
    <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-position="left" label-width="80px"
      size="large">
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
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePopup } from '../../composables/usePopup'
import { apiService } from '../../services/ApiService'
// Element Plus 组件导入
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElButton
} from 'element-plus'

const { t } = useI18n()
const { toast } = usePopup()

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

// 添加修改密码处理函数
const handleChangePassword = (e) => {
  e.preventDefault()
  passwordFormRef.value?.validate(async (valid) => {
    if (valid) {
      try {
        await apiService.changePassword(passwordForm.value.oldPassword, passwordForm.value.newPassword)
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

defineExpose({
  passwordFormRef
})
</script>