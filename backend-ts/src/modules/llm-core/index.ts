/**
 * LLM Core 模块公共导出
 */

// 类型定义
export * from './types/provider.types';
export * from './types/llm.types';

// 核心服务
export { AdapterRegistry } from './adapter-registry.service';
export { BundledCatalogService } from './bundled-catalog.service';
export { LLMService } from './llm.service';
export { ProviderContributionCoordinator } from './provider-contribution.coordinator';
export {
  UnsupportedProtocolError,
  ProtocolDisabledError,
} from './provider-errors';
export { PROVIDER_API_VERSION } from './types/provider-plugin.types';
export type {
  ProtocolDescriptor,
  ProviderTypeCard,
  ProviderPackManifestFields,
} from './types/provider-plugin.types';

// 模块
export { LlmCoreModule } from './providers.module';

// 工具函数
export * from './utils/model-config.helper';
