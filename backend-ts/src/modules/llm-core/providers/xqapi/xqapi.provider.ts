import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { createMultimodalModel, ConfigFragments } from '../../utils/model-config.helper';
import { XQApiOpenAIAdapter } from './xqapi-openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * XQAPI 供应商实现
 * 新一代统一 AI API 平台，一个接口调用全部模型
 */
@Injectable()
export class XQApiProvider implements IModelProvider {
  readonly id = 'xqapi';
  readonly name = 'XQAPI';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://xqapi.com/v1/';

  // 内部持有 XQAPI 专用的适配器实例
  private adapter: XQApiOpenAIAdapter;

  constructor() {
    this.adapter = new XQApiOpenAIAdapter();
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

  // GPT-5 系列支持 reasoning_effort 强度控制（可关闭）
  private gptThinkingEfforts: string[] = ['none', 'low', 'medium', 'high'];

  private models: ModelDefinition[] = [
    // ===== GPT-5 系列（支持 reasoning_effort + 工具调用）=====

    // GPT-5.4 — 1.05M 上下文，128K 输出
    createMultimodalModel(
      'gpt-5.4',
      ConfigFragments.ContextWindow._1_1M,
      ConfigFragments.MaxOutput._128K,
    ),

    // GPT-5.5 — 1M 上下文，128K 输出
    createMultimodalModel(
      'gpt-5.5',
      ConfigFragments.ContextWindow._1M,
      ConfigFragments.MaxOutput._128K,
    ),

    // GPT-5.6 — 1.05M 上下文，128K 输出（别名路由至 gpt-5.6-sol）
    createMultimodalModel(
      'gpt-5.6',
      ConfigFragments.ContextWindow._1_1M,
      ConfigFragments.MaxOutput._128K,
    ),

    // GPT-5.6-sol — 前沿旗舰，1.05M 上下文，128K 输出
    createMultimodalModel(
      'gpt-5.6-sol',
      ConfigFragments.ContextWindow._1_1M,
      ConfigFragments.MaxOutput._128K,
    ),

    // GPT-5.6-luna — 轻量高速，1.05M 上下文，128K 输出
    createMultimodalModel(
      'gpt-5.6-luna',
      ConfigFragments.ContextWindow._1_1M,
      ConfigFragments.MaxOutput._128K,
    ),

    // GPT-5.6-terra — 均衡型，1.05M 上下文，128K 输出
    createMultimodalModel(
      'gpt-5.6-terra',
      ConfigFragments.ContextWindow._1_1M,
      ConfigFragments.MaxOutput._128K,
    ),
  ];

  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '新一代统一 AI API 平台，一个接口调用全部模型。',
      avatarUrl: 'xqapi.svg',
      apiKeyUrl: 'https://xqapi.com/user/login?invite=6542C98ACD',
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
   * GPT-5 系列支持 reasoning_effort（none / low / medium / high）
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();

    // GPT-5 系列支持 reasoning_effort
    if (lowerName.startsWith('gpt-5')) {
      return this.gptThinkingEfforts;
    }

    return [];
  }
}
