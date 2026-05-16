import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { OpenAIAdapter } from '../../adapters/openai.adapter';
import { OpenAIResponseAdapter } from '../../adapters/openai-response.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * 自定义供应商实现
 * 支持 openai 和 openai-response 协议，直接返回基础适配器
 * gemini 协议会转发到 Google 供应商处理
 * 用于用户自定义配置的通用场景
 */
@Injectable()
export class CustomProvider implements IModelProvider {
  readonly id = 'custom';
  readonly name = 'Custom';
  readonly protocols = ['openai', 'openai-response'];
  readonly defaultApiUrl = '';

  // 内部持有基础适配器实例（仅 OpenAI 协议）
  private openAIAdapter: OpenAIAdapter;
  private openAIResponseAdapter: OpenAIResponseAdapter;

  constructor() {
    this.openAIAdapter = new OpenAIAdapter();
    this.openAIResponseAdapter = new OpenAIResponseAdapter();
  }

  /**
   * 获取指定协议的适配器
   * OpenAI/OpenAI-Response: 直接返回基础适配器
   * Gemini: 返回 null，由调用方转发到 Google 供应商
   */
  getAdapter(protocol: string): IProtocolAdapter | null {
    switch (protocol) {
      case 'openai':
        return this.openAIAdapter;
      case 'openai-response':
        return this.openAIResponseAdapter;
      default:
        return null;
    }
  }

  // 自定义供应商不提供默认模型列表
  private models: ModelDefinition[] = [];

  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '自定义供应商，支持所有协议，直接使用基础适配器。',
      avatarUrl: '',
      apiKeyUrl: '',
      protocols: this.protocols,
      defaultApiUrl: this.defaultApiUrl,
    };
  }

  /**
   * 获取该供应商支持的模型列表
   * 自定义供应商不维护默认模型列表
   */
  getModels(options?: ModelFilterOptions): ModelDefinition[] {
    return [];
  }

  /**
   * 获取指定模型的思考强度选项
   * 自定义供应商不提供默认配置，由调用方决定
   */
  getModelThinkingEfforts(modelName: string): string[] {
    // 自定义供应商不提供默认思考强度配置
    // 具体支持哪些强度由用户自行配置
    return [];
  }
}
