/**
 * Gemini GenerateContent 协议适配器。
 *
 * Provider quirks（本协议私有的兼容细节，新增兼容时在此登记）：
 * 1. 消息历史使用 startChat({ history })，最后一条消息单独 sendMessage 发送
 *    （history 传 messages.slice(0, -1)）。
 * 2. tool 结果 → functionResponse part（name/response.output 包装），role 恒为 'user'。
 * 3. 图片走 inlineData（base64 + mimeType）；远程 URL 不受支持，投影为引用文本。
 * 4. thinking 级别映射 thinkingConfig.thinkingLevel。
 *
 * 职责边界：内容归一化（图片投影/reasoning 策略）在 L1 管线完成；本文件只做
 * wire 映射 + fail-loud 断言（见 docs/message-pipeline-normalization-plan.md）。
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  SchemaType,
  GenerateContentResult,
} from "@google/generative-ai";
import { IProtocolAdapter } from "./base.adapter";
import {
  LLMCompletionParams,
  StreamChunk,
} from "../types/llm.types";
import type { Message, ContentBlock } from "../../../common/types/conversation.types";
import { attachmentToPart, fileBlockToText } from "../utils/attachment.util";
import { assertNoImageContent } from "../utils/content.util";
import { ToolDefinition } from "../../tools/interfaces/tool-provider.interface";
import { StreamBlockTracker } from "../utils/block-lifecycle.util";
import { ProviderConfig, ConnectionTestResult, RemoteModel } from "../types/provider.types";

import {
  UpstreamRateLimitError,
  UpstreamNetworkError,
  UpstreamRequestError,
} from "../utils/upstream-errors";
import { getRetryAfterFromError } from "../utils/retry.util";

// @Injectable() 不可省：emitDecoratorMetadata 只在类上有装饰器时才产出
// design:paramtypes。当前无构造参数故暂无实害，但缺装饰器会让"将来加依赖"
// 变成静默失败（Nest 零参构造），故一并补上。
@Injectable()
export class GeminiAdapter implements IProtocolAdapter {
  readonly protocol = "gemini";
  private readonly logger = new Logger(GeminiAdapter.name);

  /**
   * 测试 Gemini API 连接
   */
  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          message: "API Key 未配置",
        };
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      // 使用一个轻量级模型进行测试
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      await model.generateContent("test");
      
      return {
        success: true,
        message: "连接成功",
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message?.includes("401") || error.message?.includes("API key not valid")
          ? "API Key 无效"
          : `连接失败: ${error.message}`,
        details: error,
      };
    }
  }

  /**
   * TODO: 实现 Gemini 模型列表同步
   * 使用 GET https://generativelanguage.googleapis.com/v1/models
   */
  async syncRemoteModels(config: ProviderConfig): Promise<RemoteModel[]> {
    // Gemini 官方 API 目前不提供公开的模型列表接口
    this.logger.warn("Gemini model list sync not yet implemented");
    return [];
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
    const apiKey = providerConfig.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("Gemini API Key is missing");
    }

    // 中止检查：请求前（legacy Gemini SDK 无原生 signal 支持，显式检查补偿）
    this.throwIfAborted(params.abortSignal);

    const genAI = new GoogleGenerativeAI(apiKey);

    // 转换工具格式
    const tools = params.tools?.length
      ? [{ functionDeclarations: this.convertTools(params.tools) }]
      : undefined;

    const model = genAI.getGenerativeModel({
      model: params.model,
      generationConfig: this.buildGenerationConfig(params),
      safetySettings: this.getSafetySettings(),
      tools,
      // system 为请求 envelope 独立字段 → Gemini systemInstruction 槽
      ...(params.system ? { systemInstruction: params.system } : {}),
    });

    const chatHistory = await this.formatMessages(params.messages.slice(0, -1));
    const chat = model.startChat({ history: chatHistory });

    try {
      // 获取最后一条用户消息作为当前输入
      const lastMessage = params.messages[params.messages.length - 1];
      // Gemini SDK 对 content 类型要求严格，需确保格式兼容
      const contentToSend = Array.isArray(lastMessage?.content)
        ? lastMessage.content.map((p) =>
            p.type === "text" ? { text: p.text } : (p as any),
          )
        : lastMessage?.content || "";

      // 单次尝试，重试由 AgentEngine 统一处理
      const result = await chat.sendMessageStream(contentToSend);

      // 等待期间可能已中止：开流后再查一次
      this.throwIfAborted(params.abortSignal);

      yield* this.handleGeminiStream(result as any, params.abortSignal);
    } catch (err: any) {
      // 用户中止：直接抛出，不打上游错误日志
      if (params.abortSignal?.aborted) {
        throw err;
      }
      const status = err?.status;
      const msg = `Gemini API Error: ${status} - ${err?.message}`;
      // 429 → UpstreamRateLimitError（可重试）
      if (status === 429) {
        throw new UpstreamRateLimitError(msg, err, getRetryAfterFromError(err));
      }
      // 5xx → UpstreamNetworkError（可重试）
      if (status >= 500 && status < 600) {
        throw new UpstreamNetworkError(msg, err, status);
      }
      // 4xx → UpstreamRequestError（不可重试）
      if (status >= 400 && status < 500) {
        throw new UpstreamRequestError(msg, err, status);
      }
      this.logger.error("Gemini API error:", err);
      throw err;
    }
  }

  /**
   * Gemini wire 流 → 规范 StreamChunk 词表
   *
   * Gemini 无原生块边界事件，由 StreamBlockTracker 合成生命周期；
   * 工具调用通常在流结束时一次性给出（完整 args，作为单个 delta 发出）。
   */
  /** 用户中止检查：legacy Gemini SDK 无原生 signal 支持，调用前与流式块间显式检查 */
  private throwIfAborted(abortSignal?: AbortSignal): void {
    if (abortSignal?.aborted) {
      throw new DOMException("Request aborted", "AbortError");
    }
  }

  private async *handleGeminiStream(result: any, abortSignal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const tracker = new StreamBlockTracker();

    for await (const chunk of result.stream) {
      // 中止检查：SDK 无原生 signal，逐块检查近实时生效（for-await 退出时自动终结底层流）
      this.throwIfAborted(abortSignal);

      // 处理文本内容
      const text = chunk.text();
      if (text) {
        for (const c of tracker.textDelta(text)) yield c;
      }

      // 处理工具调用 (Gemini 通常在流结束时提供完整的函数调用)
      const functionCalls = chunk.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (let index = 0; index < functionCalls.length; index++) {
          const fc = functionCalls[index];
          for (const c of tracker.toolCallDelta(index, {
            toolCallId: fc.name, // Gemini 默认不提供唯一 ID，用名称代替
            name: fc.name,
            argumentsDelta: JSON.stringify(fc.args),
          })) {
            yield c;
          }
        }
      }
    }

    // 收尾：闭块 → usage → finish
    for (const c of tracker.closeAll()) yield c;
    // Gemini 流结束后，尝试获取 usage_metadata（缓存统计 + token 统计）
    const usageMetadata =
      (result as any)?.response?.usageMetadata || (result as any)?.usageMetadata;
    if (usageMetadata) {
      yield {
        type: "usage",
        usage: {
          promptTokens: usageMetadata.promptTokenCount ?? 0,
          completionTokens: usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: usageMetadata.totalTokenCount ?? 0,
          cachedTokens: usageMetadata.cachedContentTokenCount
            ? { read: usageMetadata.cachedContentTokenCount }
            : undefined,
        },
      };
    }
    yield { type: "finish", finishReason: "stop" };
  }

  private buildGenerationConfig(params: LLMCompletionParams) {
    const config: any = {
      temperature: params.temperature,
      topP: params.topP,
      maxOutputTokens: params.maxTokens,
    };

    // 动态注入供应商私有参数（已废弃，改为由供应商内部管理）
    // const providerId = params.providerConfig?.provider;
    // if (providerId && providerId !== "custom") {
    //   TODO: 从供应商实例获取私有配置
    // }

    // Gemini 思考功能配置
    // undefined 视为 'none'，禁用思考功能
    const effort = params.thinkingEffort || 'none';
    if (effort !== 'none') {
      // Gemini API 使用 thinkingConfig.thinking_level 参数
      config.thinkingConfig = {
        thinkingLevel: effort, // 'minimal', 'low', 'medium', 'high'
      };
    }

    return config;
  }

  private async formatMessages(messages: Message[]): Promise<any[]> {
    const result: any[] = [];
    for (const msg of messages) {
      // tool 结果消息（source.kind === 'tool'）→ user part（functionResponse 由流式响应处理时另行装配）
      let parts: any[] = [];
      if (msg.source.kind === "tool") {
        const tr = msg.content.find(
          (b): b is Extract<ContentBlock, { type: "tool-result" }> =>
            b.type === "tool-result",
        );
        parts = [
          {
            functionResponse: {
              name: tr?.name ?? "",
              response: { output: tr?.content ?? "" },
            },
          },
        ];
        result.push({ role: "user", parts });
        continue;
      }

      // 普通消息：按 ContentBlock 块拆分 parts
      parts = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text) parts.push({ text: block.text });
        } else if (block.type === "image") {
          // 统一助手解析字节（本地文件带 LRU 缓存），此处只做协议映射；
          // 传整个附件对象：attachmentToPart 按 refType 分派物理路径。
          const part = await attachmentToPart(
            block.attachment,
            block.attachment.mediaType,
          );
          if (part?.kind === "base64") {
            parts.push({
              inlineData: {
                data: part.base64,
                mimeType: part.mimeType,
              },
            });
          } else if (part?.kind === "url") {
            // Gemini inlineData 不支持远程 URL，退回引用文本提示
            parts.push({ text: `[远程图片: ${part.url}]` });
          }
        } else if (block.type === "file") {
          parts.push({ text: fileBlockToText(block.attachment) });
        } else if (block.type === "tool-call") {
          parts.push({
            functionCall: {
              name: block.name,
              args: block.arguments ? JSON.parse(block.arguments) : {},
            },
          });
        }
      }

      result.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      });
    }
    return result;
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT as any, // Gemini SDK 类型定义较为严格，此处做兼容处理
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || [],
      },
    }));
  }

  private getSafetySettings() {
    return [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ];
  }
}
