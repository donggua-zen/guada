<template>
  <div class="max-w-lg">
    <div class="flex flex-col gap-3">
      <!-- 头像设置 -->
      <GdFormField :label="t('settings.userProfile.avatarSettings')" label-width="80px">
        <AvatarPreview :src="userForm.avatarUrl" :type="'user'" @avatar-changed="handleAvaterChanged" />
      </GdFormField>
      <GdFormField :label="t('settings.userProfile.nickname')" label-width="80px" :error="errors.nickname || undefined">
        <GdInput v-model="userForm.nickname" :placeholder="t('settings.userProfile.nickname')"
          :error="!!errors.nickname" @blur="validateField('nickname')" />
      </GdFormField>
      <GdFormField :label="t('settings.userProfile.username')" label-width="80px" :error="errors.username || undefined">
        <GdInput v-model="userForm.username" :placeholder="t('settings.userProfile.username')"
          :error="!!errors.username" @blur="validateField('username')" />
      </GdFormField>
      <GdFormField label-width="80px">
        <GdButton type="primary" @click="handleSaveUserInfo" :disabled="!isFormChanged">{{ t('settings.userProfile.saveInfo') }}</GdButton>
      </GdFormField>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AvatarPreview } from '../ui'
import { useAuthStore } from '../../stores/auth'
import { toast } from '@/components/ui/toastService';
import { apiService } from '../../services/ApiService'
import GdButton from '@/components/ui/GdButton.vue';
import GdInput from '@/components/ui/GdInput.vue';
import GdFormField from '@/components/ui/GdFormField.vue';
import { useFormValidation } from '@/composables/useFormValidation';

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()

let avater_file = shallowRef(null)
const originalUserForm = ref({})

const userForm = ref({
  nickname: '',
  username: '',
  avatarUrl: '',
})

// 校验（原 el-form :rules → useFormValidation；含 async 查重名）
const { errors, validate, validateField, clearValidate } = useFormValidation({
  nickname: [{ validator: (v) => (String(v ?? '') ? null : t('settings.userProfile.nicknameRequired')) }],
  username: [
    { validator: (v) => (String(v ?? '') ? null : t('settings.userProfile.usernameRequired')) },
    { validator: (v) => (/^[a-zA-Z0-9_]{3,20}$/.test(String(v ?? '')) ? null : t('settings.userProfile.usernameFormat')) },
    { validator: async (v) => {
      const value = String(v ?? '')
      if (!value || value === originalUserForm.value.username) return null
      const { available } = await apiService.checkUsername(value)
      return available ? null : t('settings.userProfile.usernameTaken')
    } },
  ],
}, () => userForm.value)

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
    const valid = await validate()
    if (!valid) return

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
