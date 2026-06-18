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
    if (effort && effort !== 'off') {
      requestParams.thinking = { type: "adaptive" };
      requestParams.output_config = { effort: effort as any };
    }
    // 注意：不传 thinking 参数 = 模型默认行为（Claude 4+ 默认启用思考）
    // 不传 output_config = 默认 effort

    try {
      if (params.stream) {
        yield* this.handleStreamResponse(client, requestParams);
      } else {
        yield await this.handleNonStreamResponse(client, requestParams);
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
    client: Anthropic,
    params: Anthropic.MessageCreateParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const stream = await client.messages.create({
      ...params,
      stream: true,
    });

    // 维护块索引 → 工具序号的映射（Anthropic 的 index 是全局消息块索引）
    const blockToToolIndex = new Map<number, number>();
    let nextToolIndex = 0;
    // 缓存 thinking signature + redacted data，在 content_block_stop 时清理
    let pendingSignature = '';
    let pendingRedactedData = '';

    for await (const event of stream) {
      // 调试：记录关键事件
      if (event.type === "content_block_start" || event.type === "content_block_stop" || 
          (event.type === "content_block_delta" && ["input_json_delta", "thinking_delta"].includes((event.delta as any).type))) {
        this.logger.debug(`Stream event: type=${event.type}, index=${(event as any).index}, deltaType=${(event as any).delta?.type}`);
      }

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

      const chunk = this.parseStreamEvent(event);

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
      case "message_start":
      case "message_stop":
        return null;

      case "message_delta": {
        const usage = event.usage;
        return {
          type: "finish",
          content: null,
          reasoningContent: null,
          finishReason: event.delta?.stop_reason || null,
          usage: usage
            ? {
                promptTokens: usage.input_tokens || 0,
                completionTokens: usage.output_tokens || 0,
                totalTokens:
                  (usage.input_tokens || 0) + (usage.output_tokens || 0),
              }
            : null,
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
    client: Anthropic,
    params: Anthropic.MessageCreateParams,
  ): Promise<LLMResponseChunk> {
    // 显式指定非流式，消除 TS 联合类型
    const message = await client.messages.create({
      ...params,
      stream: false,
    }) as Anthropic.Messages.Message;

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
            promptTokens: message.usage.input_tokens,
            completionTokens: message.usage.output_tokens,
            totalTokens:
              message.usage.input_tokens + message.usage.output_tokens,
          }
        : null,
    };
  }

  /**
   * 从 messages 中提取 system 消息
   * Anthropic 使用顶层 system 字段而非 role=system 的消息
   */
  private extractSystemMessage(messages: MessageRecord[]): {
    system?: string;
    messages: MessageRecord[];
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    if (systemMessages.length === 0) return { messages: otherMessages };

    const system = systemMessages.map((m) => m.content || "").join("\n");
    return { system: system.trim() || undefined, messages: otherMessages };
  }

  /**
   * 将内部消息格式转换为 Anthropic 格式
   * TODO: 多模态内容支持（image base64 → source）
   */
  private formatMessages(
    messages: MessageRecord[],
  ): Anthropic.Messages.MessageParam[] {
    return messages.map((msg) => {
      // 处理 tool 角色 → tool_result content block
      if (msg.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId || "",
              content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
              is_error: false,
            },
          ],
        } as Anthropic.Messages.MessageParam;
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
          return { role: "assistant", content: blocks };
        }
        // 没有内容块则降级为纯文本（兼容旧数据）
        const content = msg.content || "";
        return { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } as Anthropic.Messages.MessageParam;
      }

      // Anthropic 的 role 只支持 user / assistant
      // 此处 role 只能是 user 或 system（assistant 已在上面处理）
      const content = msg.content || "";

      return {
        role: msg.role === "user" ? "user" : "user", // system → user
        content: typeof content === "string" ? content : JSON.stringify(content),
      } as Anthropic.Messages.MessageParam;
    });
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
