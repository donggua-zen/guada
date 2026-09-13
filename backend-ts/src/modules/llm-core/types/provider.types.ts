/**
 * 模型供应商共享类型
 *
 * 供应商配置文件化后（providers/*.yaml + bundled-providers/*.yaml），
 * 本文件只保留跨模块使用的 wire 层类型；供应商/模型的权威数据
 * schema 见 llm-core/provider-file.store.ts 与 llm-core/bundled-catalog.service.ts。
 */

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
 * 供应商配置
 */
export interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  protocol?: string;
  headers?: Record<string, string>;
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
