<template>
  <div class="max-w-128">
    <el-form ref="basicFormRef" :model="userForm" :rules="basicRules" label-position="left" label-width="80px"
      size="large">
      <!-- 头像设置 -->
      <el-form-item label="头像设置" :show-label="false">
        <AvatarPreview :src="userForm.avatar_url" :type="'user'" @avatar-changed="handleAvaterChanged" />
      </el-form-item>
      <el-form-item label="昵称" prop="nickname">
        <el-input v-model="userForm.nickname" placeholder="昵称" />
      </el-form-item>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="userForm.email" placeholder="邮箱" />
      </el-form-item>
      <el-form-item label="手机号码" prop="phone">
        <el-input v-model="userForm.phone" placeholder="手机号码" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSaveUserInfo" :disabled="!isFormChanged">保存信息</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, shallowRef } from 'vue'
import { AvatarPreview } from '../ui'
import { useAuthStore } from '../../stores/auth'
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
const authStore = useAuthStore()

const basicFormRef = ref(null)
let avater_file = shallowRef(null)
const originalUserForm = ref({})

const userForm = ref({
  nickname: '',
  phone: '',
  email: '',
  avatar_url: '',
})

const basicRules = ref({
  nickname: [
    {
      required: true,
      message: '请输入昵称',
      trigger: 'blur',
    },
  ],
  email: [
    {
      required: true,
      message: '请输入邮箱',
      trigger: 'blur',
    },
    {
      validator: (rule, value, callback) => {
        if (!value) {
          callback(); // 如果没有值，则由required规则处理
          return;
        }

        const isValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)
        if (isValid) {
          callback();
        } else {
          callback(new Error('请输入正确的邮箱'));
        }
      },
      trigger: 'blur'
    }
  ],
  phone: [
    {
      validator: (rule, value, callback) => {
        if (!value) {
          callback(); // 如果没有值，则不需要验证

          return;
        }

        const isValid = /^1[3-9]\d{9}$/.test(value)
        if (isValid) {
          callback();
        } else {
          callback(new Error('请输入正确的手机号码'));
        }
      },
      trigger: 'blur'
    },
  ],
})

const isFormChanged = computed(() => {
  return (
    userForm.value.nickname !== originalUserForm.value.nickname ||
    userForm.value.phone !== originalUserForm.value.phone ||
    userForm.value.email !== originalUserForm.value.email ||
    avater_file.value !== null
  )
})

const handleAvaterChanged = (file) => {
  console.log('file', file)
  avater_file.value = file
}

const handleSaveUserInfo = async () => {
  try {
    await apiService.updateProfile({
      nickname: userForm.value.nickname,
      phone: userForm.value.phone,
      email: userForm.value.email,
    })

    if (avater_file.value) {
      const formData = new FormData()
      formData.append('avatar', avater_file.value)
      const response = await apiService.uploadUserAvatar(avater_file.value)
      avater_file.value = null
      userForm.value.avatar_url = response.url
    }
    authStore.user = { ...authStore.user, ...userForm.value }
    toast.success('用户信息保存成功')
    // 更新原始表单数据
    originalUserForm.value = { ...userForm.value }
  } catch (error) {
    toast.error('用户信息保存失败')
  }
}

defineExpose({
  basicFormRef
})

onMounted(() => {
  userForm.value = { ...authStore.user }
  originalUserForm.value = { ...authStore.user }
})
</script>