import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createMultimodalModel, ConfigFragments } from '../../utils/model-config.helper';
import { MockAdapter } from '../../adapters/mock.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * Mock 供应商 — 用于测试超时重试、429 限流、网络错误等异常场景
 *
 * 内置测试模型：
 * - mock-normal: 正常流式输出
 * - mock-normal-slow: 慢速流式输出（100ms/char）
 * - mock-timeout: 服务器挂起不响应（触发 idle timeout → 重试）
 * - mock-429: 返回 429 限流错误（测试限流重试）
 * - mock-network-error: 网络连接失败（测试网络错误重试）
 * - mock-error-500: 返回 500 服务器错误
 */
@Injectable()
export class MockProvider implements IModelProvider {
  readonly id = 'mock';
  readonly name = '测试供应商';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'http://localhost:0';

  private adapter: MockAdapter;

  constructor() {
    this.adapter = new MockAdapter();
  }

  getAdapter(protocol: string): IProtocolAdapter | null {
    if (protocol === 'openai') {
      return this.adapter;
    }
    return null;
  }

  private models: ModelDefinition[] = [
    createMultimodalModel('mock-normal', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    createMultimodalModel('mock-normal-slow', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    createMultimodalModel('mock-timeout', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    createMultimodalModel('mock-429', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    createMultimodalModel('mock-network-error', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    createMultimodalModel('mock-error-500', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
  ];

  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '用于测试超时重试、429 限流、网络错误等异常场景的虚拟供应商。',
      avatarUrl: 'mock.svg',
      protocols: this.protocols,
      defaultApiUrl: this.defaultApiUrl,
    };
  }

  getModels(options?: ModelFilterOptions): ModelDefinition[] {
    if (!options) return this.models;
    return this.models.filter(model => {
      if (options.modeType && model.modeType !== options.modeType) return false;
      if (options.feature && !model.config.features.includes(options.feature)) return false;
      return true;
    });
  }

  getModelThinkingEfforts(_modelName: string): string[] {
    return [];
  }
}
