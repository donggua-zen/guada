import { Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { IProtocolAdapter } from "./base.adapter";
import {
  MessageRecord,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";
import { ProviderConfig, ConnectionTestResult, RemoteModel } from "../types/provider.types";
import { retryOn429 } from "../utils/retry.util";

/**
 * Anthropic 协议适配器
 *
 * 使用 @anthropic-ai/sdk 与 Anthropic Messages API 通信。
 * 当前为基础版本，支持纯文本对话、工具调用（流式 + 非流式）。
 * TODO: Thinking Extended Thinking、多模态图片输入、错误详情提取
 */
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

      const response = await fetch(url, {
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
  ): AsyncGenerator<LLMResponseChunk> {
    const providerConfig = params.providerConfig || {};
    const apiKey = providerConfig.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error("Anthropic API Key is missing");
    }

    const client = new Anthropic({
      apiKey,
      baseURL: providerConfig.apiUrl || undefined,
    });

    // 从 messages 中提取 system prompt（Anthropic 使用顶层 system 字段）
    const { system, messages } = this.extractSystemMessage(params.messages);

    // 转换消息格式
    const anthropicMessages = this.formatMessages(messages);

    // 构建请求参数
    const requestParams: Anthropic.MessageCreateParams = {
      model: params.model,
      max_tokens: params.maxTokens || 8192,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
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
    const effort = params.thinkingEffort;
    if (effort && effort !== 'none') {
      requestParams.thinking = { type: "adaptive" };
      requestParams.output_config = { effort: effort as any };
    }
    // 注意：不传 thinking 参数 = 模型默认行为（Claude 4+ 默认启用思考）
    // 不传 output_config = 默认 effort

    try {
      if (params.stream) {
        // 对 client.messages.create 进行 429 指数退避重试
        const stream = await retryOn429(
          () =>
            client.messages.create({
              ...requestParams,
              stream: true,
            }) as Promise<AsyncIterable<Anthropic.MessageStreamEvent>>,
          {
            logger: this.logger,
            context: `${this.constructor.name}.chatCompletion`,
            abortSignal: params.abortSignal,
          },
        );
        yield* this.handleStreamResponse(stream);
      } else {
        const message = await retryOn429(
          () =>
            client.messages.create({
              ...requestParams,
              stream: false,
            }) as Promise<Anthropic.Messages.Message>,
          {
            logger: this.logger,
            context: `${this.constructor.name}.chatCompletion`,
            abortSignal: params.abortSignal,
          },
        );
        yield this.handleNonStreamResponse(message);
      }
    } catch (error) {
      this.handleError(error, !!params.stream);
    }
  }

  /**
   * 处理流式响应
   * Anthropic SDK 使用 for await ... of stream 模式
   */
  private async *handleStreamResponse(
    stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  ): AsyncGenerator<LLMResponseChunk> {
    // 迭代 stream 进行事件处理

    // 维护块索引 → 工具序号的映射（Anthropic 的 index 是全局消息块索引）
    const blockToToolIndex = new Map<number, number>();
    let nextToolIndex = 0;
    // 缓存 thinking signature + redacted data，在 content_block_stop 时清理
    let pendingSignature = '';
    let pendingRedactedData = '';
    // 缓存 message_start 返回的 input_tokens（总输入 token 数），合并到 message_delta
    let inputTokensFromStart = 0;

    for await (const event of stream) {
      // 拦截 message_start：缓存 input_tokens，不下发
      if (event.type === "message_start") {
        inputTokensFromStart = (event as any).message?.usage?.input_tokens || 0;
        continue;
      }

      // 调试：记录关键事件
      // if (event.type === "content_block_start" || event.type === "content_block_stop" || 
      //     (event.type === "content_block_delta" && ["input_json_delta", "thinking_delta"].includes((event.delta as any).type))) {
      //   this.logger.debug(`Stream event: type=${event.type}, index=${(event as any).index}, deltaType=${(event as any).delta?.type}`);
      // }

      // 拦截 input_json_delta：用工具序号替换块索引后向下游发射
      if (
        event.type === "content_block_delta" &&
        (event.delta as any).type === "input_json_delta"
      ) {
        const toolIndex = blockToToolIndex.get(event.index);
        if (toolIndex !== undefined) {
          yield {
            type: "tool_call",
            content: null,
            reasoningContent: null,
            finishReason: null,
            toolCalls: [{
              index: toolIndex,
              id: "",
              type: "function" as const,
              name: "",
              arguments: (event.delta as any).partial_json || "",
            }],
            usage: null,
          };
        }
        continue;
      }

      // 拦截 signature_delta：缓存签名，不在单独事件中发射
      if (
        event.type === "content_block_delta" &&
        (event.delta as any).type === "signature_delta"
      ) {
        const sig = (event.delta as any).signature || (event.delta as any).signature_delta || '';
        if (sig) {
          pendingSignature = sig;
        }
        continue;
      }

      // content_block_start(redacted_thinking)：记录加密 data，不发射 think 事件
      if (event.type === "content_block_start" && (event.content_block as any).type === "redacted_thinking") {
        pendingRedactedData = (event.content_block as any).data || '';
        continue;
      }

      // content_block_stop：不发射 finish，只处理缓存清理
      // finish 统一由 message_delta 发射
      if (event.type === "content_block_stop") {
        continue;
      }

      const chunk = this.parseStreamEvent(event, inputTokensFromStart);

      // content_block_start(tool_use)：分配自增工具序号
      if (chunk?.toolCalls?.length) {
        for (const tc of chunk.toolCalls) {
          const ti = nextToolIndex++;
          tc.index = ti;
          blockToToolIndex.set((event as any).index, ti);
        }
      }

      // 将缓存的 signature/redactedData 注入到 message_delta 的 finish 事件中
      if (chunk?.type === "finish") {
        if (pendingSignature) {
          chunk.signature = pendingSignature;
          pendingSignature = '';
        }
        if (pendingRedactedData) {
          chunk.redactedData = pendingRedactedData;
          pendingRedactedData = '';
        }
      }

      if (chunk) yield chunk;
    }
  }

  /**
   * 解析 Anthropic 流式事件
   */
  private parseStreamEvent(
    event: Anthropic.MessageStreamEvent,
    inputTokensFromStart: number,
  ): LLMResponseChunk | null {
    switch (event.type) {
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          return {
            type: "text",
            content: delta.text || null,
            reasoningContent: null,
            finishReason: null,
            usage: null,
          };
        }
        if (delta.type === "thinking_delta") {
          return {
            type: "think",
            content: null,
            reasoningContent: delta.thinking || null,
            finishReason: null,
            usage: null,
          };
        }
        // signature_delta 不需要暴露给前端
        return null;
      }

      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "thinking") {
          return {
            type: "think",
            content: null,
            reasoningContent: block.thinking || null,
            finishReason: null,
            usage: null,
          };
        }
        if (block.type === "tool_use") {
          // tool_use block 开始，携带 id、name 和初始 input（可能有完整参数）
          const initialArgs = block.input ? JSON.stringify(block.input) : "";
          return {
            type: "tool_call",
            content: null,
            reasoningContent: null,
            finishReason: null,
            toolCalls: [
              {
                id: block.id,
                index: event.index,
                type: "function" as const,
                name: block.name,
                arguments: initialArgs === "{}" ? "" : initialArgs,
              },
            ],
            usage: null,
          };
        }
        return null;
      }

      case "content_block_stop":
      case "message_stop":
        return null;

      case "message_delta": {
        const usage = event.usage;
        // 合并 message_start 缓存的 input_tokens + message_delta 的 output_tokens
        // Anthropic API input_tokens 不包含缓存部分，需手动加回
        const promptTokens = (inputTokensFromStart || usage?.input_tokens || 0)
          + (usage?.cache_read_input_tokens || 0);
        const completionTokens = usage?.output_tokens || 0;
        // Anthropic 缓存字段：cache_creation_input_tokens / cache_read_input_tokens
        const cachedTokens = usage?.cache_creation_input_tokens || usage?.cache_read_input_tokens
          ? { read: usage.cache_read_input_tokens, written: usage.cache_creation_input_tokens }
          : undefined;
        return {
          type: "finish",
          content: null,
          reasoningContent: null,
          finishReason: event.delta?.stop_reason || null,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            cachedTokens,
          },
        };
      }

      default:
        return null;
    }
  }

  /**
   * 处理非流式响应
   */
  private async handleNonStreamResponse(
    message: Anthropic.Messages.Message,
  ): Promise<LLMResponseChunk> {

    // 提取 thinking blocks → reasoningContent
    const thinkingBlocks = message.content.filter((block): block is any => block.type === "thinking");
    const signature = thinkingBlocks.length > 0 ? (thinkingBlocks[0] as any).signature : undefined;
    const thinkingContent = thinkingBlocks
      .map((block) => block.thinking)
      .join("");

    // 提取 redacted_thinking blocks → redactedData
    const redactedBlocks = message.content.filter((block): block is any => block.type === "redacted_thinking");
    const redactedData = redactedBlocks.length > 0 ? redactedBlocks[0].data : undefined;

    // 提取 text blocks → content
    const textContent = message.content
      .filter((block): block is any => block.type === "text")
      .map((block) => block.text)
      .join("");

    // 提取 tool_use blocks → toolCalls
    const toolUseBlocks = message.content.filter(
      (block): block is any => block.type === "tool_use",
    );
    const toolCalls: ToolCallItem[] | undefined = toolUseBlocks.length
      ? toolUseBlocks.map((block, index) => ({
          id: block.id,
          index,
          type: "function",
          name: block.name,
          arguments: JSON.stringify(block.input),
        }))
      : undefined;

    return {
      type: "finish",
      content: textContent || null,
      reasoningContent: thinkingContent || null,
      finishReason: message.stop_reason || null,
      toolCalls,
      signature,
      redactedData,
      usage: message.usage
        ? {
            promptTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens || 0),
            completionTokens: message.usage.output_tokens,
            totalTokens:
              message.usage.input_tokens + (message.usage.cache_read_input_tokens || 0) + message.usage.output_tokens,
            cachedTokens: message.usage.cache_creation_input_tokens || message.usage.cache_read_input_tokens
              ? { read: message.usage.cache_read_input_tokens, written: message.usage.cache_creation_input_tokens }
              : undefined,
          }
        : null,
    };
  }

  /**
   * 从 messages 中提取 system 消息
   * 返回 content block 数组，最后一个 block 带 cache_control 标记（ephemeral 缓存）
   */
  private extractSystemMessage(messages: MessageRecord[]): {
    system?: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
    messages: MessageRecord[];
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    if (systemMessages.length === 0) return { messages: otherMessages };

    const blocks = systemMessages.map((m, i) => ({
      type: "text" as const,
      text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      ...(i === systemMessages.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    return { system: blocks, messages: otherMessages };
  }

  /**
   * 将内部消息格式转换为 Anthropic 格式
   * TODO: 多模态内容支持（image base64 → source）
   */
  private formatMessages(
    messages: MessageRecord[],
  ): Anthropic.Messages.MessageParam[] {
    const result: Anthropic.Messages.MessageParam[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // 合并连续的 tool 角色消息 → 单条 user 消息，每个工具一个 tool_result block
      if (msg.role === "tool") {
        const toolBlocks: Anthropic.Messages.ContentBlock[] = [];
        // 收集当前及后续所有连续的 tool 消息
        while (i < messages.length && messages[i].role === "tool") {
          const toolMsg = messages[i];
          toolBlocks.push({
            type: "tool_result",
            tool_use_id: toolMsg.toolCallId || "",
            content:
              typeof toolMsg.content === "string"
                ? toolMsg.content
                : JSON.stringify(toolMsg.content),
            is_error: false,
          } as any);
          i++;
        }
        i--; // for 循环会再 ++，抵消
        result.push({ role: "user", content: toolBlocks } as any);
        continue;
      }

      // 处理 assistant 消息：text + thinking（有签名时）+ tool_use
      if (msg.role === "assistant") {
        const blocks: any[] = [];

        // 如果有 reasoningContent 且包含签名，回传 thinking block
        const signature = msg.metadata?.signature;
        const redactedData = msg.metadata?.redactedData;
        if (msg.reasoningContent && signature) {
          blocks.push({
            type: "thinking",
            thinking: msg.reasoningContent,
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

        // 如果有文本内容，加 text block
        if (msg.content) {
          blocks.push({ type: "text", text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
        }

        // 如果有工具调用，加 tool_use blocks
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments ? JSON.parse(tc.arguments) : {},
            });
          }
        }

        // 只有在有实际内容块时才返回
        if (blocks.length > 0) {
          result.push({ role: "assistant", content: blocks });
        } else {
          // 没有内容块则降级为纯文本（兼容旧数据）
          const content = msg.content || "";
          result.push({ role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) });
        }
        continue;
      }

      // Anthropic 的 role 只支持 user / assistant
      const content = msg.content || "";
      result.push({
        role: "user",
        content: typeof content === "string" ? content : JSON.stringify(content),
      } as Anthropic.Messages.MessageParam);
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
  private handleError(error: any, isStream: boolean): never {
    this.logger.error(`Anthropic API error: ${error.message}`);

    // SDK 已提供各种 Error 子类，直接抛出
    throw error;
  }
}
