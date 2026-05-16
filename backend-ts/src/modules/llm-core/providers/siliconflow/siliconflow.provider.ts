import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createTextModel, createMultimodalModel, createEmbeddingModel, ConfigFragments } from '../../utils/model-config.helper';
import { SiliconFlowOpenAIAdapter } from './siliconflow-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * 硅基流动供应商实现
 * 提供高性价比的开源模型 API 服务
 */
@Injectable()
export class SiliconFlowProvider implements IModelProvider {
  readonly id = 'siliconflow';
  readonly name = '硅基流动';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://api.siliconflow.cn/v1/';
  
  // 内部持有硅基流动专用的适配器实例
  private adapter: SiliconFlowOpenAIAdapter;
  
  constructor() {
    this.adapter = new SiliconFlowOpenAIAdapter();
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
  
  // 硅基流动默认仅支持开关模式
  private defaultThinkingEfforts: string[] = ['off', 'on'];
  
  private models: ModelDefinition[] = [
    // DeepSeek V3 系列
    createTextModel(
      'deepseek-ai/DeepSeek-V3.2',
      ConfigFragments.ContextWindow._160K
    ),
    createTextModel(
      'deepseek-ai/DeepSeek-V3.1-Terminus',
      ConfigFragments.ContextWindow._160K
    ),
    // DeepSeek R1 - 不支持工具调用
    createTextModel(
      'deepseek-ai/DeepSeek-R1',
      ConfigFragments.ContextWindow._160K,
      ConfigFragments.WithTools
    ),
    // Qwen 多模态系列
    createMultimodalModel(
      'Qwen/Qwen3.5-397B-A17B',
      ConfigFragments.ContextWindow._256K
    ),
    createMultimodalModel(
      'Qwen/Qwen3.5-122B-A10B',
      ConfigFragments.ContextWindow._256K
    ),
    createMultimodalModel(
      'Qwen/Qwen3-VL-32B-Instruct',
      ConfigFragments.ContextWindow._128K,
      ConfigFragments.WithTools
    ),
    createMultimodalModel(
      'Qwen/Qwen3-VL-235B-A22B-Thinking',
      ConfigFragments.ContextWindow._256K
    ),
    // Kimi - 支持工具调用
    createTextModel(
      'moonshotai/Kimi-K2-Thinking',
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.WithTools
    ),
    // Embedding 模型
    createEmbeddingModel(
      'Qwen/Qwen3-Embedding-8B',
      ConfigFragments.ContextWindow._32K,
      ConfigFragments.VectorDim._4096
    ),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '提供高性价比的开源模型 API 服务，支持多种主流大语言模型。',
      avatarUrl: 'static/images/providers/siliconflow.svg',
      apiKeyUrl: 'https://cloud.siliconflow.cn/me/account/ak',
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
   * 使用启发式规则动态推断
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();
    
    // 规则1: Embedding 模型不支持思考
    if (lowerName.includes('embedding') || lowerName.includes('embed')) {
      return [];
    }
    
    // 规则2: DeepSeek V3 系列 - 仅支持开关
    if (lowerName.includes('deepseek') && lowerName.includes('v3')) {
      return ['off', 'on'];
    }
    
    // 规则3: Qwen/Kimi 等多数模型 - 仅支持开关
    if (lowerName.includes('qwen') || lowerName.includes('kimi')) {
      return ['off', 'on'];
    }
    
    // 默认：使用供应商默认配置
    return this.defaultThinkingEfforts;
  }
}
