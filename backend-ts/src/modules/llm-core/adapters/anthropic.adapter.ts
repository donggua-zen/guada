/**
 * Anthropic Messages 协议适配器。
 *
 * Provider quirks（本协议私有的兼容细节，新增兼容时在此登记）：
 * 1. thinking 块回传必须携带 signature（metadata.signature），无签名不回传；
 *    redacted_thinking（metadata.redactedData）原样回传。二者均以 L1 管线
 *    reasoning 策略保留该消息思考为前提——被剥离的消息其 metadata 中的
 *    signature/redactedData 已由管线清理（message-transform.pipeline.ts stripReasoning），
 *    本文件不做二次判断（reasoning 块是否存在即管线决策的结果）。
 * 2. 连续多条 tool 结果消息必须合并为单条 user 消息内的多个 tool_result block；
 *    assistant 的 tool_use 缺失对应 tool_result 时需注入空结果（patchMissingToolResults），
 *    否则 API 报 400。
 * 3. system prompt 使用顶层 system 字段（非消息数组）。
 * 4. 图片：base64 走 source.type=base64；远程 URL 走 source.type=url。
 *
 * 职责边界：内容归一化（图片投影/reasoning 策略）在 L1 管线完成；本文件只做
 * wire 映射 + fail-loud 断言（见 docs/message-pipeline-normalization-plan.md）。
 */
import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { IProtocolAdapter } from "./base.adapter";
import {
  LLMCompletionParams,
  StreamChunk,
  StreamUsage,
} from "../types/llm.types";
import type { Message, ContentBlock } from "../../../common/types/conversation.types";
import { attachmentToPart, fileBlockToText } from "../utils/attachment.util";
import { assertNoImageContent } from "../utils/content.util";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";
import { ProviderConfig, ConnectionTestResult, RemoteModel } from "../types/provider.types";
import { insecureFetch } from "../utils/tls.util";
import { applyJsonMergePatch } from "../thinking/json-merge-patch";

import {
  UpstreamRateLimitError,
  UpstreamNetworkError,
  UpstreamRequestError,
} from "../utils/upstream-errors";
import { getRetryAfterFromError } from "../utils/retry.util";

/**
 * Anthropic 协议适配器
 *
 * 使用 @anthropic-ai/sdk 与 Anthropic Messages API 通信。
 * 当前为基础版本，支持纯文本对话、工具调用（流式 + 非流式）。
 * TODO: Thinking Extended Thinking、多模态图片输入、错误详情提取
 */
// @Injectable() 不可省：emitDecoratorMetadata 只在类上有装饰器时才产出
// design:paramtypes。当前无构造参数故暂无实害，但缺装饰器会让"将来加依赖"
// 变成静默失败（Nest 零参构造），故一并补上。
@Injectable()
export class AnthropicAdapter implements IProtocolAdapter {
  readonly protocol = "anthropic";
  private readonly logger = new Logger(AnthropicAdapter.name);

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return { success: false, message: "API Key 未配置" };
      }

      const client = new Anthropic({
        apiKey,
        baseURL: config.apiUrl || undefined,
      });

      await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      });

      return { success: true, message: "连接成功" };
    } catch (error: any) {
      const status = error.status || error.statusCode;
      if (status === 401 || status === 403) {
        return { success: false, message: "API Key 无效" };
      }
      return {
        success: false,
        message: `连接失败: ${error.message}`,
        details: error,
      };
    }
  }

  /**
   * 从 Anthropic 兼容 API 同步模型列表（若有）
   * GET https://api.anthropic.com/v1/models
   * 部分第三方服务可能不支持，此时返回空列表
   */
  async syncRemoteModels(config: ProviderConfig): Promise<RemoteModel[]> {
    try {
      const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return [];

      const baseUrl = (config.apiUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
      const url = `${baseUrl}/v1/models`;

      const response = await insecureFetch(url, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        this.logger.warn(`Anthropic /v1/models returned ${response.status}, API may not support model listing`);
        return [];
      }

      const body = await response.json() as { data: Array<{ id: string; type: string; created_at?: string }> };
      return (body.data || []).map((m) => ({
        id: m.id,
        created: m.created_at ? new Date(m.created_at).getTime() : undefined,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to sync remote models (API may not support /v1/models): ${error.message}`);
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

    const providerConfig = params.providerConfig || {};
    const apiKey = providerConfig.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error("Anthropic API Key is missing");
    }

    const client = new Anthropic({
      apiKey,
      baseURL: providerConfig.apiUrl || undefined,
      fetch: insecureFetch,
      maxRetries: 0, // 禁用 SDK 内置重试，由 AgentEngine 统一处理重试
    });

    // system 为请求 envelope 独立字段（对齐 DSH LlmCallConfig.system；Anthropic 顶层 system 槽）
    const anthropicMessages = await this.formatMessages(params.messages);

    // 构建请求参数
    const requestParams: Anthropic.MessageCreateParams = {
      model: params.model,
      max_tokens: params.maxTokens || 8192,
      messages: anthropicMessages,
      ...(params.system
        ? {
            system: [
              {
                type: "text" as const,
                text: params.system,
                cache_control: { type: "ephemeral" as const },
              },
            ],
          }
        : {}),
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
      ...(params.topP !== undefined ? { top_p: params.topP } : {}),
      // 转换工具定义：Anthropic 格式为 {name, description, input_schema}
      ...(params.tools?.length ? { tools: this.convertTools(params.tools) } : {}),
    };

    // 处理思考功能：使用自适应模式 + effort 参数
    // 官方推荐使用 thinking: {type: "adaptive"}，废弃手动 budget_tokens
    // effort 通过 output_config 透传，控制思考深度
    // 拼法表达式接管时（thinkingPatchReplacesFormat）跳过内置写入，完全由表达式输出决定
    const effort = params.thinkingEffort;
    if (!params.thinkingPatchReplacesFormat && effort && effort !== 'none') {
      requestParams.thinking = { type: "adaptive" };
      requestParams.output_config = { effort: effort as any };
    }
    // 注意：不传 thinking 参数 = 模型默认行为（Claude 4+ 默认启用思考）
    // 不传 output_config = 默认 effort

    // 条目 thinkingEffortsPatch：拼装完成后整体打 patch（RFC 7386，patch 优先）
    const finalRequestParams = params.thinkingPatch
      ? applyJsonMergePatch(
          requestParams as any,
          params.thinkingPatch,
        ) as Anthropic.MessageCreateParams
      : requestParams;

    try {
      if (params.stream) {
        // 单次尝试，重试由 AgentEngine 统一处理
        const stream = await client.messages.create({
          ...finalRequestParams,
          stream: true,
        }, { signal: params.abortSignal });

        yield* this.handleStreamResponse(stream as any);
      } else {
        const message = await client.messages.create({
          ...finalRequestParams,
          stream: false,
        }, { signal: params.abortSignal }) as Anthropic.Messages.Message;
        yield* this.handleNonStreamResponse(message);
      }
    } catch (error) {
      this.handleError(error, !!params.stream);
    }
  }

  /**
   * 处理流式响应：Anthropic 原生 content_block 流 → 规范 StreamChunk 词表
   *
   * Anthropic 协议自带块生命周期（content_block_start/delta/stop），映射近乎 1:1：
   * - text_delta / thinking_delta → text_delta / reasoning_delta
   * - input_json_delta → tool_call_delta（partial_json 分片原样透传）
   * - content_block_stop → block_end（携带本 adapter 组装的权威块）
   * - signature_delta / redacted_thinking 拦截缓存，随 finish 注入（多轮思考连续性回传）
   * - message_delta → usage + finish（usage 固定先于 finish）
   */
  private async *handleStreamResponse(
    stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  ): AsyncGenerator<StreamChunk> {
    // 块 index → 中间态（Anthropic 的 index 是全局消息块索引，直接复用为输出 index）
    const blocks = new Map<
      number,
      { kind: "text" | "reasoning" | "tool-call"; text: string }
    >();
    const toolMeta = new Map<number, { id: string; name: string }>();
    let pendingSignature = "";
    let pendingRedactedData = "";
    // message_start 返回的 input_tokens（总输入 token 数），合并到 message_delta
    let inputTokensFromStart = 0;

    // 首个增量前合成 block_start
    const ensure = (
      index: number,
      kind: "text" | "reasoning" | "tool-call",
    ): StreamChunk[] => {
      if (!blocks.has(index)) {
        blocks.set(index, { kind, text: "" });
        return [{ type: "block_start", index, blockType: kind }];
      }
      return [];
    };

    for await (const event of stream) {
      switch (event.type) {
        case "message_start":
          inputTokensFromStart = (event as any).message?.usage?.input_tokens || 0;
          continue;

        case "content_block_start": {
          const block = event.content_block;
          if ((block as any).type === "redacted_thinking") {
            // 加密思考内容不进块流，缓存后随 finish 注入
            pendingRedactedData = (block as any).data || "";
            continue;
          }
          if (block.type === "thinking") {
            for (const c of ensure(event.index, "reasoning")) yield c;
            if (block.thinking) {
              blocks.get(event.index)!.text += block.thinking;
              yield { type: "reasoning_delta", index: event.index, text: block.thinking };
            }
            continue;
          }
          if (block.type === "text") {
            for (const c of ensure(event.index, "text")) yield c;
            if (block.text) {
              blocks.get(event.index)!.text += block.text;
              yield { type: "text_delta", index: event.index, text: block.text };
            }
            continue;
          }
          if (block.type === "tool_use") {
            toolMeta.set(event.index, { id: block.id, name: block.name });
            for (const c of ensure(event.index, "tool-call")) yield c;
            // tool_use 起始可能携带完整初始参数（parsed input）
            const initialArgs = block.input ? JSON.stringify(block.input) : "";
            if (initialArgs && initialArgs !== "{}") {
              blocks.get(event.index)!.text += initialArgs;
              yield {
                type: "tool_call_delta",
                index: event.index,
                toolCallId: block.id,
                name: block.name,
                argumentsDelta: initialArgs,
              };
            } else {
              yield {
                type: "tool_call_delta",
                index: event.index,
                toolCallId: block.id,
                name: block.name,
                argumentsDelta: "",
              };
            }
            continue;
          }
          continue;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            for (const c of ensure(event.index, "text")) yield c;
            blocks.get(event.index)!.text += delta.text || "";
            yield { type: "text_delta", index: event.index, text: delta.text || "" };
          } else if (delta.type === "thinking_delta") {
            for (const c of ensure(event.index, "reasoning")) yield c;
            blocks.get(event.index)!.text += delta.thinking || "";
            yield { type: "reasoning_delta", index: event.index, text: delta.thinking || "" };
          } else if (delta.type === "input_json_delta") {
            const partial = (delta as any).partial_json || "";
            for (const c of ensure(event.index, "tool-call")) yield c;
            blocks.get(event.index)!.text += partial;
            yield { type: "tool_call_delta", index: event.index, argumentsDelta: partial };
          } else if (delta.type === "signature_delta") {
            const sig =
              (delta as any).signature || (delta as any).signature_delta || "";
            // 分片到达时拼接；完整签名覆盖时等价于赋值
            if (sig) pendingSignature += sig;
          }
          continue;
        }

        case "content_block_stop": {
          const info = blocks.get(event.index);
          if (!info) continue;
          if (info.kind === "tool-call") {
            const meta = toolMeta.get(event.index);
            yield {
              type: "block_end",
              index: event.index,
              block: {
                type: "tool-call",
                toolCallId: meta?.id || "",
                name: meta?.name || "",
                arguments: info.text,
              },
            };
          } else if (info.text) {
            yield {
              type: "block_end",
              index: event.index,
              block:
                info.kind === "text"
                  ? { type: "text", text: info.text }
                  : { type: "reasoning", summary: info.text },
            };
          }
          continue;
        }

        case "message_delta": {
          const usage = (event as any).usage;
          // 合并 message_start 缓存的 input_tokens + message_delta 的 output_tokens
          // Anthropic API input_tokens 不包含缓存部分，需手动加回
          const promptTokens = (inputTokensFromStart || usage?.input_tokens || 0)
            + (usage?.cache_read_input_tokens || 0)
            + (usage?.cache_creation_input_tokens || 0);
          const completionTokens = usage?.output_tokens || 0;
          const cachedTokens: StreamUsage["cachedTokens"] =
            usage?.cache_creation_input_tokens || usage?.cache_read_input_tokens
              ? { read: usage.cache_read_input_tokens, written: usage.cache_creation_input_tokens }
              : undefined;
          const streamUsage: StreamUsage = {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            cachedTokens,
          };
          // usage 固定先于 finish
          yield { type: "usage", usage: streamUsage };
          const finish: Extract<StreamChunk, { type: "finish" }> = {
            type: "finish",
            finishReason: event.delta?.stop_reason || "stop",
          };
          if (pendingSignature) {
            finish.signature = pendingSignature;
            pendingSignature = "";
          }
          if (pendingRedactedData) {
            finish.redactedData = pendingRedactedData;
            pendingRedactedData = "";
          }
          yield finish;
          continue;
        }

        default:
          // content_block_stop 已处理 / message_stop 等忽略
          continue;
      }
    }
  }

  /**
   * 非流式响应 → 同一词表的 chunk 数组（block_end* → usage → finish）
   */
  private *handleNonStreamResponse(
    message: Anthropic.Messages.Message,
  ): Generator<StreamChunk> {
    let index = 0;
    let signature: string | undefined;
    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) {
        if (!signature && (block as any).signature) {
          signature = (block as any).signature;
        }
        yield {
          type: "block_end",
          index: index++,
          block: { type: "reasoning", summary: block.thinking },
        };
      } else if (block.type === "text" && block.text) {
        yield {
          type: "block_end",
          index: index++,
          block: { type: "text", text: block.text },
        };
      } else if (block.type === "tool_use") {
        yield {
          type: "block_end",
          index: index++,
          block: {
            type: "tool-call",
            toolCallId: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        };
      }
    }

    const usage = (message as any).usage;
    if (usage) {
      const promptTokens = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      const completionTokens = usage.output_tokens || 0;
      yield {
        type: "usage",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cachedTokens:
            usage.cache_creation_input_tokens || usage.cache_read_input_tokens
              ? { read: usage.cache_read_input_tokens, written: usage.cache_creation_input_tokens }
              : undefined,
        },
      };
    }
    yield {
      type: "finish",
      finishReason: (message as any).stop_reason || "stop",
      ...(signature ? { signature } : {}),
    };
  }

  /**
   * 将内部三层消息格式转换为 Anthropic 格式
   * TODO: 多模态内容支持（image base64 → source）
   */
  private async formatMessages(
    messages: Message[],
  ): Promise<Anthropic.Messages.MessageParam[]> {
    const result: Anthropic.Messages.MessageParam[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // 合并连续的 tool 结果消息（source.kind === 'tool'）→ 单条 user 消息，每个工具一个 tool_result block
      if (msg.source.kind === "tool") {
        const toolBlocks: Anthropic.Messages.ContentBlock[] = [];
        // 收集当前及后续所有连续的 tool 结果消息
        while (i < messages.length && messages[i].source.kind === "tool") {
          const toolMsg = messages[i];
          const tr = toolMsg.content.find(
            (b): b is Extract<ContentBlock, { type: "tool-result" }> =>
              b.type === "tool-result",
          );
          toolBlocks.push({
            type: "tool_result",
            tool_use_id: tr?.toolCallId ?? "",
            content: tr?.content ?? "",
            is_error: tr?.isError ?? false,
          } as any);
          i++;
        }
        i--; // for 循环会再 ++，抵消
        result.push({ role: "user", content: toolBlocks } as any);
        continue;
      }

      // 处理 assistant 消息：text + thinking（有签名时）+ tool_use
      // thinking/redacted_thinking 能否回传由 L1 reasoning 管线决定：
      // 被剥离的消息此处理应已无 reasoning 块、metadata 中也无 signature/redactedData
      if (msg.role === "assistant") {
        const blocks: any[] = [];

        // 如果有 reasoning 且包含签名，回传 thinking block
        const signature = msg.metadata?.signature;
        const redactedData = msg.metadata?.redactedData;
        const reasoning = msg.content.find(
          (b): b is Extract<ContentBlock, { type: "reasoning" }> =>
            b.type === "reasoning",
        );
        if (reasoning && signature) {
          blocks.push({
            type: "thinking",
            thinking: reasoning.summary,
            signature,
          });
        }
        // 如果有 redactedData，原样回传 redacted_thinking block
        if (redactedData) {
          blocks.push({
            type: "redacted_thinking",
            data: redactedData,
          });
        }

        // 文本块
        const textBlocks = msg.content.filter(
          (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
        );
        for (const tb of textBlocks) {
          if (tb.text) blocks.push({ type: "text", text: tb.text });
        }

        // 工具调用块 → tool_use
        const toolCalls = msg.content.filter(
          (b): b is Extract<ContentBlock, { type: "tool-call" }> =>
            b.type === "tool-call",
        );
        for (const tc of toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.toolCallId,
            name: tc.name,
            input: tc.arguments ? JSON.parse(tc.arguments) : {},
          });
        }

        // 只有在有实际内容块时才返回
        if (blocks.length > 0) {
          result.push({ role: "assistant", content: blocks });
        } else {
          // 没有内容块则降级为空文本
          result.push({ role: "assistant", content: "" });
        }
        continue;
      }

      // user 消息（含注入/普通用户输入）：text / image / file 块
      const blocks: any[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text) blocks.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          // 统一助手解析字节（本地文件带 LRU 缓存），此处只做协议映射
          // 注：source.type 是 Anthropic 协议的标准字段（base64/url），
          // 与本项目三层消息的 Message.source.kind 概念无关，勿混淆、勿改名。
          // 传整个附件对象：attachmentToPart 按 refType 分派物理路径。
          const part = await attachmentToPart(
            block.attachment,
            block.attachment.mediaType,
          );
          if (part?.kind === "base64") {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: part.mimeType,
                data: part.base64,
              },
            });
          } else if (part?.kind === "url") {
            // Anthropic Messages API 支持远程 URL source
            blocks.push({
              type: "image",
              source: { type: "url", url: part.url },
            });
          }
        } else if (block.type === "file") {
          blocks.push({ type: "text", text: fileBlockToText(block.attachment) });
        }
      }
      if (blocks.length > 0) {
        result.push({ role: "user", content: blocks } as any);
      } else {
        result.push({ role: "user", content: "" });
      }
    }

    // 降级检查：确保每条 assistant 消息中的 tool_use 都有对应的 tool_result
    // 处理场景：用户中断、engine 崩溃等导致工具结果缺失
    this.patchMissingToolResults(result);

    return result;
  }

  /**
   * 检查并修补缺失的 tool_result block。
   * 当 assistant 消息中的 tool_use 在紧随的下一条消息中找不到对应 tool_result 时，
   * 注入一个空的 tool_result block 并记录警告，避免 Anthropic API 报 400 错误。
   */
  private patchMissingToolResults(messages: Anthropic.Messages.MessageParam[]): void {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant") continue;

      // 提取本消息中所有的 tool_use id
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const toolUseIds = blocks
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => b.id)
        .filter(Boolean);

      if (toolUseIds.length === 0) continue;

      // 检查下一条消息是否有 tool_result
      const nextMsg = messages[i + 1];
      const nextBlocks = nextMsg && Array.isArray(nextMsg.content) ? nextMsg.content : [];

      // 收集下一条消息中已有的 tool_result id
      const existingResultIds = new Set(
        nextBlocks
          .filter((b: any) => b.type === "tool_result")
          .map((b: any) => b.tool_use_id)
          .filter(Boolean),
      );

      const missingIds = toolUseIds.filter((id: string) => !existingResultIds.has(id));
      if (missingIds.length === 0) continue;

      this.logger.warn(
        `检测到 ${missingIds.length} 个 tool_use 缺少对应的 tool_result: ${missingIds.join(", ")}，将注入空回复`,
      );

      // 备用方案 A：如果下一条消息存在但缺少部分 tool_result → 补全到该消息中
      if (nextMsg && nextBlocks.length > 0) {
        for (const id of missingIds) {
          nextBlocks.push({
            type: "tool_result",
            tool_use_id: id,
            content: "[工具调用结果缺失：该工具调用被中断或未完成，请根据实际情况继续处理]",
            is_error: true,
          } as any);
        }
        continue;
      }

      // 备用方案 B：下一条消息完全不存在（数组末尾）→ 注入一条仅含 tool_result 的 user 消息
      if (nextMsg) {
        // 下一条消息存在但不是 content 数组格式，无法修补 → 跳过
        continue;
      }

      messages.splice(i + 1, 0, {
        role: "user",
        content: missingIds.map((id: string) => ({
          type: "tool_result",
          tool_use_id: id,
          content: "[工具调用结果缺失：该工具调用被中断或未完成，请根据实际情况继续处理]",
          is_error: true,
        })),
      } as any);
    }
  }

  /**
   * 将内部工具定义转换为 Anthropic 格式
   * OpenAI: {type:"function", function:{name, description, parameters}}
   * Anthropic: {name, description, input_schema}
   */
  private convertTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      input_schema: tool.parameters || { type: "object", properties: {} },
    }));
  }

  /**
   * 错误处理
   */
  private handleError(
    error: any,
    isStream: boolean,
  ): never {
    this.logger.error(`Anthropic API error: ${error.message}`);

    const status = error.status;
    const msg = `Anthropic API Error: ${status} - ${error.message}`;

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
}
