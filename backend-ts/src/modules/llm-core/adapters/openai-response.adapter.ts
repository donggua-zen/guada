import { Logger } from "@nestjs/common";
import { OpenAI } from "openai";
import { IProtocolAdapter } from "./base.adapter";
import {
  MessageRecord,
  InternalToolDefinition,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult } from "../types/provider.types";

/**
 * OpenAI Responses API 适配器
 *
 * 基于 OpenAI Responses API（beta）实现，采用无状态设计，每次调用创建新客户端实例
 * 与 Chat Completions API 相比，Responses API 使用不同的事件格式和数据结构
 * 支持推理内容流式输出、工具调用增量累积等高级特性
 */
export class OpenAIResponseAdapter implements IProtocolAdapter {
  readonly protocol = "openai-response";
  private readonly logger = new Logger(OpenAIResponseAdapter.name);

  /**
   * 测试 OpenAI Responses API 连接
   */
  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.createClient(config);
      // 使用轻量级请求测试连接
      await client.responses.create({
        model: "gpt-4o-mini",
        input: "test",
      });
      return {
        success: true,
        message: "连接成功",
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message?.includes("401")
          ? "API Key 无效"
          : `连接失败: ${error.message}`,
        details: error,
      };
    }
  }

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const client = this.createClient(params.providerConfig);
    const formattedInput = this.formatInput(params.messages);
    const requestParams = this.buildRequestParam(params, formattedInput);

    let response: any = null;

    try {
      response = await client.responses.create(requestParams, {
        signal: params.abortSignal,
      });

      if (params.stream) {
        yield* this.handleStreamResponse(response);
      } else {
        yield this.handleNonStreamResponse(response);
      }
    } catch (error) {
      this.logger.error(`LLM Responses API error (${params.stream ? "stream" : "non-stream"}):`, error);
      this.handleError(error, params.stream);
    } finally {
      this.cleanup(response);
    }
  }

  /**
   * 创建 OpenAI 客户端实例
   */
  private createClient(providerConfig: any) {
    return new OpenAI({
      baseURL: providerConfig?.apiUrl || process.env.OPENAI_BASE_URL,
      apiKey:
        providerConfig?.apiKey ||
        process.env.OPENAI_API_KEY ||
        "sk-placeholder",
    });
  }

  /**
   * 将内部消息格式转换为 Responses API 输入格式
   *
   * Responses API 使用扁平化的 item 数组结构，支持 message、function_call、function_call_output 三种类型
   * 工具调用结果通过 function_call_output 类型传递，需要关联 call_id
   * 多模态内容（文本、图片）统一映射为 input_text 和 input_image 类型
   */
  private formatInput(messages: MessageRecord[]): any[] {
    const items: any[] = [];

    for (const msg of messages) {
      if (msg.role === "tool") {
        items.push({
          type: "function_call_output",
          call_id: msg.toolCallId,
          output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        });
        continue;
      }

      const baseMessage: any = {
        type: "message",
        role: msg.role,
      };

      if (typeof msg.content === "string") {
        baseMessage.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        baseMessage.content = msg.content.map((part) => {
          if (part.type === "text") {
            return { type: "input_text", text: part.text };
          } else if (part.type === "image_url") {
            return {
              type: "input_image",
              image_url: part.image_url?.url,
              detail: part.image_url?.detail || "auto",
            };
          }
          return part;
        });
      }

      // 跳过空内容且无工具调用的消息
      if (baseMessage.content === "" && (!msg.toolCalls || msg.toolCalls.length === 0)) {
        continue;
      }

      if (baseMessage.content !== "" || msg.toolCalls?.length === 0) {
        items.push(baseMessage);
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          items.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
      }
    }

    return items;
  }

  /**
   * 构建请求参数并注入供应商特定配置（可被子类覆盖）
   *
   * 根据模型特性动态注入 thinking 配置，仅当供应商声明支持且模型配置包含 thinking 特性时才启用
   * Responses API 使用 max_output_tokens 替代 max_tokens，其他参数保持兼容
   */
  protected buildRequestParam(params: any, formattedInput: any[]) {
    const requestParams: any = {
      model: params.model,
      input: formattedInput,
      stream: params.stream,
    };

    Object.assign(requestParams, params.extraBody || {});

    if (params.temperature !== undefined && params.temperature !== null) {
      requestParams.temperature = params.temperature;
    }
    if (params.topP !== undefined && params.topP !== null) {
      requestParams.top_p = params.topP;
    }
    if (
      params.frequencyPenalty !== undefined &&
      params.frequencyPenalty !== null
    ) {
      requestParams.frequency_penalty = params.frequencyPenalty;
    }
    if (params.maxTokens !== undefined && params.maxTokens !== null) {
      requestParams.max_output_tokens = params.maxTokens;
    }

    if (params.tools?.length) {
      requestParams.tools = this.convertTools(params.tools);
      requestParams.tool_choice = "auto";
    }

    // 处理思考强度（OpenAI Responses API 使用 reasoning 对象）
    if (params.thinkingEffort && !["on", "off"].includes(params.thinkingEffort)) {
      // OpenAI Responses API 使用 reasoning.effort 参数
      requestParams.reasoning = {
        effort: params.thinkingEffort,
      };
    }

    return requestParams;
  }

  /**
   * 将内部扁平化工具定义转换为 OpenAI Responses API 格式
   */
  private convertTools(tools: InternalToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * 处理流式响应事件流
   *
   * Responses API 的事件流包含多种类型：文本增量、推理摘要增量、工具调用参数增量等
   * 工具调用需要通过 output_item.added 事件获取元信息（call_id、name），再通过 function_call_arguments.delta 累积参数
   * 所有 done 事件均被跳过，上层通过累积 delta 即可获得完整内容，避免数据重复
   */
  private async *handleStreamResponse(
    response: any,
  ): AsyncGenerator<LLMResponseChunk> {
    // 跟踪工具调用元信息，用于关联增量参数与具体工具
    const toolCallInfoMap = new Map<string, { callId: string; name: string; index: number }>();
    let toolCallCounter = 0;

    for await (const event of response) {
      const responseChunk: LLMResponseChunk = {
        content: null,
        reasoningContent: null,
        finishReason: null,
        toolCalls: undefined,
        usage: null,
      };
      switch (event.type) {
        case "response.output_text.delta":
          responseChunk.content = event.delta;
          break;

        case "response.output_text.done":
          continue;

        case "response.reasoning_text.delta":
          responseChunk.reasoningContent = event.delta;
          break;

        case "response.reasoning_text.done":
          continue;

        case "response.reasoning_summary_text.delta":
          responseChunk.reasoningContent = event.delta;
          break;

        case "response.reasoning_summary_text.done":
          continue;

        case "response.output_item.added":
          // 记录工具调用元信息，供后续参数增量事件使用
          if (event.item?.type === "function_call") {
            const index = toolCallCounter++;
            toolCallInfoMap.set(event.item.id, {
              callId: event.item.call_id,
              name: event.item.name,
              index,
            });
          }
          continue;

        case "response.function_call_arguments.delta":
          // 累积工具调用参数字符串片段，火山引擎等厂商的 delta 事件不包含 call_id 和 name
          {
            const info = toolCallInfoMap.get(event.item_id);
            if (!info) continue;
            if (!responseChunk.toolCalls) {
              responseChunk.toolCalls = [];
            }
            responseChunk.toolCalls.push({
              id: info.callId,
              index: info.index,
              type: "function",
              name: info.name,
              arguments: event.delta,
            });
          }
          break;

        case "response.function_call_arguments.done":
          continue;

        case "response.completed":
          responseChunk.finishReason = "stop";
          if (event.response?.usage) {
            responseChunk.usage = {
              promptTokens: event.response.usage.input_tokens,
              completionTokens: event.response.usage.output_tokens,
              totalTokens: event.response.usage.total_tokens,
            };
          }
          break;

        case "response.failed":
          responseChunk.finishReason = "error";
          this.logger.error(`Response failed: ${event.error?.message}`);
          break;
      }

      // 只 yield 有实际内容的 chunk
      if (
        responseChunk.content ||
        responseChunk.reasoningContent ||
        responseChunk.finishReason ||
        responseChunk.toolCalls?.length ||
        responseChunk.usage
      ) {
        yield responseChunk;
      }
    }
  }

  /**
   * 处理非流式响应
   *
   * 从 response.output 数组中提取文本、工具调用和推理内容
   * 工具调用通过 function_call 类型识别，推理内容通过 reasoning 类型提取
   */
  private handleNonStreamResponse(response: any): LLMResponseChunk {
    if (!response || !response.output) {
      throw new Error("Invalid response from LLM Responses API");
    }

    const result: LLMResponseChunk = {
      content: null,
      reasoningContent: null,
      finishReason: "stop",
      toolCalls: undefined,
      usage: null,
    };

    // 遍历输出项，提取不同类型的内容
    const outputs = response.output || [];
    for (const output of outputs) {
      if (output.type === "message") {
        const content = output.content?.[0];
        if (content?.type === "output_text") {
          result.content = content.text;
        }
      } else if (output.type === "function_call") {
        if (!result.toolCalls) {
          result.toolCalls = [];
        }
        result.toolCalls.push({
          id: output.call_id || output.id,
          type: "function",
          name: output.name,
          arguments: output.arguments || "{}",
        });
      } else if (output.type === "reasoning") {
        result.reasoningContent = output.summary || output.content;
      }
    }

    // 提取 token 使用量统计
    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    return result;
  }

  /**
   * 错误处理与转换
   */
  private handleError(error: any, isStream: boolean) {
    this.logger.error(
      `LLM Responses API error (${isStream ? "stream" : "non-stream"}):`,
      error,
    );

    if (error.name === "APIError" || error.status) {
      this.logger.error(`API Error Details:`, {
        status: error.status,
        message: error.message,
        code: error.code,
        param: error.param,
        type: error.type,
      });
      throw new Error(`LLM Responses API Error: ${error.status} - ${error.message}`);
    }

    if (error.name === "AbortError") {
      throw new Error("LLM request aborted");
    }

    if (error.message.includes("timeout")) {
      throw new Error("LLM request timed out (60s)");
    }

    throw error;
  }

  /**
   * 清理响应资源
   */
  private cleanup(response: any) {
    if (response && typeof response.controller?.abort === "function") {
      try {
        response.controller.abort();
      } catch (e) {
        // ignore
      }
    }
  }
}
