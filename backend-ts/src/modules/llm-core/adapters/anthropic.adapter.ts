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

    // 处理思考功能：通过 thinking + output_config 两个参数
    const effort = params.thinkingEffort;
    if (effort && effort !== 'off') {
      // budget_tokens 最小 1024，默认取 max_tokens 的 80%
      const budgetTokens = Math.min(
        Math.max(1024, Math.floor((params.maxTokens || 8192) * 0.8)),
        params.maxTokens || 8192,
      );
      requestParams.thinking = { type: "enabled", budget_tokens: budgetTokens };
      // effort 类型来自 OutputConfig: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
      requestParams.output_config = { effort: effort as any };
    } else if (effort === 'off') {
      // 显式禁用思考（某些第三方服务需要明确参数才能关闭）
      requestParams.thinking = { type: "disabled" };
    }

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

      // content_block_stop：无需处理，参数已在增量流中发射完毕
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
    const thinkingContent = message.content
      .filter((block): block is any => block.type === "thinking")
      .map((block) => block.thinking)
      .join("");

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

      // 处理 assistant 且有 toolCalls → text + tool_use content blocks
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const blocks: any[] = [];
        // 如果有文本内容，先加 text block
        if (msg.content) {
          blocks.push({ type: "text", text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
        }
        // 再加 tool_use blocks
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments ? JSON.parse(tc.arguments) : {},
          });
        }
        return { role: "assistant", content: blocks };
      }

      // Anthropic 的 role 只支持 user / assistant
      const role = msg.role === "assistant" ? "assistant" : "user";
      const content = msg.content || "";

      return {
        role,
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
