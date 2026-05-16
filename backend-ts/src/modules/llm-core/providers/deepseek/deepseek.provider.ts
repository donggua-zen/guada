import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createTextModel, ConfigFragments } from '../../utils/model-config.helper';
import { DeepSeekOpenAIAdapter } from './deepseek-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * DeepSeek 供应商实现
 * 深度求索，以高性价比和强大的代码生成能力著称，支持深度思考模式
 */
@Injectable()
export class DeepSeekProvider implements IModelProvider {
  readonly id = 'deepseek';
  readonly name = 'DeepSeek';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://api.deepseek.com/v1/';
  
  // 内部持有 DeepSeek 专用的适配器实例
  private adapter: DeepSeekOpenAIAdapter;
  
  constructor() {
    this.adapter = new DeepSeekOpenAIAdapter();
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
  
  // DeepSeek 支持 off, high 和 max 三个强度级别
  private defaultThinkingEfforts: string[] = ['off', 'high', 'max'];
  
  private models: ModelDefinition[] = [
    createTextModel(
      'deepseek-v4-flash',
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._384K
    ),
    createTextModel(
      'deepseek-v4-pro',
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._384K
    ),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '深度求索，以高性价比和强大的代码生成能力著称，支持深度思考模式。',
      avatarUrl: 'static/images/providers/deepseek.svg',
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
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
   * DeepSeek 支持 off, high 和 max 三个强度级别
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();
    
    // Embedding 模型不支持思考
    if (lowerName.includes('embedding') || lowerName.includes('embed')) {
      return [];
    }
    
    // 所有其他模型都支持 off, high 和 max
    return this.defaultThinkingEfforts;
  }
}
