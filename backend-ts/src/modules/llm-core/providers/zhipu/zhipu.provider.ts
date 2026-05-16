import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createTextModel, ConfigFragments } from '../../utils/model-config.helper';
import { OpenAIAdapter } from '../../adapters/openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * 智谱 AI 供应商实现
 * 源自清华技术背景，提供 GLM 系列大语言模型，支持强大的推理与代码能力
 */
@Injectable()
export class ZhipuProvider implements IModelProvider {
  readonly id = 'zhipu';
  readonly name = '智谱 AI';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://open.bigmodel.cn/api/paas/v4/';
  
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
  
  // 智谱 AI 仅支持开关模式
  private defaultThinkingEfforts: string[] = ['off', 'on'];
  
  private models: ModelDefinition[] = [
    createTextModel('GLM-5', ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
    createTextModel('GLM-5-Turbo', ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
    createTextModel('GLM-4-Plus', ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
    createTextModel('GLM-4.7', ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
    createTextModel('GLM-4.7-FlashX', ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
    createTextModel('GLM-4.6', ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
    createTextModel('GLM-4.5', ConfigFragments.ContextWindow._128K, ConfigFragments.MaxOutput._96K),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '源自清华技术背景，提供 GLM 系列大语言模型，支持强大的推理与代码能力。',
      avatarUrl: 'static/images/providers/zhipu.svg',
      apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
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
   * 智谱 AI 仅支持开关模式
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
