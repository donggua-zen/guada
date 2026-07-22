<template>
  <CustomPopover :show="visible" @update:show="onMainShowChange" :width="300" :max-height="440" :anchor-el="anchorEl"
    popper-class="model-popover compact-popover">
    <div class="model-panel">
      <!-- 已选择模型（hover 弹出全部模型） -->
      <div class="current-model-section">
        <div ref="currentModelRef" class="current-model-card" @mouseenter="openCascade('browse', currentModelRef)"
          @mouseleave="scheduleCloseCascade">
          <template v-if="currentModel">
            <div class="w-8 h-8 shrink-0">
              <Avatar :src="getModelAvatarPath(currentModel.modelName, currentModelProviderName) || undefined"
                :name="getModelDisplayName(currentModel.modelName)" type="assistant" :round="false"
                class="w-full h-full" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">
                {{ getModelDisplayName(currentModel.modelName) }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <span class="truncate">{{ currentModelProviderName }}</span>
                <template v-for="feature in (currentModel?.config?.features || [])" :key="feature">
                  <el-icon :size="12">
                    <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                    <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                  </el-icon>
                </template>
              </div>
            </div>
          </template>
          <template v-else>
            <span class="text-sm flex-1 py-3 text-gray-400">选择模型，鼠标悬停此处以选择模式</span>
          </template>
          <el-icon size="14" class="text-gray-400 shrink-0">
            <ChevronRight24Regular />
          </el-icon>
        </div>
      </div>


      <!-- 推理强度 - 级联 -->
      <template v-if="thinkingEffortOptions.length > 0">
        <div ref="thinkingRef" class="cascade-trigger" @mouseenter="openCascade('thinking', thinkingRef)"
          @mouseleave="scheduleCloseCascade">

          <span class="text-sm flex-1">推理强度</span>
          <span class="text-xs text-gray-400">
            {{ thinkingEffortLabel }}</span>
          <el-icon size="14" class="text-gray-400">
            <ChevronRight24Regular />
          </el-icon>
        </div>
      </template>

      <!-- 收藏模型 -->
      <template v-if="favoriteModels.length > 0">
        <div class="section-divider"></div>
        <div class="section-label">收藏模型</div>
        <div class="favorite-models-list space-y-0.5" style="max-height: 220px; overflow-y: auto;">
          <div v-for="model in favoriteModels" :key="model.id"
            class="model-item-compact px-1.5 py-1 rounded-xl cursor-pointer transition-all flex items-center space-x-1.5"
            :class="{
              'model-item-active': currentModelId === model.id
            }" @click="handleSelect(model.id)">
            <div class="w-8 h-8 shrink-0">
              <Avatar :src="getModelAvatarPath(model.modelName, getModelProviderName(model)) || undefined"
                :name="getModelDisplayName(model.modelName)" type="assistant" :round="false" class="w-full h-full" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">
                {{ getModelDisplayName(model.modelName) }}
              </div>
              <div class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <span class="truncate">{{ getModelProviderName(model) }}</span>
                <template v-for="feature in (model.config?.features || [])" :key="feature">
                  <el-icon :size="12">
                    <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                    <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                  </el-icon>
                </template>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </CustomPopover>

  <!-- 级联：全部模型列表 -->
  <CustomPopover :show="cascadeMenu.visible && cascadeMenu.type === 'browse'" @update:show="onCascadeShowChange"
    :width="300" :max-height="400" :position="cascadePosition" @mouseenter="cancelCloseCascade"
    @mouseleave="scheduleCloseCascade">
    <template v-for="provider in filteredProviders" :key="provider.id">
      <div class="provider-group">
        <div class="provider-name text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
          {{ provider.name }}
        </div>
        <div class="provider-models space-y-1">
          <div v-for="model in getProviderModels(provider.id)" :key="provider.id + '-' + model.id"
            class="model-item-compact p-1.5 rounded-xl cursor-pointer transition-all flex items-center space-x-1.5"
            :class="{
              'model-item-active': currentModelId === model.id
            }" @click.stop="handleSelect(model.id)">
            <div class="w-8 h-8 shrink-0">
              <Avatar :src="getModelAvatarPath(model.modelName, provider.name) || undefined"
                :name="getModelDisplayName(model.modelName)" type="assistant" :round="false" class="w-full h-full" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">
                {{ getModelDisplayName(model.modelName) }}
              </div>
              <div class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <!-- <span class="truncate">{{ provider.name }}</span> -->
                <template v-for="feature in (model.config?.features || [])" :key="feature">
                  <el-icon :size="12">
                    <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                    <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                  </el-icon>
                </template>
              </div>
            </div>
            <el-icon class="favorite-icon cursor-pointer transition-all shrink-0" :size="16"
              @click.stop="handleToggleFavorite(model.id)">
              <Star24Filled v-if="favoriteIds.has(model.id)" class="text-yellow-500" />
              <Star24Regular v-else class="text-gray-400 hover:text-yellow-500" />
            </el-icon>
          </div>
        </div>
      </div>
    </template>
  </CustomPopover>

  <!-- 级联：推理强度列表 -->
  <CustomPopover :show="cascadeMenu.visible && cascadeMenu.type === 'thinking'" @update:show="onCascadeShowChange"
    :width="180" :max-height="300" :position="cascadePosition" @mouseenter="cancelCloseCascade"
    @mouseleave="scheduleCloseCascade">
    <div v-for="effort in thinkingEffortOptions" :key="effort"
      class="te-item flex items-center justify-between px-2 py-1 mb-0.5 last:mb-0 rounded-xl cursor-pointer transition-all text-sm"
      :class="{
        'te-item-active': thinkingEffortValue === effort
      }" @click.stop="$emit('select-thinking-effort', effort)">
      <span>{{ getThinkingEffortLabel(effort) }}</span>
      <span class="text-xs text-gray-400">{{ effort }}</span>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch, reactive } from 'vue'
import { ElIcon } from 'element-plus'
import { WrenchScrewdriver24Regular, LightbulbFilament24Regular, ChevronRight24Regular, Star24Regular, Star24Filled } from '@vicons/fluent'
import CustomPopover from '../../ui/CustomPopover.vue'
import Avatar from '../../ui/Avatar.vue'
import { getModelDisplayName, getModelAvatarPath, getThinkingEffortLabel } from '@/utils/modelUtils'
import { apiService } from '@/services/ApiService'

interface Model {
  id: string
  modelName: string
  providerId: string
  modelType?: string
  description?: string
  config?: {
    inputCapabilities?: string[]
    outputCapabilities?: string[]
    features?: string[]
  }
  isFavorite?: boolean
  thinkingEfforts?: string[]
}

interface Provider {
  id: string
  name: string
  models?: Model[]
}

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  models: Model[]
  providers: Provider[]
  currentModelId: string | null
  thinkingEffortOptions: string[]
  thinkingEffortValue: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [modelId: string]
  'favorite-changed': [modelId: string, isFavorite: boolean]
  'select-thinking-effort': [effort: string]
}>()

const favoriteIds = ref<Set<string>>(new Set())
const currentModelRef = ref<HTMLElement | null>(null)
const thinkingRef = ref<HTMLElement | null>(null)

const cascadeMenu = reactive({
  visible: false,
  type: '' as 'browse' | 'thinking' | '',
})
const cascadePosition = ref<{ left: number; top: number } | null>(null)
let closeTimer: ReturnType<typeof setTimeout> | null = null

const currentModel = computed(() => {
  if (!props.currentModelId) return null
  return props.models.find(m => m.id === props.currentModelId) || null
})

const currentModelProviderName = computed(() => {
  if (!currentModel.value) return ''
  return getModelProviderName(currentModel.value)
})

const favoriteModels = computed(() => {
  return props.models.filter(m => m.isFavorite)
})

const thinkingEffortLabel = computed(() => {
  return getThinkingEffortLabel(props.thinkingEffortValue)
})

const filteredProviders = computed(() => {
  if (!props.models.length || !props.providers.length) return []
  return props.providers.map(provider => ({
    ...provider,
    models: props.models.filter((model: Model) => model.providerId === provider.id),
  })).filter((provider: any) => provider.models.length > 0)
})

function getProviderModels(providerId: string): Model[] {
  const provider = filteredProviders.value.find(p => p.id === providerId)
  return provider ? provider.models : []
}

function getModelProviderName(model: Model): string {
  if (!model || !model.providerId) return ''
  const provider = props.providers.find(p => p.id === model.providerId)
  return provider ? provider.name : ''
}

function handleSelect(modelId: string) {
  emit('select', modelId)
}

async function handleToggleFavorite(modelId: string) {
  try {
    await apiService.toggleModelFavorite(modelId)
    const newIsFavorite = !favoriteIds.value.has(modelId)
    if (newIsFavorite) {
      favoriteIds.value.add(modelId)
    } else {
      favoriteIds.value.delete(modelId)
    }
    emit('favorite-changed', modelId, newIsFavorite)
  } catch (error) {
    console.error('切换收藏状态失败:', error)
  }
}

async function openCascade(type: 'browse' | 'thinking', triggerEl: HTMLElement | null) {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  if (cascadeMenu.visible && cascadeMenu.type === type) return

  // 先算坐标再显示，避免先出现在默认位置再跳变
  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect()
    const menuWidth = type === 'browse' ? 300 : 180
    const menuHeight = type === 'browse' ? 400 : 200
    const gap = 5

    const spaceRight = window.innerWidth - rect.right
    const spaceLeft = rect.left
    const showOnRight = spaceRight >= menuWidth + gap || spaceRight >= spaceLeft

    let left: number
    if (showOnRight) {
      left = rect.right + gap
    } else {
      left = rect.left - menuWidth - gap
    }

    let top = rect.top
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - menuHeight - 8)
    }

    cascadePosition.value = {
      left,
      top,
    }
  }

  cascadeMenu.type = type
  cascadeMenu.visible = true
}

function onMainShowChange(val: boolean) {
  // 级联菜单可见时，阻止主弹窗因外部点击关闭
  if (!val && cascadeMenu.visible) return
  emit('update:visible', val)
}

function onCascadeShowChange(val: boolean) {
  if (!val) {
    cascadeMenu.visible = false
    cascadeMenu.type = ''
  }
}

function scheduleCloseCascade() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    cascadeMenu.visible = false
    cascadeMenu.type = ''
  }, 200)
}

function cancelCloseCascade() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

watch(() => props.visible, (newVal) => {
  if (newVal) {
    favoriteIds.value = new Set(
      props.models.filter(m => m.isFavorite).map(m => m.id)
    )
  } else {
    cascadeMenu.visible = false
    cascadeMenu.type = ''
  }
})
</script>

<style scoped>
.model-panel {
  display: flex;
  flex-direction: column;
}

.section-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-gray);
  padding: 4px 8px;
}

.section-divider {
  height: 1px;
  background: var(--color-surface-border);
  margin: 3px 4px;
}

.current-model-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.current-model-card:hover {
  background: var(--color-sidebar-bg-hover);
}

.model-item-compact:hover {
  background: var(--color-sidebar-bg-hover);
}

.model-item-active {
  background: var(--color-sidebar-bg-active);
}

.te-item:hover {
  background: var(--color-sidebar-bg-hover);
}

.te-item-active {
  background: var(--color-sidebar-bg-active);
}

/* 收藏图标 */
.favorite-icon {
  transition: transform 0.2s ease;
}

.favorite-icon:hover {
  transform: scale(1.1);
}

.favorite-icon svg {
  fill: currentColor !important;
}

.favorite-icon .text-yellow-500 {
  color: #f59e0b !important;
}

.favorite-icon .text-gray-400 {
  color: var(--color-text-gray) !important;
}

.cascade-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  color: var(--color-text);
}

.cascade-trigger:hover {
  background: var(--color-sidebar-bg-hover);
}

.thinking-active-icon {
  color: #10b981;
}

.provider-group {
  margin-bottom: 0.5rem;
}

.provider-name {
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}
</style>
