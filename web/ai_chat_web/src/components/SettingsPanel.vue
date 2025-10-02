<template>
  <div class="settings-panel">
    <div class="settings-header">
      <h2>智能体设置</h2>
    </div>

    <!-- 头像设置 -->
    <div class="setting-group">
      <label class="setting-label">头像设置</label>
      <div class="avatar-upload-container">
        <div class="avatar-preview">
        <img v-if="character && character.avatar_url" class="avatar-image" :src="character.avatar_url" >
        <div v-else class="avatar-placeholder">
          <i class="fas fa-user"></i>
        </div>
        </div>
        <div class="avatar-upload-actions">
          <input
            type="file"
            ref="avatarInput"
            accept="image/*"
            style="display: none"
            @change="handleAvatarUpload"
          />
          <button class="avatar-upload-btn" @click="triggerAvatarUpload">
            选择图片
          </button>
          <button
            v-if="character && character.avatar_url"
            class="avatar-upload-btn remove-btn"
            @click="removeAvatar"
          >
            移除头像
          </button>
        </div>
      </div>
    </div>

    <!-- 模型选择 -->
    <div class="setting-group">
      <label class="setting-label">模型选择</label>
      <select class="setting-input" v-model="session.model" @change="updateSession">
        <option v-for="model in models" :key="model.model" :value="model.model">
          {{ model.model }} ({{ model.provider }})
        </option>
      </select>
    </div>

    <!-- 记忆管理 -->
    <div class="setting-group">
      <label class="setting-label">记忆管理</label>
      <select class="setting-input" v-model="session.memory_type" @change="updateSession">
        <option value="sliding_window">滑动窗口</option>
        <option value="summary_augmented_sliding_window">滑动窗口+摘要</option>
        <option value="sliding_window_with_rag">滑动窗口+记忆检索</option>
        <option value="memoryless">无记忆</option>
      </select>
    </div>

    <!-- 角色名称 -->
    <div class="setting-group">
      <label class="setting-label">角色名称</label>
      <input
        class="setting-input"
        v-model="character.name"
        placeholder="请设置角色名称"
        @input="updateCharacter"
      />
    </div>

    <!-- 系统提示/职业设定 -->
    <div class="setting-group">
      <label class="setting-label">系统提示/职业设定</label>
      <input
        class="setting-input-single"
        v-model="character.identity"
        placeholder="请输入系统提示/职业设定"
        @input="updateCharacter"
      />
    </div>

    <!-- 辅助设定 -->
    <div class="setting-group">
      <label class="setting-label">辅助设定</label>
      <textarea
        class="setting-textarea"
        v-model="character.detailed_setting"
        placeholder="请输入辅助设定"
        @input="updateCharacter"
      ></textarea>
    </div>

    <!-- 高级设置 -->
    <div class="setting-group">
      <div class="setting-label" style="cursor: pointer" @click="toggleAdvancedSettings">
        <span>高级设置</span>
        <i class="fas" :class="advancedSettingsIcon"></i>
      </div>
      
      <div v-if="showAdvancedSettings" class="advanced-settings">
        <!-- 温度设置 -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">温度 (Temperature)</label>
          <div class="slider-container">
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.1" 
              v-model="session.temperature"
              class="slider"
              @change="updateSession"
            />
            <span class="slider-value">{{ session.temperature }}</span>
          </div>
        </div>

        <!-- 最大长度 -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">最大长度 (Max Tokens)</label>
          <div class="slider-container">
            <input 
              type="range" 
              min="100" 
              max="4096" 
              step="100" 
              v-model="session.max_tokens"
              class="slider"
              @change="updateSession"
            />
            <span class="slider-value">{{ session.max_tokens }}</span>
          </div>
        </div>

        <!-- Top P -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">Top P</label>
          <div class="slider-container">
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.1" 
              v-model="session.top_p"
              class="slider"
              @change="updateSession"
            />
            <span class="slider-value">{{ session.top_p }}</span>
          </div>
        </div>

        <!-- 频率惩罚 -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">频率惩罚</label>
          <div class="slider-container">
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.1" 
              v-model="session.frequency_penalty"
              class="slider"
              @change="updateSession"
            />
            <span class="slider-value">{{ session.frequency_penalty }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 保存按钮 -->
    <div class="setting-group">
      <button class="save-settings-btn" @click="saveAllSettings">
        <i class="fas fa-save"></i> 保存所有设置
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { apiService } from '../services/llmApi'
import PopupService from '../services/PopupService'

const props = defineProps({
  character: {
    type: Object,
    default: () => ({
      id: '',
      title: '',
      name: '',
      identity: '',
      detailed_setting: '',
      avatar_url: ''
    })
  },
  session: {
    type: Object,
    default: () => ({
      id: '',
      model: '',
      memory_type: '',
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.9,
      frequency_penalty: 0.5
    })
  }
})

const emit = defineEmits(['update-character', 'update-session'])

const models = ref([])
const showAdvancedSettings = ref(false)
const avatarInput = ref(null)

// 计算高级设置图标
const advancedSettingsIcon = computed(() => 
  showAdvancedSettings.value ? 'fa-chevron-up' : 'fa-chevron-down'
)

// 监听角色变化
watch(() => props.character, (newVal) => {
  // 可以在这里处理角色变化
}, { deep: true })

// 加载模型列表
const loadModels = async () => {
  try {
    models.value = await apiService.fetchModels()
  } catch (error) {
    console.error('获取模型列表失败:', error)
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
    // 检查文件类型和大小
    if (!file.type.startsWith('image/')) {
      PopupService.toast('请选择图片文件', 'error')
      return
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB限制
      PopupService.toast('图片大小不能超过5MB', 'error')
      return
    }
    
    // 创建预览URL
    const reader = new FileReader()
    reader.onload = (e) => {
      // 显示裁剪模态框
      showAvatarCropModal(e.target.result, file)
    }
    reader.readAsDataURL(file)
  }
}

// 显示头像裁剪模态框
const showAvatarCropModal = (imageSrc, file) => {
  // 这里应该实现裁剪功能，但为了简化，我们直接上传
  uploadAvatar(file)
}

// 上传头像
const uploadAvatar = async (file) => {
  try {
    const formData = new FormData()
    formData.append('avatar', file)

    const response = await fetch(`/v1/characters/${props.character.id}/avatars`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      throw new Error('上传失败')
    }

    const result = await response.json()

    if (result.success) {
      // 更新角色头像
      const updatedCharacter = {
        ...props.character,
        avatar_url: result.data.url
      }
      
      emit('update-character', updatedCharacter)
      
      PopupService.toast('头像上传成功', 'success')
    } else {
      throw new Error(result.error || '上传失败')
    }
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
    await apiService.updateCharacter(props.character.id, props.character)
    await apiService.updateSession(props.session.id, props.session)
    PopupService.toast('所有设置已保存', 'success')
  } catch (error) {
    console.error('保存设置失败:', error)
    PopupService.toast('保存失败', 'error')
  }
}

// 切换高级设置显示
const toggleAdvancedSettings = () => {
  showAdvancedSettings.value = !showAdvancedSettings.value
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

.setting-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 14px;
  color: #555;
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

.avatar-placeholder i {
  font-size: 40px;
}

.avatar-upload-actions {
  display: flex;
  gap: 10px;
}

.avatar-upload-btn {
  padding: 8px 15px;
  background-color: #4a90e2;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.avatar-upload-btn:hover {
  background-color: #3a7bc8;
}

.avatar-upload-btn.remove-btn {
  background-color: #ff3b30;
}

.avatar-upload-btn.remove-btn:hover {
  background-color: #e62e24;
}

.setting-input,
.setting-textarea {
  width: 100%;
  padding: 12px 15px;
  border: 1px solid #d0d0d0;
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s ease;
  background-color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.setting-input:focus,
.setting-textarea:focus {
  border-color: #4a90e2;
  outline: none;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
}

.setting-input:hover,
.setting-textarea:hover {
  border-color: #a0a0a0;
}

.setting-textarea {
  min-height: 120px;
  resize: vertical;
}

.setting-input-single {
  width: 100%;
  padding: 12px 15px;
  border: 1px solid #d0d0d0;
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s ease;
  background-color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.setting-input-single:focus {
  border-color: #4a90e2;
  outline: none;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
}

.setting-input-single:hover {
  border-color: #a0a0a0;
}

.advanced-settings {
  margin-top: 15px;
  padding: 15px;
  background-color: #f9f9f9;
  border-radius: 8px;
  border: 1px solid #eee;
}

.advanced-setting {
  margin-bottom: 15px;
}

.advanced-setting:last-child {
  margin-bottom: 0;
}

.advanced-setting-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 14px;
  color: #555;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 15px;
}

.slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  background: #d0d0d0;
  border-radius: 2px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #4a90e2;
  cursor: pointer;
}

.slider-value {
  width: 40px;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  color: #555;
}

.save-settings-btn {
  width: 100%;
  padding: 12px 15px;
  background-color: #4a90e2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.save-settings-btn:hover {
  background-color: #3a7bc8;
}
</style>