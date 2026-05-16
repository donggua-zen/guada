import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createMultimodalModel, ConfigFragments } from '../../utils/model-config.helper';
import { OpenAIResponseAdapter } from '../../adapters/openai-response.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * OpenAI Responses API 供应商实现
 * 使用 OpenAI 最新 Responses API（beta），专为 o 系列推理模型和高级智能体场景设计
 */
@Injectable()
export class OpenAIResponseProvider implements IModelProvider {
  readonly id = 'openai-response';
  readonly name = 'OpenAI (Responses API)';
  readonly protocols = ['openai-response'];
  readonly defaultApiUrl = 'https://api.openai.com/v1/';
  
  // 内部持有 OpenAI Responses API 专用的适配器实例
  private adapter: OpenAIResponseAdapter;
  
  constructor() {
    this.adapter = new OpenAIResponseAdapter();
  }
  
  /**
   * 获取指定协议的适配器
   */
  getAdapter(protocol: string): IProtocolAdapter | null {
    if (protocol === 'openai-response') {
      return this.adapter;
    }
    return null;
  }
  
  // OpenAI Responses API 支持 reasoning_effort
  private defaultThinkingEfforts: string[] = ['low', 'medium', 'high'];
  
  private models: ModelDefinition[] = [
    // Responses API 独占模型
    createMultimodalModel('gpt-5-codex', ConfigFragments.ContextWindow._1_1M),
    createMultimodalModel('computer-use-preview', ConfigFragments.ContextWindow._128K),
    
    // o 系列推理模型（Responses API 提供更佳体验）
    createMultimodalModel('o4-mini', ConfigFragments.ContextWindow._200K),
    createMultimodalModel('o3-pro', ConfigFragments.ContextWindow._200K),
    createMultimodalModel('o3-mini', ConfigFragments.ContextWindow._200K),
    createMultimodalModel('o1', ConfigFragments.ContextWindow._200K),
    
    // GPT-5 系列（原生支持，功能更完整）
    createMultimodalModel('gpt-5.4', ConfigFragments.ContextWindow._1_1M),
    createMultimodalModel('gpt-5-mini', ConfigFragments.ContextWindow._400K),
    createMultimodalModel('gpt-5-pro', ConfigFragments.ContextWindow._1_1M),
    createMultimodalModel('gpt-5', ConfigFragments.ContextWindow._1_1M),
  ];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '使用 OpenAI 最新 Responses API（beta），专为 o 系列推理模型和高级智能体场景设计。',
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
   * OpenAI Responses API 所有模型都支持 reasoning_effort，但无法完全禁用推理
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();
    
    // Embedding 模型不支持思考（虽然 Responses API 目前没有 embedding 模型）
    if (lowerName.includes('embedding') || lowerName.includes('embed')) {
      return [];
    }
    
    // 所有 Responses API 模型都支持 reasoning_effort，但无法完全禁用
    // 只提供强度选项，不提供 'off' 或 'on'
    return this.defaultThinkingEfforts; // ['low', 'medium', 'high']
  }
}
