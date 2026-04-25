<template>
  <div class="max-w-lg">
    <el-form ref="basicFormRef" :model="userForm" :rules="basicRules" label-position="left" label-width="80px"
      size="large">
      <!-- 头像设置 -->
      <el-form-item label="头像设置" :show-label="false">
        <AvatarPreview :src="userForm.avatarUrl" :type="'user'" @avatar-changed="handleAvaterChanged" />
      </el-form-item>
      <el-form-item label="昵称" prop="nickname">
        <el-input v-model="userForm.nickname" placeholder="昵称" />
      </el-form-item>
      <el-form-item label="用户名" prop="username">
        <el-input v-model="userForm.username" placeholder="用户名" disabled />
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
  username: '',
  avatarUrl: '',
})

const basicRules = ref({
  nickname: [
    {
      required: true,
      message: '请输入昵称',
      trigger: 'blur',
    },
  ],
  username: [
    {
      required: true,
      message: '请输入用户名',
      trigger: 'blur',
    },
  ],
})

const isFormChanged = computed(() => {
  return (
    userForm.value.nickname !== originalUserForm.value.nickname ||
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
    })

    if (avater_file.value) {
      const formData = new FormData()
      formData.append('avatar', avater_file.value)
      const response = await apiService.uploadUserAvatar(avater_file.value)
      avater_file.value = null
      userForm.value.avatarUrl = response.url
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
  // 只复制需要的字段到表单
  userForm.value = {
    nickname: authStore.user?.nickname || '',
    username: authStore.user?.username || '',
    avatarUrl: authStore.user?.avatarUrl || '',
  }
  originalUserForm.value = { ...userForm.value }
  console.log('UserProfile mounted, user data:', authStore.user)
})
</script>