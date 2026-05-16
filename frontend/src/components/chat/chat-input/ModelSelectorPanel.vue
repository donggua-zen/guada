<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="320" :max-height="400" :anchor-el="anchorEl"
    popper-class="model-popover compact-popover">
    <div class="popover-content">
      <div class="mb-3">
        <el-input v-model="searchText" placeholder="搜索模型..." clearable size="small">
          <template #prefix>
            <el-icon>
              <Search12Regular />
            </el-icon>
          </template>
        </el-input>
      </div>
      <div class="model-list min-h-0 overflow-hidden">
        <ScrollContainer class="w-full h-full min-h-0" style="max-height: 320px;">
          <div class="space-y-2 pb-4 w-full">
            <template v-for="provider in filteredProviders" :key="provider.id">
              <div class="provider-group">
                <!-- 非收藏分组才显示供应商名称 -->
                <div v-if="!provider.isFavoriteGroup"
                  class="provider-name text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                  {{ provider.name }}
                </div>
                <div class="provider-models space-y-1">
                  <div v-for="model in getProviderModels(provider.id)" :key="model.id"
                    class="model-item-compact p-2 rounded cursor-pointer transition-all flex items-center gap-2" :class="{
                      'bg-pink-50 dark:bg-pink-900/20': currentModelId === model.id,
                      'hover:bg-gray-50 dark:hover:bg-gray-800/50': currentModelId !== model.id
                    }" @click="handleSelect(model.id)">
                    <!-- 模型头像 -->
                    <div class="w-8 h-8 shrink-0">
                      <Avatar :src="getModelAvatarPath(model.modelName, provider.name) || undefined"
                        :name="getModelDisplayName(model.modelName)" type="assistant" :round="false"
                        class="w-full h-full" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate mb-1">
                        {{ getModelDisplayName(model.modelName) }}
                      </div>
                      <!-- 特性图标组 -->
                      <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <!-- 收藏分组中显示供应商名称 -->
                        <span v-if="provider.isFavoriteGroup" class="pr-1.5 py-0.5 font-medium text-[10px]">
                          {{ getModelProviderName(model) }}
                        </span>

                        <!-- 输入/输出能力箭头组 -->
                        <div
                          v-if="model.modelType === 'text' && (model.config?.inputCapabilities || model.config?.outputCapabilities)"
                          class="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                          <template v-for="cap in (model.config?.inputCapabilities || ['text'])" :key="'in-' + cap">
                            <el-icon :size="13">
                              <TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else />
                            </el-icon>
                          </template>
                          <el-icon :size="9" class="text-gray-300">
                            <ArrowRightTwotone />
                          </el-icon>
                          <template v-for="cap in (model.config?.outputCapabilities || ['text'])" :key="'out-' + cap">
                            <el-icon :size="13">
                              <TextT24Regular v-if="cap === 'text'" />
                              <Image24Regular v-else />
                            </el-icon>
                          </template>
                        </div>

                        <!-- 高级功能图标 -->
                        <template v-for="feature in (model.config?.features || [])" :key="feature">
                          <el-tooltip :content="getFeatureLabel(feature)" placement="top">
                            <el-icon class="hover:text-primary transition-colors" :size="13">
                              <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                              <LightbulbFilament24Regular v-else-if="feature === 'thinking'" />
                            </el-icon>
                          </el-tooltip>
                        </template>
                      </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <!-- 收藏按钮 -->
                      <el-icon class="favorite-icon cursor-pointer transition-all" :size="16"
                        @click.stop="handleToggleFavorite(model.id)">
                        <Star24Filled v-if="favoriteIds.has(model.id)" class="text-yellow-500" />
                        <Star24Regular v-else class="text-gray-400 hover:text-yellow-500" />
                      </el-icon>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <div v-if="filteredModels.length === 0" class="text-center py-6 text-gray-400">
              <el-icon size="32" class="mb-1">
                <Search12Regular />
              </el-icon>
              <p class="text-xs">未找到匹配的模型</p>
            </div>
          </div>
        </ScrollContainer>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElInput, ElIcon, ElTooltip } from 'element-plus'
import { Search12Regular, Star24Regular, Star24Filled, TextT24Regular, Image24Regular, WrenchScrewdriver24Regular, LightbulbFilament24Regular } from '@vicons/fluent'
import { ArrowRightTwotone } from '@vicons/material'
import ScrollContainer from '../../ui/ScrollContainer.vue'
import CustomPopover from '../../ui/CustomPopover.vue'
import Avatar from '../../ui/Avatar.vue'
import { getModelDisplayName, getModelAvatarPath, getModelThinkingEfforts } from '@/utils/modelUtils'
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
}

interface Provider {
  id: string
  name: string
  models?: Model[]
  isFavoriteGroup?: boolean
}

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  models: Model[]
  providers: Provider[]
  currentModelId: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [modelId: string]  // 只传递模型 ID
  'favorite-changed': []
}>()

const searchText = ref('')
const favoriteIds = ref<Set<string>>(new Set())

// 过滤后的模型列表（支持搜索）
const filteredModels = computed(() => {
  if (!searchText.value) return props.models
  const searchTextLower = searchText.value.toLowerCase()
  return props.models.filter(model =>
    model.modelName?.toLowerCase().includes(searchTextLower) ||
    model.description?.toLowerCase().includes(searchTextLower)
  )
})

// 按供应商分组的过滤后模型列表
const filteredProviders = computed(() => {
  if (!props.models.length || !props.providers.length) return []

  const filtered = filteredModels.value

  // 分离收藏和未收藏的模型
  const favoritedModels = filtered.filter((model: Model) => favoriteIds.value.has(model.id))

  const result: any[] = []

  // 如果有收藏的模型,创建一个统一的"收藏"分组
  if (favoritedModels.length > 0) {
    result.push({
      id: 'favorites',
      name: '收藏',
      models: favoritedModels,
      isFavoriteGroup: true
    })
  }

  // 所有模型都按供应商分组显示(包括收藏的)
  const providerGroups = props.providers.map(provider => ({
    ...provider,
    models: filtered.filter((model: Model) => model.providerId === provider.id),
    isFavoriteGroup: false
  })).filter((provider: any) => provider.models.length > 0)

  result.push(...providerGroups)

  return result
})

// 获取指定供应商的模型列表
function getProviderModels(providerId: string): Model[] {
  const provider = filteredProviders.value.find(p => p.id === providerId)
  return provider ? provider.models : []
}

// 获取模型的供应商名称
function getModelProviderName(model: Model): string {
  if (!model || !model.providerId) return ''
  const provider = props.providers.find(p => p.id === model.providerId)
  return provider ? provider.name : ''
}

// 获取特性标签
function getFeatureLabel(type: string): string {
  switch (type) {
    case 'tools': return '工具调用'
    case 'thinking': return '混合思考'
    default: return type
  }
}

// 处理选择模型
function handleSelect(modelId: string) {
  // 只 emit 模型 ID，不关心其他配置
  emit('select', modelId)
  emit('update:visible', false)
}

// 处理切换收藏状态
async function handleToggleFavorite(modelId: string) {
  try {
    await apiService.toggleModelFavorite(modelId)

    // 更新本地收藏状态
    if (favoriteIds.value.has(modelId)) {
      favoriteIds.value.delete(modelId)
    } else {
      favoriteIds.value.add(modelId)
    }

    // 通知父组件刷新
    emit('favorite-changed')
  } catch (error) {
    console.error('切换收藏状态失败:', error)
  }
}

// 监听 visible 变化，初始化状态
watch(() => props.visible, (newVal) => {
  if (newVal) {
    searchText.value = ''
    // 初始化收藏状态
    favoriteIds.value = new Set(
      props.models.filter(m => m.isFavorite).map(m => m.id)
    )
  }
})
</script>

<style scoped>
/* 模型列表项 - 无边框紧凑样式 */
.model-item-compact {
  transition: all 0.15s ease;
}

.model-item-compact:hover {
  background-color: var(--el-fill-color-light, #f5f7fa);
}

.dark .model-item-compact:hover {
  background-color: oklch(30% 0.03 250);
}

/* 收藏按钮悬停效果 */
.favorite-icon {
  transition: all 0.2s ease;
}

.favorite-icon:hover {
  transform: scale(1.1);
}

/* 收藏图标颜色强制应用 */
.favorite-icon svg {
  fill: currentColor !important;
}

.favorite-icon .text-yellow-500 {
  color: #f59e0b !important;
}

.favorite-icon .text-gray-400 {
  color: #9ca3af !important;
}

.provider-group {
  margin-bottom: 1rem;
}

.provider-name {
  color: var(--el-text-color-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

/* 收藏分组特殊样式 */
.provider-group:first-child .provider-name {
  color: #f59e0b;
  font-weight: 600;
}

.model-list {
  padding-bottom: 0;
}
</style>
