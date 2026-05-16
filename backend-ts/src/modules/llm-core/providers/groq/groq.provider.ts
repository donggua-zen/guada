import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { OpenAIAdapter } from '../../adapters/openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * Groq 供应商实现
 * 以极致的推理速度著称，提供低延迟的大语言模型 API 服务
 */
@Injectable()
export class GroqProvider implements IModelProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://api.groq.com/openai/v1/';
  
  // 内部持有 OpenAI 适配器实例（不需要私有定制）
  private adapter: OpenAIAdapter;
  
  constructor() {
    this.adapter = new OpenAIAdapter();
  }
  
  /**
   * 获取指定协议的适配器
   */
  getAdapter(protocol: string): IProtocolAdapter | null {
    if (protocol === 'openai') {
      return this.adapter;
    }
    return null;
  }
  
  // Groq 不支持强度控制，主要通过 reasoning_format 控制输出格式
  private defaultThinkingEfforts: string[] = [];
  
  private models: ModelDefinition[] = [];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '以极致的推理速度著称，提供低延迟的大语言模型 API 服务。',
      avatarUrl: 'static/images/providers/groq.svg',
      apiKeyUrl: 'https://console.groq.com/keys',
      protocols: this.protocols,
      defaultApiUrl: this.defaultApiUrl,
    };
  }
  
  /**
   * 获取该供应商支持的模型列表
   */
  getModels(options?: ModelFilterOptions): ModelDefinition[] {
    if (!options) return this.models;
    
    return this.models.filter(model => {
      if (options.modeType && model.modeType !== options.modeType) {
        return false;
      }
      if (options.feature && !model.config.features.includes(options.feature)) {
        return false;
      }
      return true;
    });
  }
  
  /**
   * 获取指定模型的思考强度选项
   * Groq 不支持强度控制
   */
  getModelThinkingEfforts(modelName: string): string[] {
    // Groq 所有模型都不支持推理强度控制
    return this.defaultThinkingEfforts;
  }
}
