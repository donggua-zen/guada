import { Injectable, Logger } from '@nestjs/common';
import { IModelProvider, ProviderMetadata, ModelDefinition, ModelFilterOptions, BaseRequestParams, RequestBuildContext, FinalRequestParams, ProviderConfig, ConnectionTestResult } from './types/provider.types';

/**
 * 供应商统一管理器
 * 负责注册、发现和路由所有模型供应商
 */
@Injectable()
export class ProviderHub {
  private providers = new Map<string, IModelProvider>();
  private readonly logger = new Logger(ProviderHub.name);
  
  /**
   * 注册供应商
   * @param provider 供应商实例
   */
  register(provider: IModelProvider): void {
    if (this.providers.has(provider.id)) {
      this.logger.warn(`Provider ${provider.id} already registered, will be overwritten`);
    }
    this.providers.set(provider.id, provider);
    this.logger.log(`Registered provider: ${provider.id} (${provider.name})`);
  }
  
  /**
   * 批量注册供应商
   * @param providers 供应商实例数组
   */
  registerMany(providers: IModelProvider[]): void {
    providers.forEach(provider => this.register(provider));
  }
  
  /**
   * 获取供应商实例
   * @param id 供应商标识符
   * @returns 供应商实例
   * @throws Error 如果供应商不存在
   */
  getProvider(id: string): IModelProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider "${id}" not found. Available providers: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    return provider;
  }
  
  /**
   * 检查供应商是否存在
   * @param id 供应商标识符
   * @returns 是否存在
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }
  
  /**
   * 获取所有供应商元数据
   * @returns 元数据数组
   */
  getAllMetadata(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => p.getMetadata());
  }
  
  /**
   * 获取所有已注册的供应商实例
   * @returns 供应商实例数组
   */
  getAllProviders(): IModelProvider[] {
    return Array.from(this.providers.values());
  }
  
  /**
   * 获取所有已注册的供应商ID列表
   * @returns ID数组
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }
  
  /**
   * 根据协议获取供应商列表
   * @param protocol 协议名称（如 'openai', 'gemini'）
   * @returns 支持该协议的供应商列表
   */
  getProvidersByProtocol(protocol: string): IModelProvider[] {
    return Array.from(this.providers.values())
      .filter(p => p.protocols.includes(protocol));
  }
  
  /**
   * 获取支持指定协议的所有供应商ID
   * @param protocol 协议名称
   * @returns 供应商ID数组
   */
  getProviderIdsByProtocol(protocol: string): string[] {
    return this.getProvidersByProtocol(protocol).map(p => p.id);
  }
  
  /**
   * 获取供应商的模型列表
   * @param providerId 供应商标识符
   * @param options 过滤选项
   * @returns 模型定义数组
   */
  getModels(providerId: string, options?: ModelFilterOptions): ModelDefinition[] {
    const provider = this.getProvider(providerId);
    return provider.getModels(options);
  }
  
  /**
   * 获取指定模型的思考强度选项
   * @param providerId 供应商标识符
   * @param modelName 模型名称
   * @returns 思考强度选项数组
   */
  getModelThinkingEfforts(providerId: string, modelName: string): string[] {
    const provider = this.getProvider(providerId);
    return provider.getModelThinkingEfforts(modelName);
  }
  
  /**
   * 从远程 API 同步模型列表
   * @param providerId 供应商标识符
   * @param config 供应商配置
   * @returns 远程模型列表
   */
  async syncRemoteModels(providerId: string, config: ProviderConfig): Promise<any[]> {
    const provider = this.getProvider(providerId);
    if (!provider.syncRemoteModels) {
      throw new Error(`Provider "${providerId}" does not support remote model synchronization`);
    }
    return provider.syncRemoteModels(config);
  }
  
  /**
   * 获取供应商数量
   * @returns 已注册的供应商数量
   */
  getProviderCount(): number {
    return this.providers.size;
  }
  
  /**
   * 清空所有已注册的供应商（主要用于测试）
   */
  clear(): void {
    this.providers.clear();
    this.logger.log('Cleared all registered providers');
  }
}
