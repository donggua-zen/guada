import { Injectable, Logger } from "@nestjs/common";
import { OpenAI } from "openai";
import { IProtocolAdapter } from "./base.adapter";
import { ModelCapabilityService } from '../model-capability.service';
import {
  LLMCompletionParams,
  StreamChunk,
  StreamUsage,
} from "../types/llm.types";
import type { Message, ContentBlock } from "../../../common/types/conversation.types";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";
import { insecureFetch } from "../utils/tls.util";
import { applyJsonMergePatch } from "../thinking/json-merge-patch";
import { attachmentToPart, fileBlockToText } from "../utils/attachment.util";
import { assertNoImageContent } from "../utils/content.util";
import { StreamBlockTracker } from "../utils/block-lifecycle.util";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../utils/stream-timeout.util";
import {
  UpstreamRateLimitError,
  UpstreamNetworkError,
  UpstreamRequestError,
} from "../utils/upstream-errors";
import { getRetryAfterFromError } from "../utils/retry.util";
import {
  ProviderConfig,
  ConnectionTestResult,
  RemoteModel,
} from "../types/provider.types";
import { resolveEffectiveThinkingCompat } from "./openai.adapter";

/**
 * OpenAI Responses API 适配器
 *
 * 基于 OpenAI Responses API（beta）实现，采用无状态设计，每次调用创建新客户端实例
 * 与 Chat Completions API 相比，Responses API 使用不同的事件格式和数据结构
 * 支持推理内容流式输出、工具调用增量累积等高级特性
 *
 * Provider quirks（本协议私有的兼容细节，新增兼容时在此登记）：
 * 1. 扁平 item 数组输入：message / function_call / function_call_output 三种 item，
 *    tool 结果经 call_id 关联（无 role=tool 概念）。
 * 2. 单个 input_text 时 content 收敛为字符串；空内容且无 function_call 的消息跳过。
 * 3. usage 兼容 prompt_cache_hit_tokens（与 openai adapter 同口径）。
 * 4. 图片：input_image 支持 data URL 与远程 URL。
 *
 * 职责边界：内容归一化（图片投影/reasoning 策略）在 L1 管线完成；本文件只做
 * wire 映射 + fail-loud 断言（见 docs/message-pipeline-normalization-plan.md）。
 */
// @Injectable() 不可省：emitDecoratorMetadata 只在类上有装饰器时才产出
// design:paramtypes，否则 Nest 会以零参数构造，capability 静默为 undefined
@Injectable()
export class OpenAIResponseAdapter implements IProtocolAdapter {
  readonly protocol = "openai-response";

  constructor(private readonly capability: ModelCapabilityService) {}

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
      this.logger.warn(
        `Failed to sync remote models (API may not support /v1/models): ${error.message}`,
      );
      return [];
    }
  }

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<StreamChunk> {
    // fail-loud 最终防线：L1 管线绕过时，图片不得静默发给纯文本模型
    assertNoImageContent(
      params.messages,
      params.modelCapabilities?.supportsImageInput,
      this.protocol,
      params.model,
    );

    const client = this.createClient(params.providerConfig);
    const formattedInput = await this.formatInput(params.messages, params.system);
    const requestParams = this.buildRequestParam(params, formattedInput);

    // 条目 thinkingEffortsPatch：拼装完成后整体打 patch（RFC 7386，patch 优先）
    const finalRequestParams = params.thinkingPatch
      ? applyJsonMergePatch(requestParams, params.thinkingPatch)
      : requestParams;

    const requestTimeout = params.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    let response: any = null;

    try {
      // 单次尝试，重试由 AgentEngine 统一处理
      response = await client.responses.create(finalRequestParams, {
        signal: params.abortSignal,
        timeout: requestTimeout,
      });

      if (params.stream) {
        yield* this.handleStreamResponse(response);
      } else {
        yield* this.handleNonStreamResponse(response);
      }
    } catch (error) {
      this.logger.error(
        `LLM Responses API error (${params.stream ? "stream" : "non-stream"}):`,
        error,
      );
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
      fetch: insecureFetch,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 0, // 禁用 SDK 内置重试，由 AgentEngine 统一处理重试
    });
  }

  /**
   * 将内部三层消息格式转换为 Responses API 输入格式
   *
   * Responses API 使用扁平化的 item 数组结构，支持 message、function_call、function_call_output 三种类型
   * 工具调用结果通过 function_call_output 类型传递，需要关联 call_id
   * 多模态内容（文本、图片）统一映射为 input_text 和 input_image 类型
   */
  private async formatInput(messages: Message[], system?: string): Promise<any[]> {
    const items: any[] = [];
    // Responses API：system 以首条 message item 形式出现（无 system 时不插）
    if (system) {
      items.push({ type: "message", role: "system", content: system });
    }

    for (const msg of messages) {
      // tool 结果消息（source.kind === 'tool'）→ function_call_output
      if (msg.source.kind === "tool") {
        const tr = msg.content.find(
          (b): b is Extract<ContentBlock, { type: "tool-result" }> =>
            b.type === "tool-result",
        );
        items.push({
          type: "function_call_output",
          call_id: msg.source.toolCallId,
          output: tr?.content ?? "",
        });
        continue;
      }

      const baseMessage: any = {
        type: "message",
        role: msg.role === "assistant" ? "assistant" : "user",
      };

      // 按 ContentBlock 块拆分 content
      const contentParts: any[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text) contentParts.push({ type: "input_text", text: block.text });
        } else if (block.type === "image") {
          // 统一助手解析字节（本地文件带 LRU 缓存），此处只做协议映射；
          // 传整个附件对象：attachmentToPart 按 refType 分派物理路径。
          const part = await attachmentToPart(
            block.attachment,
            block.attachment.mediaType,
          );
          if (part?.kind === "base64") {
            contentParts.push({
              type: "input_image",
              image_url: `data:${part.mimeType};base64,${part.base64}`,
              detail: "auto",
            });
          } else if (part?.kind === "url") {
            contentParts.push({
              type: "input_image",
              image_url: part.url,
              detail: "auto",
            });
          }
        } else if (block.type === "file") {
          contentParts.push({
            type: "input_text",
            text: fileBlockToText(block.attachment),
          });
        }
      }
      if (contentParts.length === 1 && contentParts[0].type === "input_text") {
        baseMessage.content = contentParts[0].text;
      } else if (contentParts.length > 0) {
        baseMessage.content = contentParts;
      } else {
        baseMessage.content = "";
      }

      // tool-call 块 → function_call items
      const toolCalls = msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool-call" }> =>
          b.type === "tool-call",
      );

      // 跳过空内容且无工具调用的消息
      if (baseMessage.content === "" && toolCalls.length === 0) {
        continue;
      }

      if (baseMessage.content !== "" || toolCalls.length === 0) {
        items.push(baseMessage);
      }

      for (const tc of toolCalls) {
        items.push({
          type: "function_call",
          call_id: tc.toolCallId,
          name: tc.name,
          arguments: tc.arguments,
        });
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

    // 处理思考强度（对齐 DSH/pi-ai 的 openai-responses 分派）：
    // - 强度档（非 none/on）→ reasoning:{effort: 映射值 ?? 档位名}
    // - 关闭（none，且模型声明可关）→ reasoning:{effort: off 映射值 ?? 'none'}
    //   Responses 协议没有独立开关字段，"关闭"就是一个 effort 值；
    //   不提供 thinkingFormat（DSH 的 responses 门控不含它）。
    // 拼法表达式接管时（thinkingPatchReplacesFormat）跳过内置写入，完全由表达式输出决定
    const compat = resolveEffectiveThinkingCompat(params.providerConfig);
    if (!params.thinkingPatchReplacesFormat) {
      if (params.thinkingEffort === 'none') {
        const off = this.capability.resolveThinkingOff(
          params.providerConfig?.id,
          params.model,
        );
        if (off.supported) {
          requestParams.reasoning = { effort: off.wire ?? 'none' };
        }
      } else if (
        params.thinkingEffort &&
        params.thinkingEffort !== 'on'
      ) {
        // OpenAI Responses API 使用 reasoning.effort 参数；
        // wire 值向能力服务查（缺省=档位名）
        requestParams.reasoning = {
          effort:
            this.capability.resolveThinkingWireValue(
              params.providerConfig?.id,
              params.model,
              params.thinkingEffort,
            ) ?? params.thinkingEffort,
        };
      }
      if (compat.includeEncryptedReasoning) {
        requestParams.include = ["reasoning.encrypted_content"];
      }
    }

    return requestParams;
  }

  /**
   * 将内部扁平化工具定义转换为 OpenAI Responses API 格式
   */
  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * 处理流式响应事件流 → 规范 StreamChunk 词表
   *
   * Responses API 的事件流映射：
   * - output_text.delta → text_delta；reasoning_*.delta → reasoning_delta
   * - output_item.added(function_call) 记录元信息并开块（id/name 首发携带）
   * - function_call_arguments.delta → tool_call_delta（火山引擎等厂商 delta 不带 call_id/name，靠 item_id 关联）
   * - completed/failed 收尾统一补发 block_end* → usage → finish
   */
  private async *handleStreamResponse(
    response: any,
  ): AsyncGenerator<StreamChunk> {
    // 跟踪工具调用元信息，用于关联增量参数与具体工具（item_id → 分配的输出 index）
    const toolCallInfoMap = new Map<string, { callId: string; name: string; index: number }>();
    let toolCallCounter = 0;
    const tracker = new StreamBlockTracker();
    let pendingFinish: string | null = null;
    let pendingUsage: StreamUsage | null = null;

    for await (const event of response) {
      switch (event.type) {
        case "response.output_text.delta":
          for (const c of tracker.textDelta(event.delta)) yield c;
          continue;

        case "response.output_text.done":
        case "response.reasoning_text.done":
        case "response.reasoning_summary_text.done":
        case "response.function_call_arguments.done":
          continue;

        case "response.reasoning_text.delta":
        case "response.reasoning_summary_text.delta":
          for (const c of tracker.reasoningDelta(event.delta)) yield c;
          continue;

        case "response.output_item.added":
          // 记录工具调用元信息并立即开块（id/name 首发携带）
          if (event.item?.type === "function_call") {
            const index = toolCallCounter++;
            const info = { callId: event.item.call_id, name: event.item.name, index };
            toolCallInfoMap.set(event.item.id, info);
            for (const c of tracker.toolCallDelta(index, {
              toolCallId: info.callId,
              name: info.name,
            })) {
              yield c;
            }
          }
          continue;

        case "response.function_call_arguments.delta":
          {
            const info = toolCallInfoMap.get(event.item_id);
            if (!info) continue;
            for (const c of tracker.toolCallDelta(info.index, {
              argumentsDelta: event.delta,
            })) {
              yield c;
            }
          }
          continue;

        case "response.completed":
          pendingFinish = "stop";
          if (event.response?.usage) {
            pendingUsage = {
              promptTokens: event.response.usage.input_tokens,
              completionTokens: event.response.usage.output_tokens,
              totalTokens: event.response.usage.total_tokens,
              cachedTokens: extractOpenAICachedTokens(event.response.usage),
            };
          }
          continue;

        case "response.failed":
          this.logger.error(`Response failed: ${event.error?.message}`);
          pendingFinish = "error";
          continue;

        default:
          continue;
      }
    }

    // 收尾：先闭所有块，再 usage，最后 finish
    for (const c of tracker.closeAll()) yield c;
    if (pendingUsage) {
      yield { type: "usage", usage: pendingUsage };
    }
    yield { type: "finish", finishReason: pendingFinish || "stop" };
  }

  /**
   * 处理非流式响应 → 同一词表的 chunk 数组（block_end* → usage → finish）
   *
   * 从 response.output 数组中提取文本、工具调用和推理内容
   */
  private *handleNonStreamResponse(response: any): Generator<StreamChunk> {
    if (!response || !response.output) {
      throw new Error("Invalid response from LLM Responses API");
    }

    let index = 0;
    const outputs = response.output || [];
    for (const output of outputs) {
      if (output.type === "message") {
        const content = output.content?.[0];
        if (content?.type === "output_text") {
          yield {
            type: "block_end",
            index: index++,
            block: { type: "text", text: content.text },
          };
        }
      } else if (output.type === "function_call") {
        yield {
          type: "block_end",
          index: index++,
          block: {
            type: "tool-call",
            toolCallId: output.call_id || output.id,
            name: output.name,
            arguments: output.arguments || "{}",
          },
        };
      } else if (output.type === "reasoning") {
        const summary =
          typeof output.summary === "string"
            ? output.summary
            : Array.isArray(output.summary)
              ? output.summary.map((s: any) => s?.text || "").join("")
              : output.summary;
        if (summary) {
          yield {
            type: "block_end",
            index: index++,
            block: { type: "reasoning", summary },
          };
        }
      }
    }

    if (response.usage) {
      yield {
        type: "usage",
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
          cachedTokens: extractOpenAICachedTokens(response.usage),
        },
      };
    }
    yield { type: "finish", finishReason: "stop" };
  }

  /**
   * 错误处理与转换
   */
  private handleError(
    error: any,
    isStream: boolean,
  ): never {
    this.logger.error(
      `LLM Responses API error (${isStream ? "stream" : "non-stream"}):`,
      error,
    );

    const status = error.status;
    const msg = `LLM Responses API Error: ${status} - ${error.message}`;

    // 429 → UpstreamRateLimitError（可重试）
    if (status === 429) {
      throw new UpstreamRateLimitError(msg, error, getRetryAfterFromError(error));
    }
    // 5xx → UpstreamNetworkError（可重试）
    if (status >= 500 && status < 600) {
      throw new UpstreamNetworkError(msg, error, status);
    }
    // 4xx → UpstreamRequestError（不可重试）
    if (status >= 400 && status < 500) {
      throw new UpstreamRequestError(msg, error, status);
    }

    // 其他错误原样抛出
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

/**
 * 从 OpenAI 协议 usage 对象中提取缓存 token 字段
 * 兼容 OpenAI 官方 (prompt_tokens_details.cached_tokens) 和 DeepSeek (prompt_cache_hit_tokens) 风格
 */
function extractOpenAICachedTokens(
  rawUsage: any,
): { read?: number; missed?: number } | undefined {
  const cachedTokens: { read?: number; missed?: number } = {};

  // DeepSeek 风格: usage.prompt_cache_hit_tokens (flat in usage)
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
