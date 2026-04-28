import { Injectable, Logger } from "@nestjs/common";
import { OpenAI, APIError } from "openai";
import { LLMAdapter } from "./base.adapter";
import { PROVIDER_TEMPLATES } from "../../../constants/provider-templates";
import {
  MessageRecord,
  InternalToolDefinition,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";

@Injectable()
export class OpenAIAdapter implements LLMAdapter {
  readonly protocol = "openai";
  private readonly logger = new Logger(OpenAIAdapter.name);

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const client = this.createClient(params.providerConfig);
    const filterMessages = this.formatMessages(params.messages);
    const requestParams = this.buildRequestParams(params, filterMessages);

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
      this.handleError(error, params.stream);
    } finally {
      this.cleanup(response);
    }
  }

  private createClient(providerConfig: any) {
    return new OpenAI({
      baseURL: providerConfig?.apiUrl || process.env.OPENAI_BASE_URL,
      apiKey:
        providerConfig?.apiKey ||
        process.env.OPENAI_API_KEY ||
        "sk-placeholder",
    });
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

  private buildRequestParams(params: any, filterMessages: any[]) {
    const requestParams: any = {
      model: params.model,
      messages: filterMessages,
      stream: params.stream,
      timeout: params.timeout,
    };

    // 动态注入供应商私有参数
    const providerId = params.providerConfig?.provider;
    if (providerId && providerId !== "custom") {
      const template = PROVIDER_TEMPLATES.find((t) => t.id === providerId);
      const attrs = template?.attributes?.[this.protocol] || {};

      // 统一处理 thinking 配置（所有提供商都使用相同的接口）
      if (attrs.thinking?.get && params.thinkingEnabled !== undefined) {
        const thinkingConfig = attrs.thinking.get(params.thinkingEnabled);
        Object.assign(requestParams, thinkingConfig);
      }
    }

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

    // 调试日志：记录最终请求参数（隐藏敏感信息）
    this.logger.debug(`LLM Request params for model ${params.model}:`, {
      model: requestParams.model,
      messages_count: requestParams.messages.length,
      stream: requestParams.stream,
      temperature: requestParams.temperature,
      top_p: requestParams.top_p,
      max_tokens: requestParams.max_tokens,
      tools_count: requestParams.tools?.length || 0,
      has_thinking_enabled: params.thinkingEnabled,
    });

    return requestParams;
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

  private handleNonStreamResponse(response: any) {
    const choice = response.choices?.[0];
    if (!choice || !choice.message)
      throw new Error("Invalid response from LLM API");

    const message = choice.message;
    const result: any = {
      content: message.content || null,
      reasoningContent: (message as any).reasoning_content || null,
      finishReason: choice.finish_reason || null,
      additionalKwargs: {},
      usage: null,
    };

    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    if (message.tool_calls) {
      result.additionalKwargs.toolCalls = message.tool_calls.map((tc: any) => ({
        id: tc.id,
        index: tc.index,
        type: tc.type || "function",
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      })) as ToolCallItem[];
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
