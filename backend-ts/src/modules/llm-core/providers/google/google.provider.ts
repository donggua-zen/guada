import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createMultimodalModel, ConfigFragments } from '../../utils/model-config.helper';
import { GeminiAdapter } from '../../adapters/gemini.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * Google Gemini 供应商实现
 * 谷歌提供的 Gemini 大模型服务，具备强大的多模态理解与生成能力
 */
@Injectable()
export class GoogleProvider implements IModelProvider {
  readonly id = 'google';
  readonly name = 'Google';
  readonly protocols = ['gemini'];
  readonly defaultApiUrl = 'https://generativelanguage.googleapis.com/';

  // 内部持有 Gemini 适配器实例（不需要私有定制）
  private adapter: GeminiAdapter;

  constructor() {
    this.adapter = new GeminiAdapter();
  }

  /**
   * 获取指定协议的适配器
   */
  getAdapter(protocol: string): IProtocolAdapter | null {
    if (protocol === 'gemini') {
      return this.adapter;
    }
    return null;
  }

  private models: ModelDefinition[] = [
    // Gemini 3.1 及以上支持 thinkingLevel
    createMultimodalModel('gemini-3.1-pro-preview', ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K),
    createMultimodalModel('gemini-3-flash-preview', ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K),

    // Gemini 2.5 及以下不支持 thinkingLevel，移除默认的 thinking 特性
    createMultimodalModel('gemini-2.5-flash', ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K, ConfigFragments.WithoutThinking),
    createMultimodalModel('gemini-2.5-pro', ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K, ConfigFragments.WithoutThinking),
    createMultimodalModel(
      'gemini-2.5-flash-image',
      ConfigFragments.ContextWindow._33K,
      ConfigFragments.MaxOutput._33K,
      ConfigFragments.WithoutThinking,
      ConfigFragments.ImageOutput
    ),
  ];

  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '谷歌提供的 Gemini 大模型服务，具备强大的多模态理解与生成能力。',
      avatarUrl: 'static/images/providers/google.svg',
      apiKeyUrl: 'https://aistudio.google.com/app/apikey',
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
   * 注意：Gemini 2.5 及以下不支持 thinkingLevel
   * Gemini 3.1 及以上支持 thinkingLevel，但无法关闭思考
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();

    // 3.1 及以上版本支持 thinkingLevel
    if (lowerName.includes('gemini-3.1') || lowerName.includes('gemini-3.')) {
      // Pro 系列不支持 minimal 强度
      if (lowerName.includes('-pro')) {
        return ['low', 'medium', 'high'];
      }

      // Flash 系列支持完整强度
      return ['minimal', 'low', 'medium', 'high'];
    }

    // 2.5 及以下不支持 thinkingLevel
    return [];
  }
}
