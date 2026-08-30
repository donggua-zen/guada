import { LLMCompletionParams, StreamChunk } from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult, RemoteModel } from "../types/provider.types";

/**
 * 协议适配器接口
 * 所有协议适配器（OpenAI, Anthropic, Gemini 等）都必须实现此接口
 *
 * 职责：封装底层通信细节，提供统一的聊天和模型查询接口
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
   * @returns 流式响应生成器（StreamChunk 词表）或非流式响应（chunk 数组：block_end* → usage → finish）
   */
  chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<StreamChunk> | Promise<StreamChunk[]>;

  /**
   * 从远程 API 同步该协议下的可用模型列表
   * @param config 供应商配置
   * @returns 远程模型列表
   */
  syncRemoteModels(config: ProviderConfig): Promise<RemoteModel[]>;
}
