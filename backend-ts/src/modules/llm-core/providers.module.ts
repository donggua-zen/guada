import { Module, Global, OnModuleInit } from '@nestjs/common';
import { ProviderHub } from './provider-hub.service';
import { LLMService } from './llm.service';
import { CustomProvider } from './providers/custom/custom.provider';
import { SiliconFlowProvider } from './providers/siliconflow/siliconflow.provider';
import { VolcEngineProvider } from './providers/volcengine/volcengine.provider';
import { AliyunBailianProvider } from './providers/aliyun-bailian/aliyun-bailian.provider';
import { DeepSeekProvider } from './providers/deepseek/deepseek.provider';
import { OpenAIProvider } from './providers/openai/openai.provider';
import { OpenAIResponseProvider } from './providers/openai-response/openai-response.provider';
import { MinimaxProvider } from './providers/minimax/minimax.provider';
import { BaiduQianfanProvider } from './providers/baidu-qianfan/baidu-qianfan.provider';
import { ZhipuProvider } from './providers/zhipu/zhipu.provider';
import { MoonshotProvider } from './providers/moonshot/moonshot.provider';
import { AzureOpenAIProvider } from './providers/azure-openai/azure-openai.provider';
import { GroqProvider } from './providers/groq/groq.provider';
import { GoogleProvider } from './providers/google/google.provider';

/**
 * LLM 核心模块
 * 提供统一的供应商注册、发现和管理功能，以及 LLM 调用抽象服务
 */
@Global()
@Module({
  providers: [
    ProviderHub,
    LLMService,
    CustomProvider,
    SiliconFlowProvider,
    VolcEngineProvider,
    DeepSeekProvider,
    AliyunBailianProvider,
    OpenAIProvider,
    OpenAIResponseProvider,
    MinimaxProvider,
    BaiduQianfanProvider,
    ZhipuProvider,
    MoonshotProvider,
    AzureOpenAIProvider,
    GroqProvider,
    GoogleProvider,
  ],
  exports: [ProviderHub, LLMService],
})
export class LlmCoreModule implements OnModuleInit {
  constructor(
    private readonly providerHub: ProviderHub,
    private readonly customProvider: CustomProvider,
    private readonly siliconFlowProvider: SiliconFlowProvider,
    private readonly volcEngineProvider: VolcEngineProvider,
    private readonly deepSeekProvider: DeepSeekProvider,
    private readonly aliyunBailianProvider: AliyunBailianProvider,
    private readonly openAIProvider: OpenAIProvider,
    private readonly openAIResponseProvider: OpenAIResponseProvider,
    private readonly minimaxProvider: MinimaxProvider,
    private readonly baiduQianfanProvider: BaiduQianfanProvider,
    private readonly zhipuProvider: ZhipuProvider,
    private readonly moonshotProvider: MoonshotProvider,
    private readonly azureOpenAIProvider: AzureOpenAIProvider,
    private readonly groqProvider: GroqProvider,
    private readonly googleProvider: GoogleProvider,
  ) { }

  onModuleInit() {
    // 自动注册自定义供应商
    this.providerHub.register(this.customProvider);
    this.providerHub.register(this.siliconFlowProvider);
    this.providerHub.register(this.volcEngineProvider);
    this.providerHub.register(this.deepSeekProvider);
    this.providerHub.register(this.aliyunBailianProvider);
    this.providerHub.register(this.openAIProvider);
    this.providerHub.register(this.openAIResponseProvider);
    this.providerHub.register(this.minimaxProvider);
    this.providerHub.register(this.baiduQianfanProvider);
    this.providerHub.register(this.zhipuProvider);
    this.providerHub.register(this.moonshotProvider);
    this.providerHub.register(this.azureOpenAIProvider);
    this.providerHub.register(this.groqProvider);
    this.providerHub.register(this.googleProvider);
  }
}
