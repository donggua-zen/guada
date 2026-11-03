import { ref } from 'vue'
import { apiService } from '@/services/ApiService'
import type { Model, ModelProvider } from '@/types/api'

/**
 * 模型目录（text + 启用中）的共享缓存。
 *
 * 定时任务编辑器和聊天输入框各自需要同一份「可用模型 -> 供应商」视图；
 * 这里做进程内缓存，避免每次打开编辑页都重新拉取。
 *
 * 新鲜度：挂载时 TTL 重校验 + 写路径显式强刷（ensureLoaded(true)），
 * 缓存从不主动过期，而是被这两种路径失效——TTL 内挂载零请求保持去重收益，
 * 过期/强刷时后台重拉，旧数据继续可用、拉到后响应式更新（UI 无感）。
 */
const CATALOG_TTL_MS = 60_000

const models = ref<Model[]>([])
const providers = ref<ModelProvider[]>([])
let loadPromise: Promise<void> | null = null
let loadedAt = 0
/** 在飞拉取的发起时刻：并发挂载去重的复用窗口以它计时 */
let loadStartedAt = 0
/** 拉取代际：强刷取代在飞请求后，晚完成的旧请求不得覆盖新数据与新鲜度 */
let loadGeneration = 0

async function fetchCatalog(): Promise<{ models: Model[]; providers: ModelProvider[] }> {
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

  return { models: nextModels, providers: nextProviders }
}

function startLoad(): Promise<void> {
  const generation = ++loadGeneration
  const request = fetchCatalog()
    .then((catalog) => {
      // 只允许最新一代拉取落地；被强刷取代的旧请求晚完成时整体丢弃
      if (generation !== loadGeneration) return
      models.value = catalog.models
      providers.value = catalog.providers
      loadedAt = Date.now()
    })
    .finally(() => {
      // 完成/失败都清句柄：过期重拉才能发起新请求，失败也不锁死缓存
      if (loadPromise === request) loadPromise = null
    })
  loadPromise = request
  loadStartedAt = Date.now()
  return request
}

export function useModelCatalog() {
  async function ensureLoaded(force = false): Promise<void> {
    const now = Date.now()
    if (!force) {
      // 在飞请求且发起未超 TTL → 复用（并发挂载只发一次请求）
      if (loadPromise && now - loadStartedAt < CATALOG_TTL_MS) {
        return loadPromise
      }
      // 已有 TTL 内的新鲜数据 → 零请求返回
      if (!loadPromise && now - loadedAt < CATALOG_TTL_MS) {
        return
      }
    }
    // 强刷 / 从未加载 / 已过期 → 发起新拉取（旧数据保留，拉到后响应式更新）
    return startLoad()
  }

  return { models, providers, ensureLoaded }
}

/** 清空共享缓存并丢弃在飞拉取（测试隔离用；生产代码请走 ensureLoaded 失效路径） */
export function resetCatalog(): void {
  loadGeneration += 1
  models.value = []
  providers.value = []
  loadPromise = null
  loadedAt = 0
}
