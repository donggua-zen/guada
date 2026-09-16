/**
 * OpenAI Chat Completions 协议适配器。
 *
 * Provider quirks（本协议私有的兼容细节，新增兼容时在此登记）：
 * 1. reasoning 块 ↔ `reasoning_content` 字段（DeepSeek 系）：请求侧 assistant 消息持续回传，
 *    响应侧从 delta.reasoning_content 解析——一旦输出 reasoning 须跨轮持续回传，不可丢弃。
 * 2. usage 兼容 `prompt_cache_hit_tokens`（DeepSeek 缓存命中计费口径）。
 * 3. 流式 usage 需显式 `stream_options.include_usage`（OpenAI/Azure 严格遵循标准）。
 * 4. 思考强度映射 `reasoning_effort`；'none' 时需显式 thinking disabled。
 *    → 已收敛为 thinkingFormat 分发（见 applyThinkingFormat，对齐 DSH/pi-ai
 *    的 11 种 wire 拼法），新增兼容拼法在此登记枚举。
 *
 * 职责边界：内容归一化（图片投影/reasoning 策略）在 L1 管线完成；本文件只做
 * wire 映射 + fail-loud 断言（见 docs/message-pipeline-normalization-plan.md）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { OpenAI, APIError } from "openai";
import * as path from "path";
import * as fs from "fs";
import { IProtocolAdapter } from "./base.adapter";
import { ModelCapabilityService } from "../model-capability.service";
import {
  ProviderConfig,
  ConnectionTestResult,
  RemoteModel,
} from "../types/provider.types";
import {
  LLMCompletionParams,
  StreamChunk,
  StreamUsage,
} from "../types/llm.types";
import type { Message, ContentBlock } from "../../../common/types/conversation.types";
import { attachmentToPart, fileBlockToText } from "../utils/attachment.util";
import { assertNoImageContent } from "../utils/content.util";
import { StreamBlockTracker } from "../utils/block-lifecycle.util";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";
import { insecureFetch } from "../utils/tls.util";
import {
  UpstreamRateLimitError,
  UpstreamNetworkError,
  UpstreamRequestError,
} from "../utils/upstream-errors";
import { getRetryAfterFromError } from "../utils/retry.util";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../utils/stream-timeout.util";
import {
  ResolvedThinkingCompat,
  ThinkingFormat,
  defaultSupportsReasoningEffort,
} from "../thinking/thinking-vocabulary";

/**
 * 思考档位 → wire 请求体拼法（对齐 DSH/pi-ai 的 thinkingFormat 分派）。
 *
 * format/supportsReasoningEffort 由 store 的 resolveThinkingCompat 解析
 * （模型条目 compat > 实例 compat > 类型卡 > format 默认），随 providerConfig
 * 传入；本文件只做分派，不另起解析链。
 */

/** 从 providerConfig 取生效 compat（非 store 视图来源时按 format 默认兜底） */
export function resolveEffectiveThinkingCompat(
  providerConfig: any,
): ResolvedThinkingCompat {
  const raw = providerConfig?.compat;
  const thinkingFormat: ThinkingFormat = raw?.thinkingFormat ?? "openai";
  const supportsReasoningEffort =
    raw?.supportsReasoningEffort ?? defaultSupportsReasoningEffort(thinkingFormat);
  return { ...(raw ?? {}), thinkingFormat, supportsReasoningEffort };
}

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
      (err as any).__rawBody =
        typeof error === "object" ? JSON.stringify(error) : String(error);
    }
    return err;
  }
}

// @Injectable() 不可省：emitDecoratorMetadata 只在类上有装饰器时才产出
// design:paramtypes，否则 Nest 会以零参数构造，capability 静默为 undefined
@Injectable()
export class OpenAIAdapter implements IProtocolAdapter {
  readonly protocol = "openai";
  private readonly logger = new Logger(OpenAIAdapter.name);

  constructor(private readonly capability: ModelCapabilityService) {}

  /**
   * 创建 OpenAI API 客户端（可被子类覆盖）
   *
   * 设置默认请求超时为 10 分钟（与 OpenAI SDK 默认值一致）。
   * 注意：SDK 的 timeout 是整个请求的硬截止时间（包括流式传输）。
   * 流式 idle 超时由 LLMService 统一处理。
   */
  protected createClient(config: ProviderConfig): OpenAI {
    const clientOptions: any = {
      baseURL: config.apiUrl,
      apiKey: config.apiKey,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 0, // 禁用 SDK 内置重试，由 AgentEngine 统一处理重试
    };

    // 支持自定义请求头
    if (config.headers && Object.keys(config.headers).length > 0) {
      clientOptions.defaultHeaders = {
        ...config.headers,
      };
    }

    clientOptions.fetch = insecureFetch;

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
      this.logger.warn(
        `Failed to sync remote models (API may not support /v1/models): ${error.message}`,
      );
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

    // 处理思考强度：按 thinkingFormat 将中立档位翻译为各家 wire 拼法
    // （逐行对齐 DSH/pi-ai 的 openai-completions 分派；format/开关由 store 解析）
    // 映射值向能力服务查（档位→vendor 词汇映射）；未映射时各分支自行回退档位名
    const mappedEffort = this.capability.resolveThinkingWireValue(
      params.providerConfig?.id,
      params.model,
      params.thinkingEffort,
    );
    // 关闭态信息：菜单含 none 才可关；wire = thinkingEffortsMap.none 的映射值
    const off = this.capability.resolveThinkingOff(
      params.providerConfig?.id,
      params.model,
    );
    this.applyThinkingFormat(
      requestParams,
      params.thinkingEffort,
      params.providerConfig,
      mappedEffort,
      off,
    );

    // 流式模式下请求返回 usage 信息（OpenAI 标准要求显式声明）
    // 多数供应商默认返回，但 OpenAI / Azure OpenAI 严格遵循此标准
    if (params.stream) {
      requestParams.stream_options = { include_usage: true };
    }
    return requestParams;
  }

  /**
   * 按 thinkingFormat 将中立档位翻译为各家 wire 拼法（逐行对齐 pi-ai
   * openai-completions 的分派；`thinkingFormat` 只编码开关字段形状，
   * 强度值一律走 reasoning_effort / 嵌套 effort，是否上 wire 由
   * supportsReasoningEffort 门控；档位命名差异由 thinkingEffortsMap 承担）。
   *
   * @param level 'none'（关闭）| 'on'（legacy 开关档）| 强度档
   * @param mappedValue 档位的映射字符串（thinkingEffortsMap 查表结果，未映射为
   *   undefined——ant-ling 只发映射值）；多数分支回退档位名
   * @param off 菜单含 none 才可关；wire = thinkingEffortsMap.none 的映射值
   */
  protected applyThinkingFormat(
    requestParams: any,
    level: string | undefined,
    providerConfig: any,
    mappedValue?: string,
    off?: { supported: boolean; wire?: string },
  ): void {
    if (level === undefined) return;
    const compat = resolveEffectiveThinkingCompat(providerConfig);
    const format = compat.thinkingFormat;
    const supportsEffort = compat.supportsReasoningEffort;
    const isNone = level === 'none';
    const isOn = level === 'on';
    const enable = !isNone; // on（legacy）按"开启"处理
    // 多数 format：未映射时 wire 值 = 档位名（对齐 pi-ai 的 `?? level` 回退）
    const wireValue = mappedValue ?? level;

    // 强度值上 wire 的统一门控：仅真实强度档 + compat 允许
    const sendEffort = (value: string | undefined) => {
      if (!enable || isOn || !supportsEffort) return;
      if (typeof value === 'string' && value) requestParams.reasoning_effort = value;
    };

    switch (format) {
      case 'zai': {
        // 智谱：只认开关（supportsEffort 默认 false）；clear_thinking=false 保留历史思考
        requestParams.thinking = enable
          ? { type: 'enabled', clear_thinking: false }
          : { type: 'disabled' };
        sendEffort(wireValue);
        break;
      }
      case 'qwen': {
        // 百炼/硅基/千帆：enable_thinking 布尔承载，强度可选叠加
        requestParams.enable_thinking = enable;
        sendEffort(wireValue);
        break;
      }
      case 'qwen-chat-template': {
        requestParams.chat_template_kwargs = {
          enable_thinking: enable,
          preserve_thinking: true,
        };
        break;
      }
      case 'chat-template': {
        // 模板参数完全由 compat.chatTemplateKwargs 声明
        if (compat.chatTemplateKwargs && Object.keys(compat.chatTemplateKwargs).length > 0) {
          requestParams.chat_template_kwargs = { ...compat.chatTemplateKwargs };
        }
        break;
      }
      case 'baseten': {
        if (compat.chatTemplateArgs && Object.keys(compat.chatTemplateArgs).length > 0) {
          requestParams.chat_template_args = { ...compat.chatTemplateArgs };
        }
        if (supportsEffort) {
          // 强度档用映射值；关闭用 off 映射（缺省不发）
          const mapped = enable && !isOn ? wireValue : off?.wire;
          if (typeof mapped === 'string' && mapped) {
            requestParams.reasoning_effort = mapped;
          }
        }
        break;
      }
      case 'deepseek': {
        // 开关 + 强度并存；关闭仅当模型声明可关（菜单含 none）
        if (enable) {
          requestParams.thinking = { type: 'enabled' };
        } else if (off?.supported) {
          requestParams.thinking = { type: 'disabled' };
        }
        sendEffort(wireValue);
        break;
      }
      case 'openrouter': {
        // 嵌套 reasoning 对象；关闭也是 effort 值（off 映射，缺省 'none'）
        if (enable) {
          requestParams.reasoning = { effort: wireValue };
        } else if (off?.supported) {
          requestParams.reasoning = { effort: off.wire ?? 'none' };
        }
        break;
      }
      case 'ant-ling': {
        // 仅映射过的档位才发（对齐 pi-ai：`map[level]` 是 string 才发）；关闭不发
        if (enable && !isOn && typeof mappedValue === 'string' && mappedValue) {
          requestParams.reasoning = { effort: mappedValue };
        }
        break;
      }
      case 'together': {
        // 开关嵌套、强度扁平
        requestParams.reasoning = { enabled: enable };
        sendEffort(wireValue);
        break;
      }
      case 'string-thinking': {
        // thinking 是纯字符串（不是对象）
        if (enable) {
          requestParams.thinking = wireValue;
        } else if (off?.supported) {
          requestParams.thinking = off.wire ?? 'none';
        }
        break;
      }
      case 'openai':
      default: {
        // OpenAI 兼容默认：强度直传 reasoning_effort；
        // 关闭 = 参数缺席，除非模型把 none 映射到了具体值（如 'none'）
        if (enable && !isOn && supportsEffort) {
          if (typeof wireValue === 'string' && wireValue) {
            requestParams.reasoning_effort = wireValue;
          }
        } else if (isNone && typeof off?.wire === 'string' && off.wire) {
          requestParams.reasoning_effort = off.wire;
        }
        // on / 未知值：不设置，让模型使用默认行为
        break;
      }
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
    const filterMessages = await this.formatMessages(params.messages, params.system);

    // 构建最终请求参数
    const requestParams = this.buildRequestParam({
      model: params.model,
      messages: filterMessages,
      stream: params.stream,
      temperature: params.temperature,
      topP: params.topP,
      frequencyPenalty: params.frequencyPenalty,
      maxTokens: params.maxTokens,
      tools: params.tools,
      extraBody: params.extraBody,
      thinkingEffort: params.thinkingEffort,
      providerConfig: params.providerConfig,
    });

    const requestTimeout = params.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    let response: any = null;

    try {
      // 单次尝试，重试由 AgentEngine 统一处理
      response = await client.chat.completions.create(requestParams, {
        signal: params.abortSignal,
        timeout: requestTimeout,
      });

      if (params.stream) {
        yield* this.handleStreamResponse(response);
      } else {
        yield* this.handleNonStreamResponse(response);
      }
    } catch (error) {
      this.handleError(error, params.stream);
    } finally {
      this.cleanup(response);
    }
  }

  private async formatMessages(messages: Message[], system?: string) {
    const result: any[] = [];
    // OpenAI 协议：system 必须作为消息数组首条（无 system 时不插）
    if (system) {
      result.push({ role: "system", content: system });
    }
    for (const msg of messages) {
      // tool 结果消息（source.kind === 'tool'）→ role=tool + function_call_output
      if (msg.source.kind === "tool") {
        const tr = msg.content.find(
          (b): b is Extract<ContentBlock, { type: "tool-result" }> =>
            b.type === "tool-result",
        );
        result.push({
          role: "tool",
          tool_call_id: msg.source.toolCallId,
          name: tr?.name,
          // 空 tool-result 内容也会被 OpenAI 拒绝（missing messages.content）→ 占位 '\n'
          content: tr?.content || "\n",
        });
        continue;
      }

      // 普通消息：按 ContentBlock 块拆分 content
      const filtered: any = {
        role: msg.role === "assistant" ? "assistant" : "user",
        content: await this.resolveLocalImageParts(msg.content),
      };

      // reasoning 块 → reasoning_content
      const reasoning = msg.content.find(
        (b): b is Extract<ContentBlock, { type: "reasoning" }> =>
          b.type === "reasoning",
      );
      if (reasoning) filtered.reasoning_content = reasoning.summary;

      // tool-call 块 → tool_calls
      const toolCalls = msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool-call" }> =>
          b.type === "tool-call",
      );
      if (toolCalls.length > 0) {
        filtered.tool_calls = toolCalls.map((tc, index) => ({
          id: tc.toolCallId,
          index,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      result.push(filtered);
    }
    return result;
  }

  /**
   * 将 ContentBlock[] 转为 OpenAI content 数组（text/image_url/file→路径）。
   * 存储层只存引用（FileRef.url），此处是 adapter 序列化边界，读文件转 base64。
   */
  private async resolveLocalImageParts(
    content: ContentBlock[],
  ): Promise<Array<Record<string, any>>> {
    const parts: Array<Record<string, any>> = [];
    for (const block of content) {
      if (block.type === "text") {
        if (block.text) parts.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        // 传整个附件对象：attachmentToPart 按 refType 分派物理路径
        // （'session' 图片的 url 是自包含引用，只传字符串无法反推会话目录）
        const part = await attachmentToPart(
          block.attachment,
          block.attachment.mediaType,
        );
        if (part) {
          parts.push({
            type: "image_url",
            image_url: {
              url: part.kind === "base64"
                ? `data:${part.mimeType};base64,${part.base64}`
                : part.url,
            },
          });
        }
      } else if (block.type === "file") {
        parts.push({ type: "text", text: fileBlockToText(block.attachment) });
      }
    }
    return parts;
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

  /**
   * OpenAI 兼容 wire 流 → 规范 StreamChunk 词表
   *
   * OpenAI 协议没有块边界事件，由 StreamBlockTracker 合成生命周期：
   * 首个增量前发 block_start；finish_reason/usage 暂存，收尾统一补发
   * block_end*（权威终态）→ usage → finish，保证 finish 之后无 chunk。
   * 旧版"同 delta 混载 reasoning+content 拆两条事件"的补丁随词表统一自然消失。
   */
  private async *handleStreamResponse(
    response: any,
  ): AsyncGenerator<StreamChunk> {
    const tracker = new StreamBlockTracker();
    let pendingFinish: string | null = null;
    let pendingUsage: StreamUsage | null = null;

    for await (const chunk of response) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      const reasoning = (delta as any)?.reasoning_content || null;
      const content = delta?.content || null;

      // finish_reason / usage 只暂存，收尾时统一发射
      if (choice.finish_reason) pendingFinish = choice.finish_reason;
      if ((chunk as any).usage) {
        pendingUsage = this.mapUsage((chunk as any).usage);
      }

      if (reasoning) {
        for (const c of tracker.reasoningDelta(reasoning)) yield c;
      }
      if (content) {
        for (const c of tracker.textDelta(content)) yield c;
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          for (const c of tracker.toolCallDelta(tc.index, {
            toolCallId: tc.id,
            name: tc.function?.name,
            argumentsDelta: tc.function?.arguments,
          })) {
            yield c;
          }
        }
      }
    }

    // [DONE] 收尾：先闭所有块，再 usage，最后 finish
    for (const c of tracker.closeAll()) yield c;
    if (pendingUsage) {
      yield { type: "usage", usage: pendingUsage };
    }
    yield { type: "finish", finishReason: pendingFinish || "stop" };
  }

  /** OpenAI usage 原始结构 → StreamUsage */
  private mapUsage(raw: any): StreamUsage {
    return {
      promptTokens: raw.prompt_tokens,
      completionTokens: raw.completion_tokens,
      totalTokens: raw.total_tokens,
      cachedTokens: extractOpenAICachedTokens(raw),
    };
  }

  /**
   * 非流式响应 → 同一词表的 chunk 数组（block_end* → usage → finish）
   */
  private *handleNonStreamResponse(response: any): Generator<StreamChunk> {
    const choice = response.choices?.[0];
    if (!choice || !choice.message)
      throw new Error("Invalid response from LLM API");

    const message = choice.message;
    const hasReasoning = !!(message as any).reasoning_content;

    if (hasReasoning) {
      yield {
        type: "block_end",
        index: 0,
        block: { type: "reasoning", summary: (message as any).reasoning_content },
      };
    }
    if (message.content) {
      yield {
        type: "block_end",
        index: hasReasoning ? 1 : 0,
        block: { type: "text", text: message.content },
      };
    }
    if (message.tool_calls) {
      this.logger.debug(
        `非流式响应检测到 ${message.tool_calls.length} 个工具调用`,
      );
      let index = (hasReasoning ? 1 : 0) + (message.content ? 1 : 0);
      for (const tc of message.tool_calls) {
        yield {
          type: "block_end",
          index: index++,
          block: {
            type: "tool-call",
            toolCallId: tc.id || "",
            name: tc.function?.name || "",
            arguments:
              typeof tc.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments ?? {}),
          },
        };
      }
    }

    if (response.usage) {
      yield { type: "usage", usage: this.mapUsage(response.usage) };
    }
    yield { type: "finish", finishReason: choice.finish_reason || "stop" };
  }

  private handleError(
    error: any,
    isStream: boolean,
  ) {
    // 提取并记录详细的错误信息，避免 NestJS Logger 序列化特殊对象时丢失内容
    const errorDetail = this.extractErrorDetail(error);
    this.logger.error(
      `LLM API error (${isStream ? "stream" : "non-stream"}): ${errorDetail}`,
    );

    // 额外输出完整错误对象的所有自有属性（部分供应商返回非标准格式，如 body 不在标准字段中）
    try {
      const extraFields: Record<string, any> = {};
      for (const key of Object.getOwnPropertyNames(error)) {
        if (
          !["stack", "message", "name", "status", "code", "type"].includes(key)
        ) {
          const val = error[key];
          if (val !== undefined && val !== null) {
            extraFields[key] = typeof val === "object" ? val : String(val);
          }
        }
      }
      if (Object.keys(extraFields).length > 0) {
        this.logger.error(
          `LLM API error extra: ${JSON.stringify(extraFields).substring(0, 2000)}`,
        );
      }
    } catch {
      /* ignore serialization errors */
    }

    if (error instanceof APIError) {
      const rawBody = (error as any).__rawBody;
      const msg = rawBody && error.message?.includes("(no body)")
        ? `LLM API Error: ${error.status} - body=${rawBody.substring(0, 500)}`
        : `LLM API Error: ${error.status} - ${error.message}`;

      // 429 → UpstreamRateLimitError（可重试）
      if (error.status === 429) {
        throw new UpstreamRateLimitError(msg, error, getRetryAfterFromError(error));
      }
      // 5xx → UpstreamNetworkError（可重试）
      if (error.status >= 500 && error.status < 600) {
        throw new UpstreamNetworkError(msg, error, error.status);
      }
      // 4xx → UpstreamRequestError（不可重试）
      if (error.status >= 400 && error.status < 500) {
        throw new UpstreamRequestError(msg, error, error.status);
      }
      // 其他 APIError 原样抛出（status 保留供 classifyError 判断）
      throw error;
    }
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
function extractOpenAICachedTokens(
  rawUsage: any,
): { read?: number; missed?: number } | undefined {
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
