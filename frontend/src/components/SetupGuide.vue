<template>
  <div v-if="visible" class="setup-guide-container" :style="{ top: guidePosition.y + 'px', left: guidePosition.x + 'px' }" @mousedown="startDrag">
    <div class="guide-header" @mousedown="startDrag">
      <span class="guide-title">✨ 欢迎开启 GuaDa 之旅</span>
      <el-icon class="close-btn cursor-pointer" @click="closeGuide"><Close /></el-icon>
    </div>
    
    <div class="guide-content">
      <!-- Step 1: 默认账户提示 -->
      <div v-if="currentStep === 1" class="step-panel">
        <h3>👋 第一步：记下您的专属通行证</h3>
        <p class="desc">为了让您快速体验，我们为您准备了初始账户：</p>
        <div class="account-info">
          <div class="info-item">
            <span class="label">账户：</span>
            <span class="value">GuaDa</span>
          </div>
          <div class="info-item">
            <span class="label">密码：</span>
            <span class="value">GuaDa</span>
          </div>
        </div>
        <el-alert type="warning" :closable="false" show-icon>
          小贴士：为了账户安全，建议您稍后修改密码哦～
        </el-alert>
      </div>

      <!-- Step 2: 修改密码引导 -->
      <div v-if="currentStep === 2" class="step-panel">
        <h3>🔒 第二步：给账户加把锁</h3>
        <p class="desc">修改一个只有您知道的密码，让账户更安全。</p>
        <div class="action-area">
          <el-button type="primary" @click="goToSecuritySettings">去设置新密码</el-button>
        </div>
      </div>

      <!-- Step 3: 添加模型供应商 -->
      <div v-if="currentStep === 3" class="step-panel">
        <h3>🚀 第三步：连接 AI 大脑</h3>
        <p class="desc">配置一个模型供应商，填入 API Key 即可开始对话。</p>
        <div class="action-area">
          <el-button type="primary" @click="goToProviderSettings">去配置供应商</el-button>
        </div>
      </div>

      <!-- Step 4: 设置默认模型 -->
      <div v-if="currentStep === 4" class="step-panel">
        <h3>🎯 第四步：选择您的首选模型</h3>
        <p class="desc">在设置中指定一个默认模型，让对话更顺手。</p>
        <div class="action-area">
          <el-button type="primary" @click="goToDefaultModelSettings">去设置默认模型</el-button>
        </div>
      </div>
    </div>

    <div class="guide-footer no-drag">
      <el-button size="small" @click="skipStep">跳过</el-button>
      <el-button size="small" type="primary" @click="nextStep" :disabled="!canProceed">
        {{ currentStep === 4 ? '完成' : '下一步' }}
      </el-button>
    </div>
  </div>

  <!-- 全局悬浮引导入口 -->
  <div v-if="!visible && !hasCompleted" class="guide-fab" @click="openGuide" title="查看设置向导">
    <el-icon><QuestionFilled /></el-icon>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Close, QuestionFilled } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const visible = ref(false)
const hasCompleted = ref(localStorage.getItem('hasCompletedSetup') === 'true')
const currentStep = ref(1)
const guidePosition = ref({ x: window.innerWidth - 350, y: 60 })
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

// Step 3 Data
const providerTemplates = ref<any[]>([])
const selectedProvider = ref<any>(null)
const apiKeyInput = ref('')
const testing = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

const canProceed = computed(() => {
  return true
})

onMounted(async () => {
  const hasCompleted = localStorage.getItem('hasCompletedSetup') === 'true'
  if (!hasCompleted) {
    visible.value = true
    // 恢复步骤：从本地存储读取
    const savedStep = localStorage.getItem('setupGuideStep')
    if (savedStep) currentStep.value = parseInt(savedStep)
    
    // 获取供应商模板
    try {
      providerTemplates.value = await apiService.getProviderTemplates()
    } catch (e) {
      console.error('获取供应商模板失败', e)
    }
  }
})

// 监听认证状态：一旦登录成功且未完成设置，则跳转第二步
watch(() => authStore.isAuthenticated, (isAuth) => {
  const hasCompleted = localStorage.getItem('hasCompletedSetup') === 'true'
  if (isAuth && !hasCompleted) {
    currentStep.value = 2
    localStorage.setItem('setupGuideStep', '2')
    visible.value = true
  }
})

watch(currentStep, (val) => {
  localStorage.setItem('setupGuideStep', val.toString())
})

const startDrag = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains('no-drag')) return
  isDragging.value = true
  dragOffset.value = {
    x: e.clientX - guidePosition.value.x,
    y: e.clientY - guidePosition.value.y
  }
  
  const onMove = (moveEvent: MouseEvent) => {
    if (!isDragging.value) return
    guidePosition.value = {
      x: moveEvent.clientX - dragOffset.value.x,
      y: moveEvent.clientY - dragOffset.value.y
    }
  }
  
  const onUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const closeGuide = () => {
  visible.value = false
}

const openGuide = () => {
  visible.value = true
  const savedStep = localStorage.getItem('setupGuideStep')
  if (savedStep) currentStep.value = parseInt(savedStep)
}

const skipStep = () => {
  if (currentStep.value < 4) {
    currentStep.value++
  } else {
    finishGuide()
  }
}

const nextStep = async () => {
  if (currentStep.value < 4) {
    currentStep.value++
  } else {
    finishGuide()
  }
}

const goToSecuritySettings = () => {
  router.push('/account/security')
}

const goToProviderSettings = () => {
  router.push('/setting/models')
}

const goToDefaultModelSettings = () => {
  router.push('/setting/default-models')
}

const finishGuide = () => {
  localStorage.setItem('hasCompletedSetup', 'true')
  localStorage.removeItem('setupGuideStep')
  hasCompleted.value = true
  visible.value = false
  ElMessage.success('恭喜！您已完成初始设置。')
  
  // 完成后跳转到对话页面
  router.push('/chat')
}

// 边界检查：防止窗口缩小时弹窗被遮挡
const clampPosition = () => {
  const guideWidth = 320
  const guideHeight = 400 // 估算高度
  const maxX = window.innerWidth - guideWidth
  const maxY = window.innerHeight - guideHeight
  
  guidePosition.value.x = Math.max(10, Math.min(guidePosition.value.x, maxX))
  guidePosition.value.y = Math.max(10, Math.min(guidePosition.value.y, maxY))
}

// 监听窗口大小变化
if (typeof window !== 'undefined') {
  window.addEventListener('resize', clampPosition)
  // 监听自定义事件以同步状态
  window.addEventListener('local-storage-update', () => {
    // 这里可以做一些额外的 UI 刷新，如果需要的话
  })
}

// 暴露方法给父组件调用
defineExpose({
  openGuide: () => {
    visible.value = true
    const savedStep = localStorage.getItem('setupGuideStep')
    if (savedStep) currentStep.value = parseInt(savedStep)
  }
})
</script>

<style scoped>
.setup-guide-container {
  position: fixed;
  width: 320px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 2000;
  user-select: none;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(10px);
}

.guide-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
  user-select: none;
}

.guide-title {
  font-weight: 600;
  font-size: 14px;
}

.guide-content {
  padding: 16px;
  flex: 1;
  overflow-y: auto;
}

.step-panel h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: var(--color-text-primary);
}

.desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.account-info {
  background: var(--color-bg-muted);
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 4px;
}

.provider-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.provider-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
}

.provider-card:hover, .provider-card.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.provider-avatar {
  width: 32px;
  height: 32px;
  object-fit: contain;
  margin-bottom: 4px;
}

.provider-name {
  font-size: 12px;
}

.guide-footer {
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
}

.guide-fab {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  z-index: 1999;
  transition: all 0.3s ease;
}

.guide-fab:hover {
  transform: scale(1.1);
  background: var(--color-primary-hover);
}
</style>
