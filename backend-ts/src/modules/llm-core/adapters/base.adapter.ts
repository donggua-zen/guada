import { LLMCompletionParams, LLMResponseChunk } from "../types/llm.types";

/**
 * LLM 适配器统一接口
 * 所有协议适配器（OpenAI, Anthropic, Gemini 等）都必须实现此接口
 */
export interface LLMAdapter {
  /**
   * 协议标识符 (e.g., 'openai', 'anthropic')
   */
  readonly protocol: string;

  /**
   * 执行聊天补全
   * @param params 请求参数
   * @returns 流式响应生成器或 Promise
   */
  chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> | Promise<LLMResponseChunk>;
}
