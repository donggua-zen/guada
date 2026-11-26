import type { Model, ModelProvider } from '@/types/api'
import type { OcrGroupSettings } from '@/types/service'

export type SetupLoadState = 'loading' | 'loaded' | 'error'
export type EmbeddingSetupStatus = 'configured' | 'missing' | 'unavailable'
export type OcrSetupStatus = 'configured' | 'disabled' | 'incomplete'
export type KnowledgeProvider = ModelProvider & { enabled?: boolean }

/** Configuration checks only; no network availability or credential validity is implied. */
export function isKnowledgeProviderEnabled(provider: KnowledgeProvider): boolean {
  return provider.enabled !== false && provider.isActive !== false
    && provider.typeAvailable !== false && provider.protocolAvailable !== false
}

export function getEmbeddingProviders(providers: KnowledgeProvider[]) {
  return providers.filter(isKnowledgeProviderEnabled).map(provider => ({
    id: provider.id,
    name: provider.name,
    models: (provider.models ?? []).filter(model => model.modelType === 'embedding' && model.isActive !== false),
  })).filter(provider => provider.models.length > 0)
}

export function getEmbeddingSetupStatus(
  providers: KnowledgeProvider[],
  modelId?: string | null,
): { status: EmbeddingSetupStatus; model?: Model; providerId?: string } {
  const available = getEmbeddingProviders(providers)
  if (!modelId) return { status: available.length ? 'configured' : 'missing' }
  const provider = providers.find(item => item.models?.some(model => model.id === modelId))
  const model = provider?.models?.find(item => item.id === modelId)
  const configured = available.some(item => item.models.some(model => model.id === modelId))
  return { status: configured ? 'configured' : 'unavailable', model, providerId: provider?.id }
}

export function getOcrSetupStatus(settings: OcrGroupSettings, providers: KnowledgeProvider[]): OcrSetupStatus {
  const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  switch (settings.provider) {
    case undefined:
    case '':
    case 'none':
      return 'disabled'
    case 'umi':
      return settings.umiPort != null && (!Number.isInteger(settings.umiPort) || settings.umiPort < 1 || settings.umiPort > 65535)
        ? 'incomplete' : 'configured'
    case 'baidu':
      return hasText(settings.baiduApiKey) && hasText(settings.baiduSecretKey) ? 'configured' : 'incomplete'
    case 'deepseek': {
      // Match the backend: an enabled provider is preferred, but any matching key can be reused.
      const hasKey = (settings.deepseek?.useProviderKey ?? true)
        ? providers.some(provider => provider.provider === 'deepseek' && (hasText(provider.apiKey) || provider.apiKeySet === true))
        : hasText(settings.deepseek?.apiKey)
      return hasKey ? 'configured' : 'incomplete'
    }
    default:
      return 'incomplete'
  }
}

export function getOcrFileRequirements(names: string[]) {
  return {
    hasImages: names.some(name => /\.(png|jpe?g|bmp)$/i.test(name)),
    hasPdf: names.some(name => /\.pdf$/i.test(name)),
    hasOtherFiles: names.some(name => !/\.(png|jpe?g|bmp|pdf)$/i.test(name)),
  }
}

export function getKnowledgeSettingsLocation(tab: 'providers' | 'ocr', providerId?: string) {
  return {
    path: `/setting/${tab}`,
    query: {
      source: 'knowledge-base',
      ...(tab === 'providers' ? { modelType: 'embedding', ...(providerId ? { providerId } : {}) } : {}),
    },
  }
}
