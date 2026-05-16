import { Logger } from "@nestjs/common";
import { OpenAI, APIError } from "openai";
import { IProtocolAdapter } from "./base.adapter";
import {
  ProviderConfig,
  ConnectionTestResult,
} from "../types/provider.types";
import {
  MessageRecord,
  InternalToolDefinition,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";

export class OpenAIAdapter implements IProtocolAdapter {
  readonly protocol = "openai";
  private readonly logger = new Logger(OpenAIAdapter.name);

  /**
   * 创建 OpenAI API 客户端（可被子类覆盖）
   */
  protected createClient(config: ProviderConfig): OpenAI {
    return new OpenAI({
      baseURL: config.apiUrl,
      apiKey: config.apiKey,
    });
  }

  /**
   * 测试 OpenAI API 连接
   */
  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.createClient(config);
      await client.models.list();
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

  /**
   * 构建最终请求参数（可被子类覆盖）
   * 处理标准参数转换：temperature, topP, maxTokens 等
   */
  protected buildRequestParam(params: any): any {
    const requestParams: any = {
      model: params.model,
      messages: params.messages,
      stream: params.stream,
      timeout: params.timeout,
    };

    // 合并基础参数与 extraBody
    Object.assign(requestParams, params.extraBody || {});

    // 确保标准参数优先级最高（只添加非 undefined 的值）
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
      requestParams.max_tokens = params.maxTokens;
    }

    // 转换并添加工具定义
    if (params.tools?.length) {
      requestParams.tools = this.convertTools(params.tools);
      requestParams.tool_choice = "auto";
    }

    // 处理思考强度（OpenAI o 系列和 GPT-5 使用 reasoning_effort）
    if (params.thinkingEffort && params.thinkingEffort !== 'off') {
      // OpenAI 使用 reasoning_effort 参数
      requestParams.reasoning_effort = params.thinkingEffort;
    }

    return requestParams;
  }

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const client = this.createClient(params.providerConfig);
    const filterMessages = this.formatMessages(params.messages);
    
    console.log('[OpenAIAdapter] chatCompletion - thinkingEffort:', params.thinkingEffort);
    
    // 构建最终请求参数
    const requestParams = this.buildRequestParam({
      model: params.model,
      messages: filterMessages,
      stream: params.stream,
      timeout: params.timeout,
      temperature: params.temperature,
      topP: params.topP,
      frequencyPenalty: params.frequencyPenalty,
      maxTokens: params.maxTokens,
      tools: params.tools,
      extraBody: params.extraBody,
      thinkingEffort: params.thinkingEffort, // 传递 thinkingEffort
    });
    
    console.log('[OpenAIAdapter] buildRequestParams  - reasoning_effort:', requestParams.reasoning_effort);

    let response: any = null;

    try {
      response = await client.chat.completions.create(requestParams, {
        signal: params.abortSignal,
      });

      if (params.stream) {
        yield* this.handleStreamResponse(response);
      } else {
        yield this.handleNonStreamResponse(response);
      }
    } catch (error) {
      this.logger.error(`LLM API error (${params.stream ? "stream" : "non-stream"}):`, error);
      this.handleError(error, params.stream);
    } finally {
      this.cleanup(response);
    }
  }

  private formatMessages(messages: MessageRecord[]) {
    return messages.map((msg) => {
      const filtered: any = { role: msg.role, content: msg.content || "" };
      if (msg.reasoningContent !== undefined)
        filtered.reasoning_content = msg.reasoningContent;
      if (msg.toolCallId !== undefined) filtered.tool_call_id = msg.toolCallId;

      if (msg.toolCalls) {
        filtered.tool_calls = msg.toolCalls.map((tc, index) => ({
          id: tc.id,
          index,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return filtered;
    });
  }



  /**
   * 将内部扁平化工具定义转换为 OpenAI 格式
   */
  private convertTools(tools: InternalToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private async *handleStreamResponse(
    response: any,
  ): AsyncGenerator<LLMResponseChunk> {
    for await (const chunk of response) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      const responseChunk: LLMResponseChunk = {
        content: delta?.content || null,
        reasoningContent: (delta as any)?.reasoning_content || null,
        finishReason: choice.finish_reason || null,
        toolCalls: undefined,
        usage: null,
      };

      if ((chunk as any).usage) {
        responseChunk.usage = {
          promptTokens: (chunk as any).usage.prompt_tokens,
          completionTokens: (chunk as any).usage.completion_tokens,
          totalTokens: (chunk as any).usage.total_tokens,
        };
      }

      if (delta?.tool_calls) {
        responseChunk.toolCalls = delta.tool_calls.map(
          (tc): ToolCallItem => ({
            id: tc.id,
            index: tc.index,
            type: "function",
            name: tc.function?.name,
            arguments: tc.function?.arguments,
          }),
        );
      }

      if (
        responseChunk.content ||
        responseChunk.reasoningContent ||
        responseChunk.finishReason ||
        responseChunk.toolCalls ||
        responseChunk.usage
      ) {
        yield responseChunk;
      }
    }
  }

  private handleNonStreamResponse(response: any): LLMResponseChunk {
    const choice = response.choices?.[0];
    if (!choice || !choice.message)
      throw new Error("Invalid response from LLM API");

    const message = choice.message;
    const result: LLMResponseChunk = {
      content: message.content || null,
      reasoningContent: (message as any).reasoning_content || null,
      finishReason: choice.finish_reason || null,
      toolCalls: undefined,
      usage: null,
    };

    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    // 正确映射工具调用到 toolCalls 字段
    if (message.tool_calls) {
      this.logger.debug(`非流式响应检测到 ${message.tool_calls.length} 个工具调用`);
      result.toolCalls = message.tool_calls.map((tc: any): ToolCallItem => ({
        id: tc.id,
        index: tc.index,
        type: tc.type || "function",
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      }));
      this.logger.debug(`工具调用详情: ${JSON.stringify(result.toolCalls.map(tc => ({ name: tc.name, hasArgs: !!tc.arguments })))}`);
    }

    return result;
  }

  private handleError(error: any, isStream: boolean) {
    this.logger.error(
      `LLM API error (${isStream ? "stream" : "non-stream"}):`,
      error,
    );

    // 记录详细的错误信息
    if (error instanceof APIError) {
      this.logger.error(`API Error Details:`, {
        status: error.status,
        message: error.message,
        code: error.code,
        param: error.param,
        type: error.type,
        headers: error.headers,
      });
      throw new Error(`LLM API Error: ${error.status} - ${error.message}`);
    }
    if (error.name === "AbortError") throw new Error("LLM request aborted");
    if (error.message.includes("timeout"))
      throw new Error("LLM request timed out (60s)");
    throw error;
  }

  private cleanup(response: any) {
    if (response && typeof response.controller?.abort === "function") {
      try {
        response.controller.abort();
      } catch (e) {
        /* ignore */
      }
    }
  }
}
