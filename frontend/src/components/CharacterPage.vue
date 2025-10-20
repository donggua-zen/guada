<template>
  <div class="settings-container">

    <div class="settings-header">
      <span>角色列表</span>
      <button class="new-character-btn" id="newCharacterBtn" @click="back">
        <i class="fas fa-plus"></i> 退出
      </button>
    </div>
    <div class="settings-content">
      <!-- 头像设置 -->
      <div class="settings-section">
        <h3 class="section-title">基础设置</h3>

        <div class="setting-group">
          <div class="avatar-upload-container">
            <div class="avatar-preview">
              <img v-if="previewUrl" :src="previewUrl" class="avatar-image" alt="头像预览"></img>
              <i v-else class="fas fa-user"></i>
            </div>
            <div class="avatar-upload-actions">
              <input type="file" ref="avatarInput" accept="image/*" style="display: none" @change="handleAvatarCrop" />
              <button class="avatar-upload-btn" @click="triggerAvatarUpload">
                <i class="fas fa-upload"></i> 选择图片
              </button>
              <button class="avatar-upload-btn remove-btn">
                <i class="fas fa-trash"></i> 移除头像
              </button>
            </div>
          </div>
        </div>
        <div class="setting-group">
          <label class="setting-label">角色标题(必填)</label>
          <input class="setting-input" type="text" placeholder="请输入角色标题" v-model="currentCharacter.title">
        </div>
        <div class="setting-group">
          <label class="setting-label">角色描述(必填)</label>
          <textarea class="setting-textarea" placeholder="请输入角色描述" v-model="currentCharacter.description"></textarea>
        </div>



      </div>

      <!-- 基础设置 -->
      <div class="settings-section">
        <h3 class="section-title">提示词</h3>


        <div class="setting-group">
          <label class="setting-label">角色名字</label>
          <input class="setting-input" type="text" placeholder="请输入角色名字" v-model="currentCharacter.name">
        </div>

        <div class="setting-group">
          <label class="setting-label">职业设定</label>
          <input class="setting-input" type="text" placeholder="请输入职业设定" v-model="currentCharacter.identity">
        </div>


        <div class="setting-group">
          <label class="setting-label">详细设定(必填)</label>
          <textarea class="setting-textarea setting-textarea-large" placeholder="请输入详细设定"
            v-model="currentCharacter.detailed_setting"></textarea>
        </div>
      </div>

      <!-- 推荐模型参数 -->
      <div class="settings-section">
        <h3 class="section-title">推荐模型参数</h3>

        <div class="recommended-params">
          <div class="setting-group">
            <label class="setting-label">模型选择</label>
            <select class="setting-select">
              <option value="">默认/不设置</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="gpt-4">GPT-4</option>
              <option value="claude-2">Claude 2</option>
              <option value="llama-2">Llama 2</option>
            </select>
          </div>

          <div class="setting-group">
            <label class="setting-label">记忆类型</label>
            <select class="setting-select">
              <option value="">默认/不设置</option>
              <option value="sliding_window">滑动窗口</option>
              <option value="summary_augmented">摘要增强</option>
              <option value="memoryless">无记忆</option>
            </select>
          </div>

          <div class="setting-group">
            <label class="setting-label">最大记忆长度</label>
            <input class="setting-input number-input" type="number" min="0" max="10000" placeholder="默认">
          </div>

          <div class="setting-group">
            <label class="setting-label">短期记忆长度</label>
            <input class="setting-input number-input" type="number" min="0" max="1000" placeholder="默认">
          </div>

          <div class="setting-group">
            <label class="setting-label">温度</label>
            <input class="setting-input number-input" type="number" min="0" max="2" step="0.1" placeholder="默认">
          </div>

          <div class="setting-group">
            <label class="setting-label">TOP-K</label>
            <input class="setting-input number-input" type="number" min="0" max="100" placeholder="默认">
          </div>
        </div>
      </div>
    </div>

    <div class="settings-footer">
      <button class="cancel-btn">取消</button>
      <button class="save-settings-btn" @click="saveAllSettings">
        <i class="fas fa-save"></i> 保存设置
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
        <cropper ref="cropperAvatar" :src="cropImageSrc" :stencil-props="{
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
import { ref, computed, onMounted, onUnmounted, watch, reactive, watchEffect } from 'vue'
import { apiService } from '../services/llmApi'
import PopupService from '../services/PopupService'
// 新增导入
// import { VueCropper } from 'vue-cropperjs';
// import 'cropperjs/dist/cropper.css';
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
import { useRoute, useRouter } from 'vue-router'
import { useVuelidate } from '@vuelidate/core'
import { required, email, minLength, maxLength } from '@vuelidate/validators'

const route = useRoute()
const router = useRouter()


const currentCharacter = ref({
  id: '',
  title: '',
  description: '',
  name: '',
  identity: '',
  detailed_setting: '',
  avatar_url: ''
});
// 验证规则
const rules = {
  title: { required, minLength: minLength(4), maxLength: maxLength(20) },
  description: {
    required,
    minLength: minLength(4),
    maxLength: maxLength(100),
  },
  name: { minLength: minLength(8), maxLength: maxLength(100) },
  identity: { minLength: minLength(8), maxLength: maxLength(100) },
  detailed_setting: { required, minLength: minLength(8), maxLength: maxLength(4000) },
}

const v$ = useVuelidate(rules, currentCharacter);

const emit = defineEmits(['update-character', 'update-session'])

const models = ref([]);
const showAdvancedSettings = ref(false);
const avatarFile = reactive({
  file: null,
  dataUrl: null
});
const avatarInput = ref(null);//文件选择框引用

const previewUrl = ref(null)


watchEffect(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (avatarFile.file) {
    // 创建预览URL
    previewUrl.value = URL.createObjectURL(avatarFile.file)
  } else if (currentCharacter.value.avatar_url) {
    // 创建预览URL
    previewUrl.value = currentCharacter.value.avatar_url
  } else {
    previewUrl.value = null
  }
});

onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

// 计算高级设置图标
const advancedSettingsIcon = computed(() =>
  showAdvancedSettings.value ? 'fa-chevron-up' : 'fa-chevron-down'
)

// 监听角色变化
// watch(() => props.character, (newVal) => {
//   // 可以在这里处理角色变化
// }, { deep: true })

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
const cropperAvatar = ref(null);
// 处理头像上传
const handleAvatarCrop = (event) => {
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
  if (!cropperAvatar.value) return;
  console.log('裁剪头像2');
  // 获取裁剪后的canvas
  const { coordinates, canvas } = cropperAvatar.value.getResult();

  // cropperAvatar.value.getCroppedCanvas({
  //   imageSmoothingEnabled: true,
  //   imageSmoothingQuality: 'high',
  //   fillColor: '#fff', // 填充白色背景
  // })
  console.log(canvas);
  canvas.toBlob((blob) => {
    // avatarInput.value = blob;
    // 创建新文件对象
    const croppedFile = new File([blob], cropFile.value.name, {
      type: cropFile.value.type,
      lastModified: Date.now(),
    });

    avatarFile.file = croppedFile;

    // // 上传裁剪后的图片
    // uploadAvatar(croppedFile);

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

// 移除头像
const removeAvatar = () => {
  currentCharacter.value.avatar_url = '';
  avatarFile.file = null;
}


const back = () => {
  router.back();
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

const loadCharacter = async () => {
  if (!route.params.characterId) {
    return;
  }
  PopupService.loading('加载中...')
  const character = await apiService.fetchCharacter(route.params.characterId);
  currentCharacter.value = character;
  PopupService.close()
}

// 保存所有设置
const saveAllSettings = async () => {
  v$.value.$touch()
  if (v$.value.$error) {
    PopupService.error('请填写必填项', '请填写必填项')
    return;
  }
  try {
    PopupService.loading('保存中...')
    const isCreate = !route.params.characterId
    if (isCreate) {
      const response = await apiService.createCharacter(currentCharacter.value);
      currentCharacter.value = response;
    } else {
      await apiService.updateCharacter(currentCharacter.value.id, currentCharacter.value)
    }
    if (avatarFile.file) {
      const response = await apiService.uploadAvatar(currentCharacter.value.id, avatarFile.file)
      avatarFile.file = null
      currentCharacter.value.avatar_url = response.avatar_url
    }
    if (isCreate) {
      router.replace({ name: 'Character', params: { characterId: currentCharacter.value.id } })
    }
    PopupService.success('保存成功', 'success').then(() => {
      if (isCreate)
        router.back()
    });
  } catch (error) {
    console.error('保存设置失败:', error)
    PopupService.error('保存失败', error.message || '未知错误')
  }
}

// 切换高级设置显示
const toggleAdvancedSettings = () => {
  showAdvancedSettings.value = !showAdvancedSettings.value
}

// 组件挂载时加载模型列表
onMounted(() => {
  loadCharacter();
})
</script>

<style scoped>
.settings-container {
  max-width: 900px;
  margin: 0 auto;
  /* background-color: #fff; */
  /* border-radius: 12px; */
  /* box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); */
  overflow: hidden;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 15px;
  border-bottom: 1px solid #e0e6ed;
}

.settings-header span {
  font-size: 24px;
  font-weight: 600;
  color: #2c3e50;
}

.settings-content {
  display: flex;
  flex-wrap: wrap;
  /* padding: 30px; */
  gap: 30px;
}

.settings-section {
  flex: 1;
  min-width: 300px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid #efefef;
  color: #2c3e50;
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
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  border: 3px dashed #d0d0d0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background-color: #f9f9f9;
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
  color: #999;
}

.avatar-placeholder i {
  font-size: 50px;
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
.setting-textarea,
.setting-select {
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
.setting-textarea:focus,
.setting-select:focus {
  border-color: #4a90e2;
  outline: none;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
}

.setting-input:hover,
.setting-textarea:hover,
.setting-select:hover {
  border-color: #a0a0a0;
}

.setting-textarea {
  min-height: 80px;
  resize: none;
}

.setting-textarea-large {
  min-height: 178px;
}

.number-input {
  width: 100px;
}

.settings-footer {
  padding: 20px 30px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  gap: 15px;
}

.save-settings-btn {
  padding: 12px 25px;
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
  gap: 8px;
}

.save-settings-btn:hover {
  background-color: #3a7bc8;
}

.cancel-btn {
  padding: 12px 25px;
  background-color: #f5f5f5;
  color: #555;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-btn:hover {
  background-color: #e8e8e8;
}

.recommended-params {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

@media (max-width: 768px) {
  .settings-content {
    flex-direction: column;
  }

  .recommended-params {
    grid-template-columns: 1fr;
  }
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
  background-color: #4a90e2;
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