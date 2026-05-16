import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { BaiduQianfanOpenAIAdapter } from './baidu-qianfan-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * 百度智能云千帆供应商实现
 * 百度千帆大模型平台，提供文心一言系列模型及完整的 AI 开发生态
 */
@Injectable()
export class BaiduQianfanProvider implements IModelProvider {
  readonly id = 'baidu-qianfan';
  readonly name = '百度智能云';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://qianfan.baidubce.com/v2/';
  
  // 内部持有百度千帆专用的适配器实例
  private adapter: BaiduQianfanOpenAIAdapter;
  
  constructor() {
    this.adapter = new BaiduQianfanOpenAIAdapter();
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
  
  // 百度千帆仅支持开关模式
  private defaultThinkingEfforts: string[] = ['off', 'on'];
  
  private models: ModelDefinition[] = [];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '百度千帆大模型平台，提供文心一言系列模型及完整的 AI 开发生态。',
      avatarUrl: 'static/images/providers/baidu-qianfan.svg',
      apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
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
   * 百度千帆仅支持开关模式
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
