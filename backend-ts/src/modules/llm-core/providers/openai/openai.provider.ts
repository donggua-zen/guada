import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createMultimodalModel, createEmbeddingModel, ConfigFragments } from '../../utils/model-config.helper';
import { OpenAIOpenAIAdapter } from './openai-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * OpenAI 供应商实现（标准 Chat Completions API）
 * 全球领先的 AI 研究机构，ChatGPT 和 GPT 系列模型的创造者
 */
@Injectable()
export class OpenAIProvider implements IModelProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://api.openai.com/v1/';
  
  // 内部持有 OpenAI 专用的适配器实例
  private adapter: OpenAIOpenAIAdapter;
  
  constructor() {
    this.adapter = new OpenAIOpenAIAdapter();
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
  
  // OpenAI o 系列和 GPT-5 支持 reasoning_effort
  private defaultThinkingEfforts: string[] = ['low', 'medium', 'high'];
  
  private models: ModelDefinition[] = [
    // GPT-4o 系列（稳定支持，但不支持 reasoning_effort）
    createMultimodalModel('gpt-4o', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    createMultimodalModel('gpt-4o-mini', ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
    
    // GPT-5 系列（支持 reasoning_effort）
    createMultimodalModel('gpt-5.4', ConfigFragments.ContextWindow._1_1M),
    createMultimodalModel('gpt-5-mini', ConfigFragments.ContextWindow._400K),
    createMultimodalModel('gpt-5', ConfigFragments.ContextWindow._1_1M),
    
    // o 系列推理模型（支持 reasoning_effort）
    createMultimodalModel('o4-mini', ConfigFragments.ContextWindow._200K),
    createMultimodalModel('o3-mini', ConfigFragments.ContextWindow._200K),
    createMultimodalModel('o1', ConfigFragments.ContextWindow._200K),
    
    // Embedding 模型
    createEmbeddingModel('text-embedding-3-small', ConfigFragments.ContextWindow._8K, ConfigFragments.VectorDim._2000),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '全球领先的 AI 研究机构，ChatGPT 和 GPT 系列模型的创造者。',
      avatarUrl: 'static/images/providers/openai.svg',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
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
   * OpenAI o 系列和 GPT-5 支持 reasoning_effort，但无法完全禁用推理
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();
    
    // Embedding 模型不支持思考
    if (lowerName.includes('embedding') || lowerName.includes('embed')) {
      return [];
    }
    
    // GPT-4o 系列不支持 reasoning_effort（本身不具备推理功能）
    if (lowerName.includes('gpt-4o')) {
      return [];
    }
    
    // o 系列和 GPT-5 支持 reasoning_effort，但无法完全禁用
    // 只提供强度选项，不提供 'off' 或 'on'
    if (lowerName.startsWith('o') || lowerName.startsWith('gpt-5')) {
      return this.defaultThinkingEfforts; // ['low', 'medium', 'high']
    }
    
    // 其他模型不支持
    return [];
  }
}
