import { Logger } from "@nestjs/common";
import { OpenAI, APIError } from "openai";
import { IProtocolAdapter } from "./base.adapter";
import { ProviderConfig, ConnectionTestResult, RemoteModel } from "../types/provider.types";
import {
  MessageRecord,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";

/**
 * 扩展 OpenAI 客户端，重写 makeStatusError 以保留完整 HTTP 响应体。
 * OpenAI SDK 默认只保存 errJSON['error']，丢失了无 error 包裹的响应体。
 */
class BodyPreservingOpenAI extends OpenAI {
  protected makeStatusError(
    status: number | undefined,
    error: Object | undefined,
    message: string | undefined,
    headers: any,
  ): APIError {
    const err = super.makeStatusError(status, error, message, headers);
    // error 是完整的 errJSON（与 SDK 内部 APIError.generate 的第二个参数相同）
    // 保存到 __rawBody 供 extractErrorDetail 提取
    if (error) {
      (err as any).__rawBody = typeof error === "object" ? JSON.stringify(error) : String(error);
    }
    return err;
  }
}

export class OpenAIAdapter implements IProtocolAdapter {
  readonly protocol = "openai";
  private readonly logger = new Logger(OpenAIAdapter.name);

  /**
   * 创建 OpenAI API 客户端（可被子类覆盖）
   */
  protected createClient(config: ProviderConfig): OpenAI {
    const clientOptions: any = {
      baseURL: config.apiUrl,
      apiKey: config.apiKey,
    };

    // 支持自定义请求头
    if (config.headers && Object.keys(config.headers).length > 0) {
      clientOptions.defaultHeaders = {
        ...config.headers,
      };
    }

    return new BodyPreservingOpenAI(clientOptions);
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
   * 从 OpenAI 兼容 API 同步模型列表
   * 部分第三方服务可能不支持 /v1/models，此时返回空列表
   */
  async syncRemoteModels(config: ProviderConfig): Promise<RemoteModel[]> {
    try {
      const client = this.createClient(config);
      const response = await client.models.list();
      return response.data.map((model) => ({
        id: model.id,
        created: model.created,
        owned_by: model.owned_by,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to sync remote models (API may not support /v1/models): ${error.message}`);
      return [];
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
    if (
      params.thinkingEffort &&
      ["minimum", "low", "medium", "high", "xhigh"].includes(
        params.thinkingEffort,
      )
    ) {
      // OpenAI 使用 reasoning_effort 参数
      requestParams.reasoning_effort = params.thinkingEffort;
    }

    // 流式模式下请求返回 usage 信息（OpenAI 标准要求显式声明）
    // 多数供应商默认返回，但 OpenAI / Azure OpenAI 严格遵循此标准
    if (params.stream) {
      requestParams.stream_options = { include_usage: true };
    }

    return requestParams;
  }

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const client = this.createClient(params.providerConfig);
    const filterMessages = this.formatMessages(params.messages);

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
      thinkingEffort: params.thinkingEffort,
    });

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
  private convertTools(tools: ToolDefinition[]): any[] {
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
        type: "text",
        content: delta?.content || null,
        reasoningContent: (delta as any)?.reasoning_content || null,
        finishReason: choice.finish_reason || null,
        toolCalls: undefined,
        usage: null,
      };
      if ((delta as any)?.reasoning_content) responseChunk.type = "think";
      if (choice.finish_reason) responseChunk.type = "finish";

      if ((chunk as any).usage) {
        const rawUsage = (chunk as any).usage;
        responseChunk.usage = {
          promptTokens: rawUsage.prompt_tokens,
          completionTokens: rawUsage.completion_tokens,
          totalTokens: rawUsage.total_tokens,
          cachedTokens: extractOpenAICachedTokens(rawUsage),
        };
      }

      if (delta?.tool_calls) {
        responseChunk.type = "tool_call";
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
    const hasToolCalls = !!message.tool_calls;
    const hasReasoning = !!(message as any).reasoning_content;
    const result: LLMResponseChunk = {
      type: hasToolCalls ? "tool_call" : hasReasoning ? "think" : "finish",
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
        cachedTokens: extractOpenAICachedTokens(response.usage),
      };
    }

    // 正确映射工具调用到 toolCalls 字段
    if (message.tool_calls) {
      this.logger.debug(
        `非流式响应检测到 ${message.tool_calls.length} 个工具调用`,
      );
      result.toolCalls = message.tool_calls.map(
        (tc: any): ToolCallItem => ({
          id: tc.id,
          index: tc.index,
          type: tc.type || "function",
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        }),
      );
      this.logger.debug(
        `工具调用详情: ${JSON.stringify(result.toolCalls.map((tc) => ({ name: tc.name, hasArgs: !!tc.arguments })))}`,
      );
    }

    return result;
  }

  private handleError(error: any, isStream: boolean) {
    // 提取并记录详细的错误信息，避免 NestJS Logger 序列化特殊对象时丢失内容
    const errorDetail = this.extractErrorDetail(error);
    this.logger.error(
      `LLM API error (${isStream ? "stream" : "non-stream"}): ${errorDetail}`,
    );

    // 额外输出完整错误对象的所有自有属性（部分供应商返回非标准格式，如 body 不在标准字段中）
    try {
      const extraFields: Record<string, any> = {};
      for (const key of Object.getOwnPropertyNames(error)) {
        if (!["stack", "message", "name", "status", "code", "type"].includes(key)) {
          const val = error[key];
          if (val !== undefined && val !== null) {
            extraFields[key] = typeof val === "object" ? val : String(val);
          }
        }
      }
      if (Object.keys(extraFields).length > 0) {
        this.logger.error(`LLM API error extra: ${JSON.stringify(extraFields).substring(0, 2000)}`);
      }
    } catch { /* ignore serialization errors */ }

    if (error instanceof APIError) {
      const rawBody = (error as any).__rawBody;
      // 如果 SDK 显示 "(no body)" 但实际有 body，替换消息
      if (rawBody && error.message?.includes("(no body)")) {
        throw new Error(`LLM API Error: ${error.status} - body=${rawBody.substring(0, 500)}`);
      }
      throw new Error(`LLM API Error: ${error.status} - ${error.message}`);
    }
    if (error.name === "AbortError") throw new Error("LLM request aborted");
    if (error.message?.includes("timeout"))
      throw new Error("LLM request timed out (60s)");
    throw error;
  }

  /**
   * 提取错误的详细信息字符串，处理各种错误类型
   */
  private extractErrorDetail(error: any): string {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;

    const parts: string[] = [];
    if (error.status) parts.push(`status=${error.status}`);
    if (error.code) parts.push(`code=${error.code}`);
    if (error.type) parts.push(`type=${error.type}`);
    if (error.message) parts.push(`message=${error.message}`);
    if (error.name && error.name !== "Error") parts.push(`name=${error.name}`);

    // 提取原始 HTTP 响应体（通过 BodyPreservingOpenAI.makeStatusError 注入）
    if ((error as any).__rawBody) {
      parts.push(`body=${(error as any).__rawBody}`);
    }

    // 提取 request_id（OpenAI SDK 的标准字段）
    if (error.request_id) {
      parts.push(`request_id=${error.request_id}`);
    }

    // 尝试提取 stack，防止序列化失败
    if (error.stack) {
      try {
        const stackStr = String(error.stack);
        parts.push(`stack=${stackStr.substring(0, 500)}`);
      } catch {
        /* 忽略 stack 提取失败 */
      }
    }

    // 如果有额外字段，尝试 JSON 序列化
    if (Object.keys(error).length > 0) {
      try {
        const extra = { ...error };
        delete extra.stack;
        delete extra.message;
        delete extra.name;
        delete extra.status;
        delete extra.code;
        delete extra.type;
        if (Object.keys(extra).length > 0) {
          parts.push(`extra=${JSON.stringify(extra).substring(0, 500)}`);
        }
      } catch {
        /* 忽略序列化失败 */
      }
    }

    return parts.length > 0 ? parts.join(" | ") : String(error);
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

/**
 * 从 OpenAI 协议 usage 对象中提取缓存 token 字段
 * 兼容两种格式：
 * - OpenAI 官方: usage.prompt_tokens_details.cached_tokens
 * - DeepSeek 风格: usage.prompt_cache_hit_tokens / prompt_cache_miss_tokens
 */
function extractOpenAICachedTokens(rawUsage: any): { read?: number; missed?: number } | undefined {
  const cachedTokens: { read?: number; missed?: number } = {};

  // DeepSeek 风格: usage.prompt_cache_hit_tokens (flat in usage)
  // 优先使用此格式，若存在则不再检查 prompt_tokens_details
  if (rawUsage.prompt_cache_hit_tokens != null) {
    cachedTokens.read = Number(rawUsage.prompt_cache_hit_tokens);
    if (rawUsage.prompt_cache_miss_tokens != null) {
      cachedTokens.missed = Number(rawUsage.prompt_cache_miss_tokens);
    }
  } else {
    // OpenAI 官方格式: usage.prompt_tokens_details.cached_tokens
    const details = rawUsage.prompt_tokens_details;
    if (details?.cached_tokens != null) {
      cachedTokens.read = Number(details.cached_tokens);
    }
  }

  return cachedTokens.read !== undefined || cachedTokens.missed !== undefined
    ? cachedTokens
    : undefined;
}
