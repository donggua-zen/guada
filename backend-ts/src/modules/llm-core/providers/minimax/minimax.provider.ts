import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createTextModel, ConfigFragments } from '../../utils/model-config.helper';
import { MinimaxOpenAIAdapter } from './minimax-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * MiniMax 供应商实现
 * 专注于通用人工智能，提供高质量的语言模型和语音合成服务
 */
@Injectable()
export class MinimaxProvider implements IModelProvider {
  readonly id = 'minimax';
  readonly name = 'MiniMax';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://api.minimax.chat/v1/';
  
  // 内部持有 MiniMax 专用的适配器实例
  private adapter: MinimaxOpenAIAdapter;
  
  constructor() {
    this.adapter = new MinimaxOpenAIAdapter();
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
  
  // MiniMax 不支持推理强度控制
  private defaultThinkingEfforts: string[] = [];
  
  private models: ModelDefinition[] = [
    createTextModel('MiniMax-M2.5', ConfigFragments.ContextWindow._205K, ConfigFragments.MaxOutput._131K),
    createTextModel('MiniMax-M2.5-highspeed', ConfigFragments.ContextWindow._205K, ConfigFragments.MaxOutput._131K),
    createTextModel('MiniMax-M2.1', ConfigFragments.ContextWindow._205K, ConfigFragments.MaxOutput._131K),
    createTextModel('MiniMax-M2', ConfigFragments.ContextWindow._197K, ConfigFragments.MaxOutput._128K),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '专注于通用人工智能，提供高质量的语言模型和语音合成服务。',
      avatarUrl: 'static/images/providers/minimax.svg',
      apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
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
   * MiniMax 不支持推理强度控制
   */
  getModelThinkingEfforts(modelName: string): string[] {
    // MiniMax 所有模型都不支持推理强度控制
    return this.defaultThinkingEfforts;
  }
}
