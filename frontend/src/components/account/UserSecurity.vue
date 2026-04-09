<template>
  <div class="max-w-128">
    <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-position="left" label-width="80px"
      size="large">
      <el-form-item label="原密码" prop="oldPassword">
        <el-input v-model="passwordForm.oldPassword" type="password" show-password
          placeholder="请输入原密码" />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="passwordForm.newPassword" type="password" show-password
          placeholder="请输入新密码" />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input v-model="passwordForm.confirmPassword" type="password" show-password
          placeholder="请再次输入新密码" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleChangePassword">确认修改</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { usePopup } from '../../composables/usePopup'
import { apiService } from '../../services/ApiService'
// Element Plus 组件导入
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElButton
} from 'element-plus'

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
      validator: (rule, value, callback) => {
        if (value !== passwordForm.value.newPassword) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
})

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
        toast.success('密码修改成功')
      } catch (error) {
        toast.error(error.message || '密码修改失败')
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