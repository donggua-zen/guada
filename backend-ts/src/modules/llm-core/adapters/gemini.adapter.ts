import { Logger } from "@nestjs/common";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  SchemaType,
  GenerateContentResult,
} from "@google/generative-ai";
import { IProtocolAdapter } from "./base.adapter";
import {
  MessageRecord,
  InternalToolDefinition,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult } from "../types/provider.types";

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

    // 动态注入供应商私有参数（已废弃，改为由供应商内部管理）
    // const providerId = params.providerConfig?.provider;
    // if (providerId && providerId !== "custom") {
    //   TODO: 从供应商实例获取私有配置
    // }

    // Gemini 思考功能配置
    // undefined 视为 'off'，禁用思考功能
    const effort = params.thinkingEffort || 'off';
    if (effort !== 'off') {
      // Gemini API 使用 thinkingConfig.thinking_level 参数
      config.thinkingConfig = {
        thinkingLevel: effort, // 'minimal', 'low', 'medium', 'high'
      };
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
