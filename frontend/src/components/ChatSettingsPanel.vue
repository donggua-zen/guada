<template>
  <CharacterSettingPanel :data="activeSession" @update="updateCharacter" />
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { apiService } from '../services/llmApi'
import PopupService from '../services/PopupService'
import 'vue-advanced-cropper/dist/style.css'
import CharacterSettingPanel from '../components/CharacterSettingPanel.vue'

const props = defineProps({
  sessionId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:session']);

const models = ref([]);
const providers = ref([]);
const avatarInput = ref(null);

// 新增响应式数据
const showCropModal = ref(false);
const cropImageSrc = ref('');
const cropFile = ref(null);
const cropper_avatar = ref(null);
const currentSession = ref(null);


// 监听角色变化
watch(() => props.sessionId, async (newVal) => {
  if (newVal) {
    const response = await apiService.fetchSession(newVal);
    currentSession.value = response.session;
  }
}, { deep: true, })

// 加载模型列表
const loadModels = async () => {
  try {
    const response = await apiService.getModels()

    models.value = response.models || []
    providers.value = response.providers || []

  } catch (error) {
    console.error('获取模型列表失败:', error)
    PopupService.toast('获取模型列表失败', 'error')
  }
}

// 触发头像上传
const triggerAvatarUpload = () => {
  avatarInput.value.click()
}

// 处理头像上传
const handleAvatarUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    if (!file.type.startsWith('image/')) {
      PopupService.toast('请选择图片文件', 'error')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      PopupService.toast('图片大小不能超过5MB', 'error')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      cropImageSrc.value = e.target.result
      cropFile.value = file
      showCropModal.value = true
    }
    reader.readAsDataURL(file)
  }

  // 清空input，允许重复选择同一文件
  event.target.value = ''
}

const handleCropChange = ({ coordinates, canvas }) => {
  console.log(coordinates, canvas)
}

const cropAvatar = () => {
  if (!cropper_avatar.value) return

  const { canvas } = cropper_avatar.value.getResult()

  canvas.toBlob((blob) => {
    // 创建新文件对象
    const croppedFile = new File([blob], cropFile.value.name, {
      type: cropFile.value.type,
      lastModified: Date.now(),
    })

    // 上传裁剪后的图片
    uploadAvatar(croppedFile)

    // 关闭模态框
    closeCropModal()
  }, cropFile.value.type, 0.9)
}

// 新增关闭模态框函数
const closeCropModal = () => {
  showCropModal.value = false
  cropImageSrc.value = ''
  cropFile.value = null
}

// 修改uploadAvatar函数，添加加载状态
const uploadAvatar = async (file) => {
  try {
    PopupService.toast('上传中...', 'info', 2000)
    // 调用API上传头像
    const result = await apiService.uploadAvatar(props.character.id, file)

    // 更新本地头像显示
    const updatedCharacter = {
      ...props.character,
      avatar_url: result.avatar_url
    }
    emit('update-character', updatedCharacter)

    PopupService.toast('头像上传成功', 'success')

  } catch (error) {
    console.error('上传头像失败:', error)
    PopupService.toast('头像上传失败', 'error')
  }
}

// 移除头像
const removeAvatar = () => {
  const updatedCharacter = {
    ...props.character,
    avatar_url: ''
  }

  emit('update-character', updatedCharacter)
  PopupService.toast('头像已移除', 'success')
}

// 更新角色设置
const updateCharacter = async () => {
  try {
    await apiService.updateCharacter(props.character.id, props.character)
    PopupService.toast('角色设置已保存', 'success')
  } catch (error) {
    console.error('保存角色设置失败:', error)
    PopupService.toast('保存失败', 'error')
  }
}

// 更新会话设置
const updateSession = async () => {
  // try {
  //   await apiService.updateSession(props.session.id, props.session)
  //   PopupService.toast('会话设置已保存', 'success')
  // } catch (error) {
  //   console.error('保存会话设置失败:', error)
  //   PopupService.toast('保存失败', 'error')
  // }
}

// 保存所有设置
const saveAllSettings = async () => {
  try {
    // await apiService.updateCharacter(props.character.id, props.character)
    await apiService.updateSession(props.session.id, currentSession.value)
    PopupService.toast('所有设置已保存', 'success')
  } catch (error) {
    console.error('保存设置失败:', error)
    PopupService.toast('保存失败', 'error')
  }
}

// 组件挂载时加载模型列表
onMounted(() => {
  loadModels()
})
</script>

<style scoped>
.settings-panel {
  width: 320px;
  min-width: 320px;
  padding: 20px;
  overflow-y: auto;
  background-color: #ffffff;
  border-left: 1px solid #eee;
  height: 100vh;
}

.settings-header {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
}

.setting-group {
  margin-bottom: 25px;
}

.avatar-upload-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.avatar-preview {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px dashed #d0d0d0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f5f5f5;
  color: #999;
}

.avatar-upload-actions {
  display: flex;
  gap: 10px;
}

.slider-value {
  display: inline-block;
  width: 40px;
  text-align: center;
  margin-left: 10px;
  font-weight: 500;
}

.modal-body {
  height: 400px;
}
</style>