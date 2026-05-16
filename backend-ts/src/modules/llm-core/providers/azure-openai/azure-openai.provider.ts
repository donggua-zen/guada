import { Injectable } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions } from '../../types/provider.types';
import { OpenAIAdapter } from '../../adapters/openai.adapter';
import { IProtocolAdapter } from '../../adapters/base.adapter';

/**
 * Azure OpenAI 供应商实现
 * 微软 Azure 云平台提供的 OpenAI 服务，支持企业级部署和更高的安全性
 */
@Injectable()
export class AzureOpenAIProvider implements IModelProvider {
  readonly id = 'azure-openai';
  readonly name = 'Azure OpenAI';
  readonly protocols = ['openai'];
  readonly defaultApiUrl = 'https://{resource-name}.openai.azure.com/';
  
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
  
  // Azure OpenAI 支持 reasoning_effort（与标准 OpenAI 相同）
  private defaultThinkingEfforts: string[] = ['low', 'medium', 'high'];
  
  private models: ModelDefinition[] = [];
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: '微软 Azure 云平台提供的 OpenAI 服务，支持企业级部署和更高的安全性。',
      avatarUrl: 'static/images/providers/azure.svg',
      apiKeyUrl: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',
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
   * Azure OpenAI 支持 reasoning_effort（与标准 OpenAI 相同）
   */
  getModelThinkingEfforts(modelName: string): string[] {
    const lowerName = modelName.toLowerCase();
    
    // Embedding 模型不支持思考
    if (lowerName.includes('embedding') || lowerName.includes('embed')) {
      return [];
    }
    
    // GPT-4o 系列不支持 reasoning_effort
    if (lowerName.includes('gpt-4o')) {
      return [];
    }
    
    // o 系列和 GPT-5 支持 reasoning_effort
    if (lowerName.startsWith('o') || lowerName.startsWith('gpt-5')) {
      return this.defaultThinkingEfforts;
    }
    
    // 其他模型不支持
    return [];
  }
}
