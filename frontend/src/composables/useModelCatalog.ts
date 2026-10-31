import { ref } from 'vue'
import { apiService } from '@/services/ApiService'
import type { Model, ModelProvider } from '@/types/api'

/**
 * 模型目录（text + 启用中）的共享缓存。
 *
 * 定时任务编辑器和聊天输入框各自需要同一份「可用模型 -> 供应商」视图；
 * 这里做进程内缓存，避免每次打开编辑页都重新拉取。
 */
const models = ref<Model[]>([])
const providers = ref<ModelProvider[]>([])
let loadPromise: Promise<void> | null = null

async function loadCatalog(): Promise<void> {
  const response = await apiService.fetchModels()
  const nextModels: Model[] = []
  const nextProviders: ModelProvider[] = []

  for (const provider of response.items || []) {
    const textModels = (provider.models || []).filter(
      (model) => model.modelType === 'text' && model.isActive,
    )
    if (textModels.length === 0) continue

    nextModels.push(...textModels)
    const { models: _nested, ...rest } = provider
    nextProviders.push(rest as ModelProvider)
  }

  models.value = nextModels
  providers.value = nextProviders
}

export function useModelCatalog() {
  async function ensureLoaded(force = false): Promise<void> {
    if (!force && loadPromise) return loadPromise

    loadPromise = loadCatalog().catch((error) => {
      // 失败后允许下次重试，避免一次网络抖动把缓存永久锁死
      loadPromise = null
      throw error
    })
    return loadPromise
  }

  return { models, providers, ensureLoaded }
}
