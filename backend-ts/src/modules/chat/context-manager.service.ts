import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { MessageRepository } from "../../common/database/message.repository";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { UploadPathService } from "../../common/services/upload-path.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ToolContextFactory, ToolContext } from "../tools/tool-context";
import { MessageRecord, MessagePart } from "./types/llm.types";
import { SemanticTurn } from "./types/semantic-turn.types";
import { ToolResultCleaner, CleaningStrategy } from "./tool-result-cleaner.service";

@Injectable()
export class ContextManagerService {
  private readonly logger = new Logger(ContextManagerService.name);

  constructor(
    private messageRepo: MessageRepository,
    private contextStateRepo: SessionContextStateRepository,
    private uploadPathService: UploadPathService,
    private toolOrchestrator: ToolOrchestrator,
    private toolContextFactory: ToolContextFactory,
    private toolResultCleaner: ToolResultCleaner,
  ) { }

  /**
   * 获取用于 LLM 推理的完整上下文（包含系统提示词和工具注入）
   */
  async getContextForLLMInference(params: {
    sessionId: string;
    userId: string;
    userMessageId?: string;
    maxMessages?: number;
    mergedSettings?: any;
    skipToolCalls?: boolean;
    supportsImageInput?: boolean;
  }): Promise<{
    messages: MessageRecord[];
    systemPrompt: string;
    toolContext: ToolContext;
  }> {
    const {
      sessionId,
      userId,
      userMessageId,
      maxMessages = 200,
      mergedSettings,
      skipToolCalls = false,
      supportsImageInput = true,
    } = params;

    // 获取基础对话历史
    const historyMessages = await this.getConversationMessages(
      sessionId,
      userMessageId,
      maxMessages,
      skipToolCalls,
      supportsImageInput,
    );
    // 检查是否包含知识库
    let containsKnowledgeBase = false;
    if (historyMessages[historyMessages.length - 1]?.metadata?.referencedKbs?.length > 0) {
      containsKnowledgeBase = true;
    }
    // 构建工具执行上下文
    const toolContext = this.toolContextFactory.createContext(
      sessionId,
      userId,
      mergedSettings,
      containsKnowledgeBase,
    );

    // 3. 构建系统提示词（包含工具注入）
    let systemPrompt = await this.buildSystemPromptWithTools(mergedSettings, toolContext);
    systemPrompt = this.replaceVariables(systemPrompt || "You are a helpful assistant.");

    // 4. 分离并合并 system 消息
    const nonSystemMessages: MessageRecord[] = [];
    for (const msg of historyMessages) {
      if (msg.role === "system") {
        systemPrompt += `\n\n${msg.content}`;
      } else {
        nonSystemMessages.push(msg);
      }
    }

    // 5. 组装最终消息数组
    const messages: MessageRecord[] = [
      { role: "system", content: systemPrompt },
      ...nonSystemMessages,
    ];

    return {
      messages,
      systemPrompt,
      toolContext,
    };
  }

  /**
   * 获取用于 Token 统计的完整上下文
   * 复用 getContextForLLMInference 的逻辑，确保 Prompt 组装的一致性
   */
  async getContextForTokenStats(
    sessionId: string,
    userId: string,
    mergedSettings?: any,
  ): Promise<{
    messages: MessageRecord[];
    toolsJsonStr: string;
    systemPrompt: string;
  }> {
    // 1. 复用 LLM 推理上下文的构建逻辑
    const { messages, toolContext, systemPrompt } = await this.getContextForLLMInference({
      sessionId,
      userId,
      userMessageId: undefined,
      maxMessages: 500,
      mergedSettings,
      skipToolCalls: false,
    });

    // 2. 获取工具定义并序列化
    const tools = await this.toolOrchestrator.getAllTools(toolContext);
    const toolsJsonStr = tools && tools.length > 0 ? JSON.stringify(tools) : "";

    // 3. 如果存在工具定义，将其作为一条 system 消息插入到主 system prompt 之后
    // 这样可以更准确地统计包含工具描述在内的总 Token 数
    let finalMessages = messages;
    if (toolsJsonStr) {
      finalMessages = [
        messages[0], // 原始的 system prompt
        { role: "system" as const, content: toolsJsonStr },
        ...messages.slice(1),
      ];
    }

    return {
      messages: finalMessages,
      toolsJsonStr,
      systemPrompt,
    };
  }

  /**
   * 获取对话历史消息
   */
  async getConversationMessages(
    sessionId: string,
    userMessageId?: string,
    maxMessages: number = 200,
    skipToolCalls: boolean = false,
    supportsImageInput: boolean = true,
  ): Promise<MessageRecord[]> {
    // 1. 检查是否存在摘要记录
    const latestSummary = await this.contextStateRepo.findLatestBySessionId(sessionId);
    let startAfterMessageId: string | undefined;
    const summaryRecord: MessageRecord | null = latestSummary
      ? { role: "system", content: `[历史对话摘要]\n${latestSummary.summaryContent}` }
      : null;

    if (latestSummary?.lastCompressedMessageId) {
      startAfterMessageId = latestSummary.lastCompressedMessageId;
    }

    // 2. 数据库层直接获取最近的 N 条消息
    const messages = await this.messageRepo.findRecentBySessionId(
      sessionId,
      maxMessages,
      userMessageId, startAfterMessageId,
      { withFiles: true, withContents: true, onlyCurrentContent: true },
    );

    // 3. 内存中处理复杂的结构转换和过滤
    const context: MessageRecord[] = [];
    let isFirstUserMessage = true;

    // 数据库返回的是倒序（最新在前），处理时需要反转回正序
    const lastMessage = messages[0];
    for (const msg of messages.reverse()) {
      const transformed = this.transformContentStructure(
        msg,
        skipToolCalls,
        msg.id === lastMessage.id,
        supportsImageInput,
      );
      if (transformed.length > 0) {
        context.push(...transformed);
        if (msg.role === "user") isFirstUserMessage = false;
      }
    }

    // 4. 如果存在摘要，将其插入到上下文的最前端
    if (summaryRecord) {
      context.unshift(summaryRecord);
    }

    // 5. 运行时动态清理：检查是否存在有效的清理策略
    if (latestSummary?.cleaningStrategy && latestSummary.lastCleanedMessageId) {
      const strategy = latestSummary.cleaningStrategy as CleaningStrategy;

      // 确定需要保护的消息 ID（逻辑轮次的最后一条消息）
      const protectedIds = new Set<string>();
      const turns = this.groupMessagesBySemanticTurns(context);
      turns.forEach(turn => {
        const lastMsg = context[turn.endIndex];
        if (lastMsg && lastMsg.id) protectedIds.add(lastMsg.id);
      });

      // 应用清理策略
      for (let i = 0; i < context.length; i++) {
        const msg = context[i];
        // 仅处理在压缩范围内的消息
        if (msg.id === latestSummary.lastCleanedMessageId) {
          break;
        }
        if (msg.role === "tool" && !protectedIds.has(msg.id)) {
          context[i] = this.toolResultCleaner.cleanToolResults([msg], strategy, protectedIds)[0];
        }
      }
    }

    return context;
  }

  /**
   * 获取用于压缩的消息片段
   */
  async getMessagesForCompression(
    sessionId: string,
    lastCompressedMessageId?: string,
    maxMessages: number = 500,
  ): Promise<MessageRecord[]> {
    const rawMessages = await this.messageRepo.findRecentBySessionId(
      sessionId,
      maxMessages,
      undefined,
      lastCompressedMessageId,
      { withFiles: true, withContents: true, onlyCurrentContent: true },
    );

    if (rawMessages.length === 0) {
      return [];
    }


    const formattedMessages: MessageRecord[] = [];

    for (const msg of rawMessages.reverse()) {
      if (msg.role === 'system') continue;

      // 压缩时需要包含工具调用和结果，所以 skipToolCalls 设为 false
      // 压缩时通常不关注图像降级，默认支持或根据需求调整，这里暂且保持默认 true
      const transformed = this.transformContentStructure(msg, false, false, true);
      if (transformed.length > 0) {
        // 将原始消息的 ID 挂载到转换后的记录上，方便后续追踪
        transformed.forEach(t => t.id = msg.id);
        formattedMessages.push(...transformed);
      }
    }

    return formattedMessages;
  }

  

  /**
   * 获取最近的对话消息用于总结任务
   */
  async getRecentMessagesForSummary(
    sessionId: string,
    skipToolCalls: boolean = true,
  ): Promise<MessageRecord[]> {
    if (!sessionId || typeof sessionId !== "string") {
      throw new Error(`无效的 session_id: ${sessionId}`);
    }

    const allMessages = await this.getConversationMessages(
      sessionId,
      undefined,
      3,
      skipToolCalls,
    );

    const nonSystemMessages = allMessages.filter(
      (msg) => msg.role !== "system",
    );

    nonSystemMessages.reverse();

    return nonSystemMessages.slice(0, 3);
  }

  /**
   * 构建包含工具注入的系统提示词
   */
  private async buildSystemPromptWithTools(
    mergedSettings: any,
    context: any,
  ): Promise<string> {
    let systemPrompt = mergedSettings?.systemPrompt || "";
    const toolPrompts: string[] = [];
    const prompts = await this.toolOrchestrator.getAllToolPrompts(context);
    if (prompts) {
      toolPrompts.push(prompts);
    }
    if (toolPrompts.length > 0) {
      systemPrompt += "\n\n" + toolPrompts.join("\n\n");
    }
    return systemPrompt;
  }

  /**
   * 替换系统提示词中的变量
   */
  private replaceVariables(prompt: string): string {
    return prompt.replace("{time}", new Date().toISOString());
  }

  /**
   * 转换消息内容结构为模型可识别的格式
   */
  private transformContentStructure(
    msg: any,
    skipToolCalls: boolean,
    isNewUserMessage: boolean,
    supportsImageInput: boolean = true,
  ): MessageRecord[] {
    if (msg.role === "assistant") {
      const turns: MessageRecord[] = [];

      for (const content of msg.contents || []) {
        const additionalKwargs = content.additionalKwargs || {};
        const toolCalls = additionalKwargs.toolCalls;

        if (skipToolCalls && toolCalls) continue;

        const baseMsg: MessageRecord = {
          role: "assistant",
          content: content.content || "",
        };

        baseMsg.toolCalls = toolCalls;

        turns.push(baseMsg);

        if (!skipToolCalls && additionalKwargs.toolCallsResponse) {
          turns.push(
            ...additionalKwargs.toolCallsResponse.map((res: any) => ({
              role: "tool",
              ...res,
            })),
          );
        }
      }
      return turns;
    } else {
      const activeContent = msg.contents?.[0];
      if (!activeContent) return [{ role: "user", content: "" }];

      const textParts: MessagePart[] = [
        { type: "text", text: activeContent.content || "" },
      ];

      let metadata = {};
      if (isNewUserMessage) {
        const kbInfo = this.appendKbReferenceInfo(activeContent);
        if (kbInfo) {
          textParts.push({ type: "text", text: kbInfo });
          metadata["referencedKbs"] = kbInfo;
        }
      }

      if (msg.files && Array.isArray(msg.files)) {
        msg.files.forEach((file: any, index: number) => {
          if (file.fileType === "image") {
            const imagePart = this.transformImageFile(file, supportsImageInput);
            if (imagePart) textParts.push(imagePart);
          } else if (file.fileType === "text") {
            const textPart = this.transformTextFile(file, index);
            if (textPart) textParts.push(textPart);
          }
        });
      }

      return [
        {
          role: "user",
          content: textParts.length === 1 ? textParts[0].text : textParts,
          metadata: metadata,
        },
      ];
    }
  }

  /**
   * 追加知识库引用信息
   */
  private appendKbReferenceInfo(activeContent: any): string | null {
    try {
      const referencedKbs = activeContent.additionalKwargs?.referencedKbs;
      if (
        !referencedKbs ||
        !Array.isArray(referencedKbs) ||
        referencedKbs.length === 0
      ) {
        return null;
      }

      const lines = ["【当前引用的知识库】"];
      referencedKbs.forEach((kb: any) => {
        const name = kb.name || "未知";
        const id = kb.id || "unknown";
        const desc = kb.description || "";
        let line = `- 名称：${name}, ID: ${id}`;
        if (desc) line += `, 简介：${desc}`;
        lines.push(line);
      });

      return "\n" + lines.join("\n");
    } catch (error) {
      this.logger.error("Failed to append KB reference info", error);
      return null;
    }
  }

  /**
   * 转换图片文件
   */
  private transformImageFile(file: any, supportsImageInput: boolean): any | null {
    if (!supportsImageInput) {
      return { type: "text", text: `[图片ID：${file.id}]` };
    }

    if (!file.url) return null;

    try {
      const physicalPath = this.uploadPathService.getPathFromWebUrl(file.url);
      if (!physicalPath || !fs.existsSync(physicalPath)) {
        this.logger.warn(`Image file not found at path: ${physicalPath}`);
        return null;
      }

      const imageBuffer = fs.readFileSync(physicalPath);
      const base64Data = imageBuffer.toString("base64");

      const ext = path.extname(physicalPath).toLowerCase();
      let mimeType = "image/jpeg";
      switch (ext) {
        case ".png":
          mimeType = "image/png";
          break;
        case ".gif":
          mimeType = "image/gif";
          break;
        case ".webp":
          mimeType = "image/webp";
          break;
        case ".bmp":
          mimeType = "image/bmp";
          break;
        case ".tiff":
        case ".tif":
          mimeType = "image/tiff";
          break;
      }

      const dataUri = `data:${mimeType};base64,${base64Data}`;

      return {
        type: "image_url",
        image_url: { url: dataUri },
      };
    } catch (error: any) {
      this.logger.error(`Failed to transform image file: ${error.message}`);
      return null;
    }
  }

  /**
   * 转换文本文件
   */
  private transformTextFile(file: any, index: number): any | null {
    const fileName = file.fileName || "unknown";
    const content = file.content || "";
    const fileText =
      `\n\n<ATTACHMENT_FILE>\n` +
      `<FILE_INDEX>File ${index}</FILE_INDEX>\n` +
      `<FILE_NAME>${fileName}</FILE_NAME>\n` +
      `<FILE_CONTENT>\n${content}\n</FILE_CONTENT>\n` +
      `</ATTACHMENT_FILE>\n`;

    return { type: "text", text: fileText };
  }

  /**
   * 将消息按语义轮次分组
   * 
   * 语义轮次定义: 从用户消息开始,到助手给出最终非工具调用的回复为止
   * 期间的所有工具交互视为该轮次的内部状态
   * 
   * @param messages 正序排列的消息列表
   * @returns 分组后的轮次数组
   */
  groupMessagesBySemanticTurns(messages: MessageRecord[]): SemanticTurn[] {
    if (messages.length === 0) {
      return [];
    }

    const turns: SemanticTurn[] = [];
    let currentTurnStart = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // 检测到新的用户消息,结束上一轮次
      if (msg.role === "user" && i > currentTurnStart) {
        const turnMessages = messages.slice(currentTurnStart, i);
        turns.push({
          startIndex: currentTurnStart,
          endIndex: i - 1,
          hasToolCalls: this.turnHasToolCalls(turnMessages),
          userMessageIndex: currentTurnStart,
          messageCount: turnMessages.length,
        });
        currentTurnStart = i;
      }
    }

    // 处理最后一轮
    if (currentTurnStart < messages.length) {
      const turnMessages = messages.slice(currentTurnStart);
      turns.push({
        startIndex: currentTurnStart,
        endIndex: messages.length - 1,
        hasToolCalls: this.turnHasToolCalls(turnMessages),
        userMessageIndex: currentTurnStart,
        messageCount: turnMessages.length,
      });
    }

    this.logger.debug(
      `Grouped ${messages.length} messages into ${turns.length} semantic turns`,
    );

    return turns;
  }

  /**
   * 判断轮次内是否包含工具调用
   */
  private turnHasToolCalls(turnMessages: MessageRecord[]): boolean {
    return turnMessages.some(
      (msg) => msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0,
    );
  }
}
