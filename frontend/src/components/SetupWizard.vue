<template>
  <div class="setup-wizard">
    <div class="wizard-header">
      <h2>欢迎使用 AI Chat</h2>
      <p class="subtitle">请点击选择您的第一个模型供应商以开始使用</p>
    </div>

    <div class="step-content">
      <!-- 供应商配置 -->
      <div class="provider-config-container">
        <div class="provider-selection">
          <div class="provider-grid">
            <div 
              v-for="tpl in providerTemplates" 
              :key="tpl.id"
              class="provider-card"
              @click="openProviderModal(tpl)"
            >
              <img :src="tpl.avatarUrl || '/static/images/providers/default.svg'" class="provider-avatar" />
              <div class="provider-info">
                <h4>{{ tpl.name }}</h4>
                <p>{{ tpl.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="wizard-footer">
      <el-button @click="skipProviderConfig">稍后配置</el-button>
    </div>

    <!-- 配置弹窗 -->
    <el-dialog
      v-model="showModal"
      :title="`配置 ${currentProvider?.name}`"
      width="500px"
      align-center
    >
      <el-form label-position="top">
        <el-form-item label="API Key">
          <el-input
            v-model="apiKeyInput"
            type="password"
            show-password
            placeholder="请输入您的 API Key"
          />
        </el-form-item>
        <div class="test-result">
          <el-tag v-if="testResult" :type="testResult.success ? 'success' : 'danger'">
            {{ testResult.message }}
          </el-tag>
        </div>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showModal = false">取消</el-button>
          <el-button type="primary" plain @click="testConnection" :loading="testing">
            测试连接
          </el-button>
          <el-button type="primary" @click="confirmAndFinish" :disabled="!testResult?.success">
            确认并完成
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'

const router = useRouter()

const submitting = ref(false)
const testing = ref(false)
const showModal = ref(false)
const currentProvider = ref<any>(null)
const apiKeyInput = ref('')
const testResult = ref<{ success: boolean; message: string } | null>(null)

// 步骤一数据（已移除，保留变量定义以防报错）
const adminFormRef = ref()
const adminForm = reactive({
  nickname: '',
  email: '',
  password: '',
  confirmPassword: ''
})

const validatePass2 = (rule: any, value: any, callback: any) => {
  if (value !== adminForm.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const adminRules = {
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [{ required: true, message: '请设置密码', trigger: 'blur' }],
  confirmPassword: [{ required: true, validator: validatePass2, trigger: 'blur' }]
}

// 步骤二数据
const providerTemplates = ref<any[]>([])

onMounted(async () => {
  // 获取供应商模板
  try {
    providerTemplates.value = await apiService.getProviderTemplates()
  } catch (e) {
    console.error('获取供应商模板失败', e)
  }
})

const openProviderModal = (tpl: any) => {
  currentProvider.value = tpl
  apiKeyInput.value = ''
  testResult.value = null
  showModal.value = true
}

const testConnection = async () => {
  if (!currentProvider.value || !apiKeyInput.value) {
    ElMessage.warning('请输入 API Key')
    return
  }
  
  testing.value = true
  testResult.value = null
  
  try {
    const payload = {
      provider: currentProvider.value.id,
      apiKey: apiKeyInput.value,
      apiUrl: currentProvider.value.defaultApiUrl // 使用模板中的默认 URL
    }
    
    const result = await apiService.testProviderConnection(payload)
    testResult.value = result
  } catch (error: any) {
    testResult.value = { success: false, message: error.message || '网络请求失败' }
  } finally {
    testing.value = false
  }
}

const confirmAndFinish = async () => {
  submitting.value = true
  try {
    // 只有确认时才真正创建供应商
    const payload = {
      provider: currentProvider.value.id,
      name: currentProvider.value.name,
      apiKey: apiKeyInput.value,
      protocol: currentProvider.value.protocol
    }
    
    await apiService.createProvider(payload)
    localStorage.setItem('hasCompletedSetup', 'true')
    router.push('/chat')
  } catch (error: any) {
    ElMessage.error(error.message || '保存配置失败')
  } finally {
    submitting.value = false
  }
}

const skipProviderConfig = () => {
  localStorage.setItem('hasCompletedSetup', 'true')
  router.push('/chat')
}
</script>

<style scoped>
.setup-wizard {
  width: 900px;
  max-width: 95vw;
  max-height: 90vh;
  margin: 20px auto;
  padding: 20px;
  background: #fff;
  border-radius: 16px;
  /* box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); */
  text-align: center;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wizard-header h2 {
  margin-bottom: 8px;
  color: #333;
  flex-shrink: 0;
}

.subtitle {
  color: #999;
  margin-bottom: 30px;
  flex-shrink: 0;
}

.wizard-steps {
  margin-bottom: 30px;
  flex-shrink: 0;
}

.step-content {
  flex: 1;
  overflow-y: auto;
  text-align: left;
  padding-right: 10px;
  min-height: 300px;
}

/* 自定义滚动条样式 */
.step-content::-webkit-scrollbar {
  width: 6px;
}

.step-content::-webkit-scrollbar-thumb {
  background-color: #ddd;
  border-radius: 3px;
}

.step-content::-webkit-scrollbar-track {
  background-color: transparent;
}

.wizard-form {
  margin-top: 20px;
}

.provider-selection {
  margin-bottom: 30px;
}

.hint {
  font-size: 13px;
  color: #999;
  margin-top: 8px;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.provider-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 12px;
}

.provider-card:hover {
  border-color: #409eff;
  /* box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); */
}

.provider-card.active {
  border-color: #409eff;
  background-color: #f0f7ff;
}

.provider-avatar {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
}

.provider-info h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: #333;
}

.provider-info p {
  margin: 0;
  font-size: 12px;
  color: #999;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.wizard-footer {
  margin-top: 40px;
  display: flex;
  justify-content: space-between;
}
</style>
