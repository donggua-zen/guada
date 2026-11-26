import { computed, ref } from 'vue'
import { apiService } from '@/services/ApiService'
import type { OcrGroupSettings } from '@/types/service'
import {
  getEmbeddingProviders, getEmbeddingSetupStatus, getOcrSetupStatus,
  type KnowledgeProvider, type OcrSetupStatus, type SetupLoadState,
} from '@/utils/knowledgeSetup'

/** Local page state: settings secrets are used to derive status, never cached or persisted. */
export function useKnowledgeSetup() {
  const modelsState = ref<SetupLoadState>('loading')
  const ocrState = ref<SetupLoadState>('loading')
  const providers = ref<KnowledgeProvider[]>([])
  const ocrStatus = ref<OcrSetupStatus>('disabled')
  const ocrProvider = ref('none')
  const embeddingProviders = computed(() => getEmbeddingProviders(providers.value))
  let pending: Promise<void> | null = null

  function refresh() {
    if (pending) return pending
    modelsState.value = 'loading'
    ocrState.value = 'loading'
    pending = Promise.allSettled([
      apiService.fetchAllModels(),
      apiService.fetchGroupSettings<OcrGroupSettings>('ocr'),
    ]).then(([modelsResult, ocrResult]) => {
      const allProviders = modelsResult.status === 'fulfilled' ? modelsResult.value.items ?? [] : []
      if (modelsResult.status === 'fulfilled') {
        // Keep only the metadata required by the knowledge UI, not API keys.
        providers.value = allProviders.map(provider => ({
          id: provider.id, name: provider.name, provider: provider.provider,
          enabled: (provider as KnowledgeProvider).enabled, isActive: provider.isActive,
          typeAvailable: provider.typeAvailable, protocolAvailable: provider.protocolAvailable,
          models: provider.models ?? [], apiKeySet: false,
        }))
        modelsState.value = 'loaded'
      } else {
        modelsState.value = 'error'
      }
      if (ocrResult.status === 'rejected') {
        ocrState.value = 'error'
        return
      }
      const settings = ocrResult.value
      ocrProvider.value = settings.provider || 'none'
      // Provider-key reuse cannot be assessed if the model-service request failed.
      if (settings.provider === 'deepseek' && (settings.deepseek?.useProviderKey ?? true)
        && modelsResult.status === 'rejected') {
        ocrState.value = 'error'
        return
      }
      ocrStatus.value = getOcrSetupStatus(settings, allProviders)
      ocrState.value = 'loaded'
    }).finally(() => { pending = null })
    return pending
  }

  function embeddingStatus(modelId?: string | null) {
    return getEmbeddingSetupStatus(providers.value, modelId)
  }

  return { modelsState, ocrState, ocrStatus, ocrProvider, embeddingProviders, embeddingStatus, refresh }
}
