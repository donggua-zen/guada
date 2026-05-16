/**
 * 模型供应商统一接口
 * 每个供应商实现此接口，封装自身特有逻辑
 */

/**
 * 供应商元数据
 */
export interface ProviderMetadata {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  apiKeyUrl?: string; // API Key 获取地址
  documentationUrl?: string;
  protocols: string[];
  defaultApiUrl: string;
  features?: string[]; // ['thinking', 'tools', 'multimodal']
}

/**
 * 模型配置
 */
export interface ModelConfig {
  inputCapabilities: string[];
  outputCapabilities: string[];
  features: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  vectorDimensions?: number;
}

/**
 * 模型定义
 */
export interface ModelDefinition {
  modelName: string;
  modeType: 'text' | 'embedding' | 'image';
  config: ModelConfig;
}

/**
 * 模型过滤选项
 */
export interface ModelFilterOptions {
  modeType?: 'text' | 'embedding' | 'image';
  feature?: string;
}

/**
 * 请求构建上下文
 */
export interface RequestBuildContext {
  thinkingEffort?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: any[];
  extraBody?: Record<string, any>;
}

/**
 * 基础请求参数
 */
export interface BaseRequestParams {
  model: string;
  messages: any[];
  stream?: boolean;
  timeout?: number;
}

/**
 * 最终请求参数
 */
export type FinalRequestParams = Record<string, any>;

/**
 * 供应商配置
 */
export interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  protocol?: string;
}

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * 远程模型信息
 */
export interface RemoteModel {
  id: string;
  created?: number;
  owned_by?: string;
  [key: string]: any;
}

/**
 * 模型供应商统一接口
 * 所有供应商都必须实现此接口
 */
export interface IModelProvider {
  /**
   * 供应商标识符（唯一）
   */
  readonly id: string;
  
  /**
   * 供应商名称（显示用）
   */
  readonly name: string;
  
  /**
   * 支持的协议列表
   * 例如：['openai', 'openai-response']
   */
  readonly protocols: string[];
  
  /**
   * 默认 API 地址
   */
  readonly defaultApiUrl: string;
  
  /**
   * 获取供应商元数据
   */
  getMetadata(): ProviderMetadata;
  
  /**
   * 获取该供应商支持的模型列表
   * @param options 可选过滤条件
   */
  getModels(options?: ModelFilterOptions): ModelDefinition[];
  
  /**
   * 获取指定模型的思考强度选项
   * 必须由供应商实现，根据模型名称动态推断
   * @param modelName 模型名称
   * @returns 思考强度选项数组，如 ['off', 'low', 'medium', 'high']
   *          空数组表示不支持思考功能
   */
  getModelThinkingEfforts(modelName: string): string[];
  
  /**
   * 获取指定协议的适配器
   * 供应商内部持有协议适配器实例，通过此方法返回
   * @param protocol 协议名称（如 'openai', 'gemini'）
   * @returns 协议适配器实例，如果供应商不支持该协议则返回 null
   */
  getAdapter(protocol: string): import('../adapters/base.adapter').IProtocolAdapter | null;
  
  /**
   * 从远程 API 同步模型列表（可选）
   */
  syncRemoteModels?(config: ProviderConfig): Promise<RemoteModel[]>;
}
