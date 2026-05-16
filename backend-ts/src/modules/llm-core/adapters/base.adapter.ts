import { LLMCompletionParams, LLMResponseChunk } from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult } from "../types/provider.types";

/**
 * 协议适配器接口
 * 所有协议适配器（OpenAI, Anthropic, Gemini 等）都必须实现此接口
 * 
 * 职责：封装底层通信细节，提供统一的聊天接口
 */
export interface IProtocolAdapter {
  /**
   * 协议标识符 (e.g., 'openai', 'anthropic', 'gemini')
   */
  readonly protocol: string;

  /**
   * 测试供应商连接
   * @param config 供应商配置
   * @returns 测试结果
   */
  testConnection(config: ProviderConfig): Promise<ConnectionTestResult>;

  /**
   * 执行聊天补全
   * @param params 请求参数
   * @returns 流式响应生成器或 Promise
   */
  chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> | Promise<LLMResponseChunk>;
}
