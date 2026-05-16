import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createMultimodalModel, ConfigFragments } from '../../utils/model-config.helper';
import { MoonshotOpenAIAdapter } from './moonshot-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * Moonshot AI 供应商实现
 * 月之暗面科技，Kimi 智能助手背后的技术提供方，擅长长文本处理
 */
@Injectable()
export class MoonshotProvider implements IModelProvider {
  readonly id = 'moonshot';
  readonly name = 'Moonshot AI';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://api.moonshot.cn/v1/';
  
  // 内部持有 Moonshot 专用的适配器实例
  private adapter: MoonshotOpenAIAdapter;
  
  constructor() {
    this.adapter = new MoonshotOpenAIAdapter();
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
  
  // Moonshot 仅支持开关模式
  private defaultThinkingEfforts: string[] = ['off', 'on'];
  
  private models: ModelDefinition[] = [
    createMultimodalModel('kimi-k2.5', ConfigFragments.ContextWindow._256K),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '月之暗面科技，Kimi 智能助手背后的技术提供方，擅长长文本处理。',
      avatarUrl: 'static/images/providers/moonshotai_new.png',
      apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
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
   * Moonshot 仅支持开关模式
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();
    
    // Embedding 模型不支持思考
    if (lowerName.includes('embedding') || lowerName.includes('embed')) {
      return [];
    }
    
    // 所有其他模型都支持开关模式
    return this.defaultThinkingEfforts;
  }
}
