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
 *
 * 除 apiUrl/apiKey 外的字段均为可选：内置适配器只消费 wire 必需项，
 * 插件适配器可按需读取 id/type/thinking/compat（例如自定义认证、思考拼法）。
 */
export interface ProviderConfig {
  /** 实例 id（模型 id 前缀；连接测试场景可能缺省） */
  id?: string;
  /** 供应商类型键（custom / 内置类型 / 插件类型） */
  type?: string;
  apiUrl: string;
  apiKey: string;
  protocol?: string;
  headers?: Record<string, string>;
  /** 实例级 thinking 声明（档位菜单；插件适配器可选消费） */
  thinking?: import("../thinking/thinking-vocabulary").ProviderThinkingConfig;
  /** 实例级 wire 兼容开关（插件适配器可选消费） */
  compat?: import("../thinking/thinking-vocabulary").ThinkingCompatConfig;
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
