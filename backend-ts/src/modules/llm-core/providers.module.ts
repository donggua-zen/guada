import { Module, Global, OnModuleInit } from '@nestjs/common';
import { AdapterRegistry } from './adapter-registry.service';
import { BundledCatalogService } from './bundled-catalog.service';
import { ProviderFileStore } from './provider-file.store';
import { ModelCapabilityService } from './model-capability.service';
import { LLMService } from './llm.service';
import { SettingsModule } from '../settings/settings.module';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { OpenAIResponseAdapter } from './adapters/openai-response.adapter';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { MockAdapter } from './adapters/mock.adapter';

/**
 * LLM 核心模块
 *
 * 供应商配置文件化后（providers/*.yaml，供应商就是数据），本模块只保留
 * 代码层职责：wire 协议适配器（AdapterRegistry 单例，thinking 差异经
 * thinkingStyle 枚举收敛）、bundled 类型目录（BundledCatalogService，数据）、
 * LLM 调用服务。实例与模型的权威来源是 ProviderFileStore +
 * bundled-providers/*.yaml。
 */
@Global()
@Module({
  imports: [SettingsModule],
  providers: [
    OpenAIAdapter,
    OpenAIResponseAdapter,
    AnthropicAdapter,
    GeminiAdapter,
    MockAdapter,
    AdapterRegistry,
    BundledCatalogService,
    LLMService,
    ProviderFileStore,
    ModelCapabilityService,
  ],
  exports: [AdapterRegistry, BundledCatalogService, LLMService, ProviderFileStore, ModelCapabilityService],
})
export class LlmCoreModule implements OnModuleInit {
  // ProviderFileStore 索引预热。
  // ⚠️ 本模块在 app.module.ts 中排在 PersistenceModule **之前**（@Global 基座），
  // 且 Nest 的模块钩子跨模块串行 await——所以 store 内部**不阻塞**等迁移门控：
  // 先按磁盘现状预热，门控（providers 域）放行后再扫一次把迁移导出的实例纳入，
  // 详情见 ProviderFileStore.doInitialize。预热成本仍留在启动期而非首个请求。
  constructor(private providerStore: ProviderFileStore) {}

  async onModuleInit(): Promise<void> {
    await this.providerStore.initialize();
  }
}
