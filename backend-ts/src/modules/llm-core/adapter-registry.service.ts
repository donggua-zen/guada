import { Injectable } from '@nestjs/common';
import { IProtocolAdapter } from './adapters/base.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { OpenAIResponseAdapter } from './adapters/openai-response.adapter';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { MockAdapter } from './adapters/mock.adapter';

/**
 * 协议适配器注册表
 *
 * 历史上协议实例散落在 17 个 provider 类内部（每个类持有专属 adapter 单例），
 * 供应商配置文件化后 provider 类退役，适配器按 wire 协议集中注册。
 * Provider 差异（thinking 拼法等）经 providerConfig.thinking 传入适配器，
 * 不再依赖子类继承（原 10 个专属 adapter 已删除）。
 *
 * 生命周期：单例协议实例，与应用同生命周期；不可变注册（协议词表固定）。
 */
@Injectable()
export class AdapterRegistry {
  private readonly adapters = new Map<string, IProtocolAdapter>();

  constructor(
    openai: OpenAIAdapter,
    openaiResponse: OpenAIResponseAdapter,
    anthropic: AnthropicAdapter,
    gemini: GeminiAdapter,
    mock: MockAdapter,
  ) {
    for (const adapter of [openai, openaiResponse, anthropic, gemini, mock]) {
      this.adapters.set(adapter.protocol, adapter);
    }
  }

  /** 按 wire 协议取适配器；未注册协议返回 undefined */
  getAdapter(protocol: string): IProtocolAdapter | undefined {
    return this.adapters.get(protocol);
  }

  hasAdapter(protocol: string): boolean {
    return this.adapters.has(protocol);
  }

  /** 全部已注册协议名（供管理面校验与展示） */
  listProtocols(): string[] {
    return Array.from(this.adapters.keys());
  }
}
