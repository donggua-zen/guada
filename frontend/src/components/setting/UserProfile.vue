<template>
  <div class="max-w-lg">
    <el-form ref="basicFormRef" :model="userForm" :rules="basicRules" label-position="left" label-width="80px"
      size="large">
      <!-- 头像设置 -->
      <el-form-item :label="t('settings.userProfile.avatarSettings')" :show-label="false">
        <AvatarPreview :src="userForm.avatarUrl" :type="'user'" @avatar-changed="handleAvaterChanged" />
      </el-form-item>
      <el-form-item :label="t('settings.userProfile.nickname')" prop="nickname">
        <el-input v-model="userForm.nickname" :placeholder="t('settings.userProfile.nickname')" />
      </el-form-item>
      <el-form-item :label="t('settings.userProfile.username')" prop="username">
        <el-input v-model="userForm.username" :placeholder="t('settings.userProfile.username')" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSaveUserInfo" :disabled="!isFormChanged">{{ t('settings.userProfile.saveInfo') }}</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
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

const basicRules = computed(() => ({
  nickname: [
    {
      required: true,
      message: t('settings.userProfile.nicknameRequired'),
      trigger: 'blur',
    },
  ],
  username: [
    {
      required: true,
      message: t('settings.userProfile.usernameRequired'),
      trigger: 'blur',
    },
    {
      validator: (rule, value) => {
        return /^[a-zA-Z0-9_]{3,20}$/.test(value) || t('settings.userProfile.usernameFormat')
      },
      trigger: 'blur',
    },
    {
      asyncValidator: async (rule, value) => {
        if (!value || value === originalUserForm.value.username) return true
        const { available } = await apiService.checkUsername(value)
        if (!available) throw new Error(t('settings.userProfile.usernameTaken'))
        return true
      },
      trigger: 'blur',
    },
  ],
}))

const isFormChanged = computed(() => {
  return (
    userForm.value.nickname !== originalUserForm.value.nickname ||
    userForm.value.username !== originalUserForm.value.username ||
    avater_file.value !== null
  )
})

const handleAvaterChanged = (file) => {
  console.log('file', file)
  avater_file.value = file
}

const handleSaveUserInfo = async () => {
  try {
    await basicFormRef.value?.validate()

    const updateData = {}
    if (userForm.value.nickname !== originalUserForm.value.nickname) {
      updateData.nickname = userForm.value.nickname
    }
    if (userForm.value.username !== originalUserForm.value.username) {
      updateData.username = userForm.value.username
    }
    if (Object.keys(updateData).length > 0) {
      await apiService.updateProfile(updateData)
    }

    if (avater_file.value) {
      const formData = new FormData()
      formData.append('avatar', avater_file.value)
      const response = await apiService.uploadUserAvatar(avater_file.value)
      avater_file.value = null
      userForm.value.avatarUrl = response.url
    }
    //authStore.user = { ...authStore.user, ...userForm.value }
    if(!authStore.checkAuth()){
      router.replace({ name: 'Login' });
      return
    }
    toast.success(t('settings.userProfile.saveSuccess'))
    // 更新原始表单数据
    originalUserForm.value = { ...userForm.value }
  } catch (error) {
    toast.error(error.message || t('settings.userProfile.saveFailed'))
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