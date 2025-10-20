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
          <img v-if="character && character.avatar_url" class="avatar-image" :src="character.avatar_url">
          <div v-else class="avatar-placeholder">
            <i class="fas fa-user"></i>
          </div>
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
    <div class="setting-group" style="display: none;">
      <label class="setting-label">角色名称</label>
      <input class="setting-input" v-model="character.name" placeholder="请设置角色名称" @input="updateCharacter" />
    </div>

    <!-- 系统提示/职业设定 -->
    <div class="setting-group" style="display: none;">
      <label class="setting-label">系统提示/职业设定</label>
      <input class="setting-input-single" v-model="character.identity" placeholder="请输入系统提示/职业设定"
        @input="updateCharacter" />
    </div>

    <!-- 辅助设定 -->
    <div class="setting-group" style="display: none;">
      <label class="setting-label">辅助设定</label>
      <textarea class="setting-textarea" v-model="character.detailed_setting" placeholder="请输入辅助设定"
        @input="updateCharacter"></textarea>
    </div>

    <!-- 高级设置 -->
    <div class="setting-group">
      <div class="setting-label" style="cursor: pointer" @click="toggleAdvancedSettings">
        <span>高级设置</span>
        <i class="fas" :class="advancedSettingsIcon"></i>
      </div>

      <div v-if="showAdvancedSettings" class="advanced-settings" style="display: none;">
        <!-- 温度设置 -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">温度 (Temperature)</label>
          <div class="slider-container">
            <input type="range" min="0" max="1" step="0.1" v-model="session.temperature" class="slider"
              @change="updateSession" />
            <span class="slider-value">{{ session.temperature }}</span>
          </div>
        </div>

        <!-- 最大长度 -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">最大长度 (Max Tokens)</label>
          <div class="slider-container">
            <input type="range" min="100" max="4096" step="100" v-model="session.max_tokens" class="slider"
              @change="updateSession" />
            <span class="slider-value">{{ session.max_tokens }}</span>
          </div>
        </div>

        <!-- Top P -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">Top P</label>
          <div class="slider-container">
            <input type="range" min="0" max="1" step="0.1" v-model="session.top_p" class="slider"
              @change="updateSession" />
            <span class="slider-value">{{ session.top_p }}</span>
          </div>
        </div>

        <!-- 频率惩罚 -->
        <div class="advanced-setting">
          <label class="advanced-setting-label">频率惩罚</label>
          <div class="slider-container">
            <input type="range" min="0" max="2" step="0.1" v-model="session.frequency_penalty" class="slider"
              @change="updateSession" />
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
  <!-- 头像裁剪模态框 -->
  <div v-if="showCropModal" class="modal-overlay">
    <div class="crop-modal">
      <div class="modal-header">
        <h3>裁剪头像</h3>
        <button class="close-btn" @click="closeCropModal">×</button>
      </div>
      <div class="modal-body">
        <cropper ref="cropper_avatar" :src="cropImageSrc" :stencil-props="{
          aspectRatio: 1,
          movable: true,
          resizable: true
        }" :resize-image="{
          adjustStencil: false
        }" @change="handleCropChange" :output-type="'png'" :output-size="{ width: 500, height: 500 }">
        </cropper>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" @click="closeCropModal">取消</button>
        <button class="btn-primary" @click="cropAvatar">确认裁剪</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { apiService } from '../services/llmApi'
import PopupService from '../services/PopupService'
// 新增导入
// import { VueCropper } from 'vue-cropperjs';
// import 'cropperjs/dist/cropper.css';
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
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

// 新增响应式数据
const showCropModal = ref(false);
const cropImageSrc = ref('');
const cropFile = ref(null);
const cropper_avatar = ref(null);
// 处理头像上传
const handleAvatarUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
    if (!file.type.startsWith('image/')) {
      PopupService.toast('请选择图片文件', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      PopupService.toast('图片大小不能超过5MB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      console.log('图片加载完成:', e.target.result);
      cropImageSrc.value = e.target.result;
      cropFile.value = file;
      showCropModal.value = true;
    };
    reader.readAsDataURL(file);
  }

  // 清空input，允许重复选择同一文件
  event.target.value = '';
};

const handleCropChange = ({ coordinates, canvas }) => {
  console.log(coordinates, canvas)
};

const cropAvatar = () => {
  console.log('裁剪头像1');
  if (!cropper_avatar.value) return;
  console.log('裁剪头像2');
  // 获取裁剪后的canvas
  const { coordinates, canvas } = cropper_avatar.value.getResult();

  // cropper_avatar.value.getCroppedCanvas({
  //   imageSmoothingEnabled: true,
  //   imageSmoothingQuality: 'high',
  //   fillColor: '#fff', // 填充白色背景
  // })
  console.log(canvas);
  canvas.toBlob((blob) => {
    // 创建新文件对象
    const croppedFile = new File([blob], cropFile.value.name, {
      type: cropFile.value.type,
      lastModified: Date.now(),
    });

    // 上传裁剪后的图片
    uploadAvatar(croppedFile);

    // 关闭模态框
    closeCropModal();
  }, cropFile.value.type, 0.9); // 90%质量
};

// 新增关闭模态框函数
const closeCropModal = () => {
  showCropModal.value = false;
  cropImageSrc.value = '';
  cropFile.value = null;
};

// 修改uploadAvatar函数，添加加载状态
const uploadAvatar = async (file) => {
  try {
    PopupService.toast('上传中...', 'info', 2000);
    // 调用API上传头像
    const result = await apiService.uploadAvatar(props.character.id, file);

    // 更新本地头像显示
    const updatedCharacter = {
      ...props.character,
      avatar_url: result.avatar_url
    };
    emit('update-character', updatedCharacter);

    PopupService.toast('头像上传成功', 'success');

  } catch (error) {
    console.error('上传头像失败:', error);
    PopupService.toast('头像上传失败', 'error');
  }
};


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
<style scoped>
/* 裁剪框模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.crop-modal {
  background-color: white;
  border-radius: 12px;
  width: 80%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
}

.close-btn:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
  flex: 1;
  overflow: auto;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-primary {
  padding: 8px 16px;
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.btn-primary:hover {
  background-color: #3a7bc8;
}

.btn-secondary {
  padding: 8px 16px;
  background-color: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
}

.btn-secondary:hover {
  background-color: #e8e8e8;
}

/* 确保裁剪器正确显示 */
.cropper-background {
  background-color: transparent;
}

:deep(.cropper-view-box) {
  border-radius: 50%;
}

:deep(.cropper-face) {
  background-color: transparent;
}
</style>