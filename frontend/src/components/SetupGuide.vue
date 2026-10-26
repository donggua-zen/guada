<template>
  <div v-if="visible" class="setup-guide-container" :style="{ top: guidePosition.y + 'px', left: guidePosition.x + 'px' }" @mousedown="startDrag">
    <div class="guide-header" @mousedown="startDrag">
      <span class="guide-title">{{ t('ui.setupGuide.title') }}</span>
      <div class="header-actions no-drag">
        <span class="skip-link" @click="skipGuide">{{ t('ui.setupGuide.skipGuide') }}</span>
        <el-icon class="close-btn cursor-pointer" @click="closeGuide"><Close /></el-icon>
      </div>
    </div>

    <!-- 步骤指示器：圆点可点击回退，检测完成的步骤打勾 -->
    <div class="guide-steps no-drag">
      <template v-for="stepNo in TOTAL_STEPS" :key="stepNo">
        <div class="step-dot" :class="dotClass(stepNo)" @click="goBackToStep(stepNo)">
          <el-icon v-if="isStepDone(stepNo)" :size="10"><Check /></el-icon>
          <span v-else>{{ stepNo }}</span>
        </div>
        <div v-if="stepNo < TOTAL_STEPS" class="step-connector"
          :class="{ filled: stepNo < currentStep || isStepDone(stepNo) }"></div>
      </template>
      <span class="step-indicator-text">
        {{ t('ui.setupGuide.stepIndicator', { current: currentStep, total: TOTAL_STEPS }) }}
      </span>
    </div>

    <div class="guide-content">
      <!-- Step 1: 免登录说明（默认无密码） -->
      <div v-if="currentStep === 1" class="step-panel">
        <h3>{{ t('ui.setupGuide.step1Title') }}</h3>
        <p class="desc">{{ t('ui.setupGuide.step1Desc') }}</p>
        <el-alert type="info" :closable="false" show-icon>
          {{ t('ui.setupGuide.tip') }}
        </el-alert>
      </div>

      <!-- Step 2: 修改密码引导（密码状态前端不可检测，保持手动推进） -->
      <div v-if="currentStep === 2" class="step-panel">
        <h3>{{ t('ui.setupGuide.step2Title') }}</h3>
        <p class="desc">{{ t('ui.setupGuide.step2Desc') }}</p>
        <div class="action-area">
          <el-button type="primary" @click="goToSecuritySettings">{{ t('ui.setupGuide.step2Action') }}</el-button>
        </div>
      </div>

      <!-- Step 3: 添加模型供应商（点击"去添加"即推进，从设置页回来已显示下一步） -->
      <div v-if="currentStep === 3" class="step-panel">
        <h3>{{ t('ui.setupGuide.step3Title') }}</h3>
        <p class="desc">{{ t('ui.setupGuide.step3Desc') }}</p>
        <div class="action-area">
          <el-button type="primary" @click="goToProviderSettings">{{ t('ui.setupGuide.step3Action') }}</el-button>
        </div>
      </div>

      <!-- Step 4: 设置默认模型 -->
      <div v-if="currentStep === 4" class="step-panel">
        <h3>{{ t('ui.setupGuide.step4Title') }}</h3>
        <p class="desc">{{ t('ui.setupGuide.step4Desc') }}</p>
        <div class="action-area">
          <el-button type="primary" @click="goToDefaultModelSettings">{{ t('ui.setupGuide.step4Action') }}</el-button>
        </div>
      </div>
    </div>

    <div class="guide-footer no-drag">
      <el-button v-if="currentStep > 1" size="small" @click="prevStep">{{ t('ui.setupGuide.back') }}</el-button>
      <el-button size="small" type="primary" @click="nextStep">
        {{ currentStep === TOTAL_STEPS ? t('ui.setupGuide.finish') : t('ui.setupGuide.next') }}
      </el-button>
    </div>
  </div>

  <!-- 全局悬浮引导入口（X 关闭或完成后消失） -->
  <div v-if="!visible && !hasCompleted" class="guide-fab" @click="openGuide" :title="t('ui.setupGuide.viewGuide')">
    <el-icon><QuestionFilled /></el-icon>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NEW_SESSION_ID } from '@/constants'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { Close, QuestionFilled, Check } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { isElectron } from '@/composables/useDevice'
import { apiService } from '@/services/ApiService'

const TOTAL_STEPS = 4

const { t } = useI18n()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()
const visible = ref(false)
const hasCompleted = ref(localStorage.getItem('hasCompletedSetup') === 'true')
const currentStep = ref(1)
const guidePosition = ref({ x: window.innerWidth - 350, y: 60 })
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

// 完成状态感知：仅第 3 步（已配置供应商）与第 4 步（已设默认模型）前端可检测；
// 第 1 步是说明页、第 2 步密码状态前端不可检测，均保持手动推进
const providerConfigured = ref(false)
const defaultModelSet = ref(false)

const isStepDone = (stepNo: number): boolean => {
  if (stepNo === 3) return providerConfigured.value
  if (stepNo === 4) return defaultModelSet.value
  return stepNo < currentStep.value
}

const dotClass = (stepNo: number) => ({
  done: isStepDone(stepNo) && stepNo !== currentStep.value,
  current: stepNo === currentStep.value,
  clickable: stepNo < currentStep.value,
})

async function refreshCompletion(): Promise<void> {
  if (hasCompleted.value) return
  const [modelsRes, settingsRes] = await Promise.allSettled([
    apiService.fetchAllModels(),
    apiService.fetchGroupSettings('models'),
  ])
  if (modelsRes.status === 'fulfilled') {
    providerConfigured.value = (modelsRes.value.items?.length ?? 0) > 0
  }
  if (settingsRes.status === 'fulfilled') {
    defaultModelSet.value = !!settingsRes.value?.defaultChatModelId
  }
}

// 当前停留在已检测完成的步骤时向前推进；3、4 步均完成则直接结束引导
function advancePastCompleted(): void {
  if (providerConfigured.value && defaultModelSet.value) {
    finishGuide()
    return
  }
  if (currentStep.value === 3 && providerConfigured.value) {
    currentStep.value = 4
  }
}

async function refreshAndAdvance(): Promise<void> {
  await refreshCompletion()
  if (visible.value) advancePastCompleted()
}

onMounted(() => {
  restorePosition()
  // 引导只在 Electron 首次启动时自动弹出。Web 部署是多人/多浏览器访问，
  // 新浏览器（新 localStorage）没有完成标记会反复弹，改为仅保留右下角手动入口
  if (isElectron && !hasCompleted.value) {
    visible.value = true
    const savedStep = localStorage.getItem('setupGuideStep')
    if (savedStep) currentStep.value = parseInt(savedStep)
  }
  refreshAndAdvance()
})

// 监听认证状态：一旦登录成功且未完成设置，则跳转第二步（同样仅 Electron 自动弹出）
watch(() => authStore.isAuthenticated, (isAuth) => {
  if (isElectron && isAuth && !hasCompleted.value) {
    currentStep.value = 2
    localStorage.setItem('setupGuideStep', '2')
    visible.value = true
  }
})

// 引导可见期间路由变化（多为从设置页操作回来）即刷新完成状态
watch(() => route.path, () => {
  if (visible.value && !hasCompleted.value) refreshAndAdvance()
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
    persistPosition()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const POSITION_KEY = 'setupGuidePosition'

function restorePosition(): void {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (typeof saved?.x === 'number' && typeof saved?.y === 'number') {
        guidePosition.value = saved
      }
    }
  } catch { /* 损坏的持久化数据按默认位置处理 */ }
  clampPosition()
}

function persistPosition(): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(guidePosition.value))
  } catch { /* 存储不可用时静默降级 */ }
}

// 边界检查：防止窗口缩小时弹窗被遮挡
function clampPosition(): void {
  const guideWidth = 320
  const guideHeight = 400 // 估算高度
  const maxX = window.innerWidth - guideWidth
  const maxY = window.innerHeight - guideHeight

  guidePosition.value.x = Math.max(10, Math.min(guidePosition.value.x, maxX))
  guidePosition.value.y = Math.max(10, Math.min(guidePosition.value.y, maxY))
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', clampPosition)
}

// X：仅隐藏，右下角问号 FAB 保留（"稍后再看"）
const closeGuide = () => {
  visible.value = false
}

const openGuide = () => {
  visible.value = true
  const savedStep = localStorage.getItem('setupGuideStep')
  if (savedStep) currentStep.value = parseInt(savedStep)
  refreshAndAdvance()
}

// 「跳过引导」= 标记完成并永久关闭（不再出现），不导航
const skipGuide = () => {
  finishGuide(false)
}

const prevStep = () => {
  if (currentStep.value > 1) currentStep.value--
}

const nextStep = () => {
  if (currentStep.value < TOTAL_STEPS) {
    currentStep.value++
  } else {
    finishGuide(true)
  }
}

// 圆点回退（仅允许回到已过的步骤）
const goBackToStep = (stepNo: number) => {
  if (stepNo < currentStep.value) currentStep.value = stepNo
}

// 步骤动作按钮：点击即视为该步完成并推进，从设置页操作回来引导已显示下一步
function advanceFromStep(stepNo: number): void {
  if (currentStep.value === stepNo && stepNo < TOTAL_STEPS) {
    currentStep.value = stepNo + 1
  }
}

const goToSecuritySettings = () => {
  advanceFromStep(2)
  router.replace({ name: 'SystemSettings', params: { tab: 'security' } })
}

const goToProviderSettings = () => {
  advanceFromStep(3)
  router.replace('/setting/providers')
}

const goToDefaultModelSettings = () => {
  advanceFromStep(4)
  router.replace('/setting/default-models')
}

// navigate=false 用于"跳过引导"：留在当前页面，仅标记完成
function finishGuide(navigate = true): void {
  hasCompleted.value = true
  localStorage.setItem('hasCompletedSetup', 'true')
  localStorage.removeItem('setupGuideStep')
  visible.value = false
  ElMessage.success(t('ui.setupGuide.completed'))
  if (navigate) {
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
  }
}

// 暴露方法给父组件调用
defineExpose({
  openGuide: () => {
    openGuide()
  }
})
</script>

<style scoped>
.setup-guide-container {
  position: fixed;
  width: 320px;
  background: var(--gd-color-surface);
  border: 1px solid var(--gd-color-surface-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 2000;
  user-select: none;
  display: flex;
  flex-direction: column;
}

.guide-header {
  padding: 14px 16px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
  user-select: none;
}

.guide-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--gd-color-text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.skip-link {
  font-size: 12px;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  transition: color 0.15s;
}

.skip-link:hover {
  color: var(--gd-color-primary);
}

.close-btn {
  color: var(--gd-color-text-gray);
  transition: color 0.15s;
}

.close-btn:hover {
  color: var(--gd-color-text-primary);
}

/* ── 步骤指示器 ── */
.guide-steps {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px 12px;
}

.step-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--gd-color-text-gray);
  background: var(--gd-color-sidebar-bg);
  border: 1px solid var(--gd-color-surface-border);
  flex-shrink: 0;
  transition: all 0.15s;
}

.step-dot.clickable {
  cursor: pointer;
}

.step-dot.clickable:hover {
  border-color: var(--gd-color-primary);
}

.step-dot.done {
  background: var(--gd-color-primary);
  border-color: var(--gd-color-primary);
  color: #fff;
}

.step-dot.current {
  border-color: var(--gd-color-primary);
  color: var(--gd-color-primary);
  font-weight: 600;
  box-shadow: 0 0 0 3px var(--gd-color-primary-0f);
}

.step-connector {
  flex: 1;
  height: 1px;
  background: var(--gd-color-surface-border);
}

.step-connector.filled {
  background: var(--gd-color-primary);
}

.step-indicator-text {
  margin-left: auto;
  font-size: 11px;
  color: var(--gd-color-text-gray);
  flex-shrink: 0;
}

.guide-content {
  padding: 4px 16px 16px;
  flex: 1;
  overflow-y: auto;
}

.step-panel h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: var(--gd-color-text-primary);
}

.desc {
  font-size: 13px;
  color: var(--gd-color-text-secondary);
  margin-bottom: 12px;
}

.action-area {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}

.guide-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--gd-color-surface-border);
}

.guide-fab {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--gd-color-primary);
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
  background: var(--gd-color-primary-hover);
}
</style>
