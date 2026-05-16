import { Injectable, Logger } from "@nestjs/common";
import { ProviderHub } from "./provider-hub.service";
import { IProtocolAdapter } from "./adapters/base.adapter";
import { LLMCompletionParams } from "./types/llm.types";

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(
    private providerHub: ProviderHub,
  ) {}

  /**
   * 统一的补全执行方法（支持流式和非流式）
   */
  completions(
    params: LLMCompletionParams,
  ): Promise<any> | AsyncGenerator<any, void, unknown> {
    const providerId = params.providerConfig?.provider;
    const protocol = params.providerConfig?.protocol || "openai";
    
    if (!providerId) {
      throw new Error("Provider ID is required in providerConfig");
    }
    
    // 通过 ProviderHub 获取供应商
    let provider = this.providerHub.getProvider(providerId);
    
    // 通过供应商的 getAdapter 方法获取适配器
    let adapter = provider.getAdapter(protocol);
    
    // 如果 CustomProvider 不支持该协议（如 gemini），转发到对应的官方供应商
    if (!adapter && providerId === 'custom') {
      this.logger.log(`Custom provider doesn't support ${protocol}, forwarding to official provider`);
      
      // gemini 协议转发到 Google 供应商
      if (protocol === 'gemini') {
        provider = this.providerHub.getProvider('google');
        adapter = provider.getAdapter(protocol);
      }
    }
    
    this.logger.log(`Using ${protocol} adapter from provider ${provider.id}`);
    
    if (!adapter) {
      throw new Error(`Provider ${providerId} does not support protocol: ${protocol}`);
    }

    const isStream = params.stream === true;
    const iterator = adapter.chatCompletion({
      ...params
    });

    if (isStream) {
      return iterator as AsyncGenerator<any, void, unknown>;
    } else {
      return (async () => {
        const result = await (iterator as AsyncIterator<any>).next();
        return result.value;
      })();
    }
  }
}
