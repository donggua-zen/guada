import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createTextModel, createMultimodalModel, createEmbeddingModel, ConfigFragments } from '../../utils/model-config.helper';
import { AliyunBailianOpenAIAdapter } from './aliyun-bailian-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * 阿里云百炼供应商实现
 * 阿里云推出的大模型服务平台，提供通义千问等自研模型及第三方模型接入
 */
@Injectable()
export class AliyunBailianProvider implements IModelProvider {
  readonly id = 'aliyun-bailian';
  readonly name = '阿里云百炼';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/';
  
  // 内部持有阿里云专用的适配器实例
  private adapter: AliyunBailianOpenAIAdapter;
  
  constructor() {
    this.adapter = new AliyunBailianOpenAIAdapter();
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
  
  // 阿里云仅支持开关模式（enable_thinking）
  private defaultThinkingEfforts: string[] = ['off', 'on'];
  
  private models: ModelDefinition[] = [
    // Qwen 系列
    createMultimodalModel('qwen3.6-plus', ConfigFragments.ContextWindow._1M),
    createMultimodalModel('qwen3.6-plus-2026-04-02', ConfigFragments.ContextWindow._1M),
    createMultimodalModel('qwen3.5-397b-a17b', ConfigFragments.ContextWindow._256K),
    createMultimodalModel('qwen3.5-122b-a10b', ConfigFragments.ContextWindow._256K),
    createMultimodalModel('qwen3.5-27b', ConfigFragments.ContextWindow._256K),
    createMultimodalModel('qwen3.5-35b-a3b', ConfigFragments.ContextWindow._256K),
    
    // DeepSeek 系列
    createTextModel('deepseek-v3.2', ConfigFragments.ContextWindow._128K),
    createTextModel('deepseek-v3.1', ConfigFragments.ContextWindow._128K),
    createTextModel('deepseek-r1-0528', ConfigFragments.ContextWindow._128K),
    createTextModel('deepseek-v3', ConfigFragments.ContextWindow._64K),
    
    // 其他模型
    createMultimodalModel('kimi-k2.5', ConfigFragments.ContextWindow._256K),
    createTextModel('glm-5', ConfigFragments.ContextWindow._198K),
    createTextModel(
      'minimax-m2.5',
      ConfigFragments.ContextWindow._200K,
      ConfigFragments.WithTools
    ),
    
    // Embedding 模型
    createEmbeddingModel(
      'text-embedding-v4',
      ConfigFragments.ContextWindow._32K,
      ConfigFragments.VectorDim._1024
    ),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '阿里云推出的大模型服务平台，提供通义千问等自研模型及第三方模型接入。',
      avatarUrl: 'static/images/providers/aliyun-bailian.svg',
      apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key',
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
   * 阿里云仅支持开关模式
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
