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
  // ProviderFileStore 索引预热：本模块在 PersistenceModule（迁移脚手架）之后初始化，
  // 此刻迁移导出已完成，扫描成本留在启动期而非首个请求。
  // （对齐 ChatModule/BotGatewayModule/McpServersModule 的域内预热契约；
  //   ProviderBootstrapService 脚手架自持的 store 实例仅服务迁移本身，与 DI 单例无关）
  constructor(private providerStore: ProviderFileStore) {}

  async onModuleInit(): Promise<void> {
    await this.providerStore.initialize();
  }
}
