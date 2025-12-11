<template>
  <div class="max-w-128">
    <n-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-placement="top" label-width="80px"
      size="large">
      <n-form-item label="原密码" path="oldPassword">
        <n-input v-model:value="passwordForm.oldPassword" type="password" show-password-on="click"
          placeholder="请输入原密码" />
      </n-form-item>
      <n-form-item label="新密码" path="newPassword">
        <n-input v-model:value="passwordForm.newPassword" type="password" show-password-on="click"
          placeholder="请输入新密码" />
      </n-form-item>
      <n-form-item label="确认密码" path="confirmPassword">
        <n-input v-model:value="passwordForm.confirmPassword" type="password" show-password-on="click"
          placeholder="请再次输入新密码" />
      </n-form-item>
      <n-form-item>
        <UiButton type="primary" @click="handleChangePassword">确认修改</UiButton>
      </n-form-item>
    </n-form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { usePopup } from '../../composables/usePopup'
import { apiService } from '../../services/ApiService'

const { toast } = usePopup()

const passwordFormRef = ref(null)

const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// 添加密码表单验证规则
const passwordRules = ref({
  oldPassword: [
    {
      required: true,
      message: '请输入原密码',
      trigger: 'blur'
    }
  ],
  newPassword: [
    {
      required: true,
      message: '请输入新密码',
      trigger: 'blur'
    },
    {
      min: 6,
      message: '密码长度不能少于6位',
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    {
      required: true,
      message: '请确认新密码',
      trigger: 'blur'
    },
    {
      validator: (rule, value) => {
        return value === passwordForm.value.newPassword || '两次输入的密码不一致'
      },
      trigger: 'blur'
    }
  ]
})

// 添加修改密码处理函数
const handleChangePassword = (e) => {
  e.preventDefault()
  passwordFormRef.value?.validate(async (errors) => {
    if (!errors) {
      try {
        await apiService.changePassword(passwordForm.value.oldPassword, passwordForm.value.newPassword)
        // 重置表单
        passwordForm.value = {
          oldPassword: '',
          newPassword: '',
          confirmPassword: ''
        }
        toast.success('密码修改成功')
      } catch (error) {
        toast.error(error.message || '密码修改失败')
      }
    } else {
      console.log('验证失败', errors)
    }
  })
}

defineExpose({
  passwordFormRef
})
</script>