import { Module, Global } from '@nestjs/common';
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
export class LlmCoreModule {}
