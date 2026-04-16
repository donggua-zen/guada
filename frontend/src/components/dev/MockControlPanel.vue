<template>
  <div class="mock-control-panel" v-if="isVisible">
    <div class="panel-header">
      <h3>🎭 Mock 测试面板</h3>
      <button @click="toggleVisibility" class="close-btn">×</button>
    </div>

    <div class="panel-content">
      <!-- Mock 开关 -->
      <div class="control-section">
        <label class="switch-label">
          <span>Mock 模式</span>
          <label class="switch">
            <input 
              type="checkbox" 
              :checked="isMockEnabled" 
              @change="handleToggleMock"
            />
            <span class="slider"></span>
          </label>
        </label>
      </div>

      <!-- 场景选择 -->
      <div class="control-section" v-if="isMockEnabled">
        <label>选择场景:</label>
        <select v-model="selectedScenario" @change="handleScenarioChange">
          <option value="">-- 自定义 --</option>
          <option v-for="(config, name) in scenarios" :key="name" :value="name">
            {{ formatScenarioName(name) }}
          </option>
        </select>
      </div>

      <!-- 当前配置预览 -->
      <div class="control-section" v-if="isMockEnabled && currentConfig">
        <label>当前配置:</label>
        <pre class="config-preview">{{ JSON.stringify(currentConfig, null, 2) }}</pre>
      </div>

      <!-- 快捷操作 -->
      <div class="control-section" v-if="isMockEnabled">
        <button @click="applyAndReload" class="action-btn">
          应用并刷新
        </button>
        <p class="hint">💡 修改配置后需刷新页面生效</p>
      </div>
    </div>
  </div>

  <!-- 浮动按钮（面板隐藏时显示） -->
  <button 
    v-if="!isVisible && isDev" 
    class="mock-float-btn"
    @click="toggleVisibility"
    title="打开 Mock 测试面板"
  >
    🎭
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const isDev = import.meta.env.DEV
const isVisible = ref(false)
const isMockEnabled = ref(false)
const selectedScenario = ref('')
const scenarios = ref<Record<string, any>>({})
const currentConfig = ref<any>(null)

onMounted(async () => {
  // 从 localStorage 读取运行时配置
  isMockEnabled.value = localStorage.getItem('VITE_ENABLE_MOCK') === 'true'
  
  // 动态导入 Mock 场景（仅开发环境）
  if (isDev) {
    try {
      const { getAvailableScenarios, getScenarioConfig } = await import('@/services/mockStreamService')
      scenarios.value = getAvailableScenarios()
      
      const savedScenario = localStorage.getItem('VITE_MOCK_SCENARIO')
      if (savedScenario && savedScenario in scenarios.value) {
        selectedScenario.value = savedScenario
        currentConfig.value = getScenarioConfig(savedScenario as any)
      }
    } catch (e) {
      console.warn('⚠️ Mock 模块加载失败:', e)
    }
  }
})

function toggleVisibility() {
  isVisible.value = !isVisible.value
}

async function handleToggleMock(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  isMockEnabled.value = enabled
  
  localStorage.setItem('VITE_ENABLE_MOCK', enabled ? 'true' : 'false')
  
  if (enabled && selectedScenario.value) {
    localStorage.setItem('VITE_MOCK_SCENARIO', selectedScenario.value)
  }
  
  console.log(`🎭 Mock 模式已${enabled ? '启用' : '禁用'}`)
  
  // 重新初始化 API Service（同步）
  try {
    const { reinitApiService } = await import('@/services/ApiService')
    reinitApiService()
    console.log('✅ API Service 已更新，请刷新页面以完全生效')
  } catch (e) {
    console.warn('⚠️ API Service 重新初始化失败:', e)
  }
}

async function handleScenarioChange() {
  if (selectedScenario.value) {
    try {
      const { getScenarioConfig } = await import('@/services/mockStreamService')
      currentConfig.value = getScenarioConfig(selectedScenario.value as any)
      localStorage.setItem('VITE_MOCK_SCENARIO', selectedScenario.value)
      
      // 重新初始化 API Service（同步）
      const { reinitApiService } = await import('@/services/ApiService')
      reinitApiService()
      console.log('✅ 场景已切换，请刷新页面以完全生效')
    } catch (e) {
      console.warn('⚠️ 场景配置加载失败:', e)
    }
  } else {
    currentConfig.value = null
    localStorage.removeItem('VITE_MOCK_SCENARIO')
  }
}

function applyAndReload() {
  console.log('💡 正在刷新页面...')
  
  // 重新初始化 API Service（同步）
  import('@/services/ApiService').then(({ reinitApiService }) => {
    reinitApiService()
  })
  
  setTimeout(() => {
    window.location.reload()
  }, 300)
}

function formatScenarioName(name: string): string {
  const names: Record<string, string> = {
    NORMAL_TEXT: '正常文本',
    WITH_THINKING: '带思考过程',
    WITH_TOOL_CALLS: '工具调用',
    THINKING_AND_TOOLS: '思考+工具',
    ERROR_TIMEOUT: '超时错误',
    ERROR_API: 'API 错误',
    LONG_TEXT: '长文本（测试滚动）',
  }
  return names[name] || name
}
</script>

<style scoped>
.mock-control-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 380px;
  max-height: 80vh;
  background: white;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f0f9ff;
  border-bottom: 1px solid #e0f2fe;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  color: #0369a1;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  width: 24px;
  height: 24px;
}

.close-btn:hover {
  color: #dc2626;
}

.panel-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.control-section {
  margin-bottom: 16px;
}

.control-section:last-child {
  margin-bottom: 0;
}

.control-section label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 6px;
}

.switch-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

/* Switch 样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #cbd5e1;
  transition: .3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #3b82f6;
}

input:checked + .slider:before {
  transform: translateX(20px);
}

select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  font-size: 13px;
  color: #1f2937;
}

select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px #bfdbfe;
}

.config-preview {
  background: #f8fafc;
  padding: 10px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  margin: 0;
  border: 1px solid #e2e8f0;
  max-height: 200px;
}

.action-btn {
  width: 100%;
  padding: 10px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.action-btn:hover {
  background: #2563eb;
}

.hint {
  margin: 8px 0 0 0;
  font-size: 11px;
  color: #64748b;
  text-align: center;
}

.mock-float-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  border: none;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  transition: all 0.2s;
  z-index: 9998;
}

.mock-float-btn:hover {
  background: #2563eb;
  transform: scale(1.1);
}
</style>
