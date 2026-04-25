import { Injectable, Logger } from "@nestjs/common";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  SchemaType,
  GenerateContentResult,
} from "@google/generative-ai";
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
export class GeminiAdapter implements LLMAdapter {
  readonly protocol = "gemini";
  private readonly logger = new Logger(GeminiAdapter.name);

  async *chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> {
    const providerConfig = params.providerConfig || {};
    const apiKey = providerConfig.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("Gemini API Key is missing");
    }

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
    });

    const chatHistory = this.formatMessages(params.messages);
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

      const result = await chat.sendMessageStream(contentToSend);

      for await (const chunk of result.stream) {
        const responseChunk: LLMResponseChunk = {
          content: null,
          reasoningContent: null,
          finishReason: null,
          toolCalls: undefined,
          usage: null,
        };

        // 处理文本内容
        const text = chunk.text();
        if (text) {
          responseChunk.content = text;
        }

        // 处理工具调用 (Gemini 通常在流结束时提供完整的函数调用)
        const functionCalls = chunk.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
          responseChunk.toolCalls = functionCalls.map(
            (fc, index): ToolCallItem => ({
              id: fc.name, // Gemini 默认不提供唯一 ID，通常用名称代替
              index,
              type: "function",
              name: fc.name,
              arguments: JSON.stringify(fc.args),
            }),
          );
        }

        yield responseChunk;
      }

      // 模拟结束块
      yield {
        content: null,
        finishReason: "stop",
        usage: null,
      };
    } catch (error) {
      this.logger.error("Gemini API error:", error);
      throw error;
    }
  }

  private buildGenerationConfig(params: LLMCompletionParams) {
    const config: any = {
      temperature: params.temperature,
      topP: params.topP,
      maxOutputTokens: params.maxTokens,
    };

    // 动态注入供应商私有参数
    const providerId = params.providerConfig?.provider;
    if (providerId && providerId !== "custom") {
      const template = PROVIDER_TEMPLATES.find((t) => t.id === providerId);
      const attrs = template?.attributes?.[this.protocol] || {};

      if (params.thinkingEnabled && attrs.thinkingEnabled) {
        Object.assign(config, attrs.thinkingEnabled);
      }
    }

    return config;
  }

  private formatMessages(messages: MessageRecord[]): any[] {
    return messages.map((msg) => {
      // 处理 content 为数组的情况（多模态）
      let parts: any[] = [];
      if (Array.isArray(msg.content)) {
        parts = msg.content.map((item) => {
          if (item.type === "text") return { text: item.text };
          if (item.type === "image_url" && item.image_url) {
            // 简单处理 base64 或 URL，实际生产环境可能需要更复杂的 MIME 类型识别
            return {
              inlineData: {
                data: item.image_url.url.split(",")[1],
                mimeType: "image/jpeg",
              },
            };
          }
          return { text: JSON.stringify(item) };
        });
      } else {
        parts = [{ text: msg.content || "" }];
      }

      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      };
    });
  }

  private convertTools(tools: InternalToolDefinition[]): any[] {
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
