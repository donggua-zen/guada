import { Injectable, Logger, ConflictException } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { MessageRepository } from "../../common/database/message.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { LLMService } from "../llm-core/llm.service";
import { ContextManagerService } from "./context-manager.service";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { SessionLockService } from "./session-lock.service";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { ToolResultCleaner, CleaningStrategy } from "./tool-result-cleaner.service";
import { UrlService } from "../../common/services/url.service";
import { SG_MODELS, SK_MOD_CHAT, SK_MOD_TITLE_MODEL, SK_MOD_TITLE_PROMPT, SK_MOD_COMPRESS_MODEL } from "../../constants/settings.constants";

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private sessionRepo: SessionRepository,
    private characterRepo: CharacterRepository,
    private messageRepo: MessageRepository,
    private modelRepo: ModelRepository,
    private settingsStorage: SettingsStorage,
    private contextStateRepo: SessionContextStateRepository,
    private llmService: LLMService,
    private contextManager: ContextManagerService,
    private tokenizerService: TokenizerService,
    private toolOrchestrator: ToolOrchestrator,
    private sessionLockService: SessionLockService,
    private toolResultCleaner: ToolResultCleaner,
    private urlService: UrlService,
  ) { }

  /**
   * 获取用户会话列表，按最后活跃时间倒序排列
   */
  async getSessionsByUser(
    userId: string,
    skip: number = 0,
    limit: number = 20,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.sessionRepo.findByUserId(
      userId,
      skip,
      limit,
    );

    // 转换所有 session 的 URL（使用 character 的 avatarUrl）
    const transformedItems = items.map((item) => ({
      ...item,
      character: item.character
        ? {
            ...item.character,
            avatarUrl: item.character.avatarUrl
              ? this.urlService.toResourceAbsoluteUrl(item.character.avatarUrl)
              : null,
          }
        : null,
    }));
    return createPaginatedResponse(transformedItems, total, { skip, limit });
  }

  /**
   * 根据 ID 获取单个会话详情，验证归属权
   */
  async getSessionById(sessionId: string, userId?: string) {
    const session = await this.sessionRepo.findById(sessionId);

    // 如果提供了 userId，验证归属权
    if (userId && (!session || session.userId !== userId)) {
      throw new Error("Session not found or unauthorized");
    }

    // 转换 URL（使用 character 的 avatarUrl）
    return session
      ? {
          ...session,
          character: session.character
            ? {
                ...session.character,
                avatarUrl: session.character.avatarUrl
                  ? this.urlService.toResourceAbsoluteUrl(session.character.avatarUrl)
                  : null,
              }
            : null,
        }
      : null;
  }

  /**
   * 获取会话的所有摘要记录
   */
  async getSessionSummaries(sessionId: string, userId: string) {
    // 验证会话归属权
    const session = await this.getSessionById(sessionId, userId);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    return this.contextStateRepo.findBySessionId(sessionId);
  }

  /**
   * 更新摘要内容
   */
  async updateSummary(
    summaryId: string,
    userId: string,
    data: { summaryContent?: string },
  ) {
    const summary = await this.contextStateRepo.findById(summaryId);
    if (!summary) {
      throw new Error("Summary not found");
    }

    // 验证会话归属权
    await this.getSessionById(summary.sessionId, userId);

    return this.contextStateRepo.update(summaryId, data);
  }

  /**
   * 删除单个摘要记录
   */
  async deleteSummary(summaryId: string, userId: string) {
    const summary = await this.contextStateRepo.findById(summaryId);
    if (!summary) {
      throw new Error("Summary not found");
    }

    // 验证会话归属权
    await this.getSessionById(summary.sessionId, userId);

    return this.contextStateRepo.delete(summaryId);
  }

  /**
   * 创建新会话，支持从角色继承配置
   */
  async createSession(userId: string, data: any) {
    // 兼容 camelCase 和 snake_case
    const characterId = data.characterId || data.character_id;
    const modelId = data.modelId || data.model_id;
    const { title, settings } = data;

    if (!characterId) {
      throw new Error("characterId is required");
    }

    // 获取角色信息
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error(`Character with ID ${characterId} not found`);
    }

    // 合并设置
    const mergedSettings = this.mergeSessionSettings({ settings: settings, character: { settings: character.settings } });

    // 过滤允许继承的值
    const allowedInheritedValues = ["maxMemoryLength", "thinkingEnabled"];
    const filteredSettings = Object.fromEntries(
      Object.entries(mergedSettings).filter(([key]) =>
        allowedInheritedValues.includes(key),
      ),
    );

    // 确定使用的模型 ID：优先使用传入的 modelId，其次使用角色的 modelId，最后使用默认对话模型
    let finalModelId = modelId || character.modelId;

    // 如果角色和会话均未设置模型，尝试使用默认对话模型
    if (!finalModelId) {
      finalModelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
      );
    }

    // 继承角色配置
    const sessionData = {
      userId,
      characterId: characterId,
      title: title || character.title,
      avatarUrl: character.avatarUrl,
      description: character.description,
      modelId: finalModelId,
      settings: filteredSettings,
    };

    const session = await this.sessionRepo.create(sessionData);

    // 转换 URL 后返回（avatarUrl 是上传文件）
    return {
      ...session,
      avatarUrl: session.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(session.avatarUrl)
        : null,
    };
  }

  /**
   * 合并设置：角色设置为基准，用户传入的设置优先
   */
  private mergeSessionSettings(session: any) {
    const sessionSettings = session.settings || {};
    const characterSettings = session.character?.settings || {};

    return {
      ...characterSettings,
      ...sessionSettings,
      maxMemoryLength:
        sessionSettings.maxMemoryLength ??
        characterSettings.maxMemoryLength ??
        20,
      systemPrompt:
        sessionSettings.systemPrompt ?? characterSettings.systemPrompt,
      modelTemperature:
        sessionSettings.modelTemperature ?? characterSettings.modelTemperature,
      modelTopP: sessionSettings.modelTopP ?? characterSettings.modelTopP,
      // 工具配置：会话级别优先于角色级别
      tools: sessionSettings.tools ?? characterSettings.tools,
      mcpServers: sessionSettings.mcpServers ?? characterSettings.mcpServers,
    };
  }

  /**
   * 更新会话配置
   */
  async updateSession(sessionId: string, userId: string, data: any) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 只允许更新特定字段
    const allowedFields = ["modelId", "settings", "title"];
    const updateData: any = {};

    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    const updatedSession = await this.sessionRepo.update(sessionId, updateData);

    return updatedSession;
  }

  /**
   * 删除会话及其关联的消息
   */
  async deleteSession(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 级联删除消息（Prisma Schema 中已配置 onDelete: Cascade）
    await this.sessionRepo.deleteById(sessionId);
  }

  /**
   * 生成会话标题
   */
  async generateTitle(sessionId: string, userId: string) {
    let session: any = null;
    try {
      // 验证会话归属权
      session = await this.getSessionById(sessionId, userId);
      if (!session) {
        throw new Error("Session not found");
      }

      // 从全局设置中获取标题总结模型
      const titleModelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_TITLE_MODEL,
      );

      if (!titleModelId) {
        this.logger.log(
          `No default title summary model configured in settings, skipping title generation for session ${sessionId}`,
        );
        return {
          title: session.title,
          skipped: true,
          reason: "no_title_model_configured",
        };
      }

      // 使用 ContextManagerService 获取最近的 3 条消息（已过滤系统消息，正序排列）
      const recentMessages =
        await this.contextManager.getRecentMessagesForSummary(
          sessionId,
          true, // skip_tool_calls
        );

      if (recentMessages.length < 2) {
        this.logger.log(
          `Session ${sessionId} has less than 2 non-system messages, skipping title generation`,
        );
        return {
          title: session.title,
          skipped: true,
          reason: "insufficient_messages",
        };
      }

      // 获取全局设置中的标题总结提示词（已暂时移除用户配置，使用固定提示词）
      const titlePrompt = "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题（不超过 20 个字）。直接返回标题即可，不需要其他解释。";
      // const titlePrompt = this.settingsStorage.getSettingValue(
      //   SG_MODELS,
      //   SK_MOD_TITLE_PROMPT,
      //   "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题（不超过 20 个字）。直接返回标题即可，不需要其他解释。",
      // );

      // 验证模型是否存在
      const model = await this.modelRepo.findById(titleModelId);
      if (!model) {
        this.logger.error(`Title model ${titleModelId} not found in settings`);
        return {
          title: session.title,
          skipped: true,
          reason: "title_model_not_found",
        };
      }

      // 从最近的消息中提取用户和助手消息（已经是正序：从旧到新）
      const userMessage = recentMessages.find((m) => m.role === "user");
      const assistantMessage = recentMessages.find(
        (m) => m.role === "assistant",
      );
      this.logger.log(`Session ${sessionId} recent messages:`, recentMessages);
      if (!userMessage || !assistantMessage) {
        this.logger.warn(
          `Session ${sessionId} missing user or assistant message in recent messages`,
        );
        return {
          title: session.title,
          skipped: true,
          reason: "missing_messages",
        };
      }

      // 构建提示词
      const userContent =
        typeof userMessage.content === "string" ? userMessage.content : "";
      const assistantContent =
        typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : "";

      const prompt = `${titlePrompt}\n\n用户问题：${userContent}\n\n助手回答：${assistantContent}\n\n生成的标题：`;

      // 调用 LLM 生成标题
      // 注意：使用 model.id 或 model.code 作为 API 请求的模型标识，而非 name
      const response = await this.llmService.completions({
        model: model.modelName,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3, // 较低的温度使输出更稳定
        maxTokens: 50, // 限制输出长度
        thinkingEnabled: false,
        stream: false,
        modelConfig: model,
      });

      this.logger.log(
        `Title generation response for session ${sessionId}:`,
        JSON.stringify(response),
      );

      // 提取生成的标题
      const newTitle = response.content?.trim() || null;

      if (!newTitle) {
        this.logger.warn(`Failed to generate title for session ${sessionId}`);
        return {
          title: session.title,
          skipped: true,
          reason: "generation_failed",
        };
      }

      // 更新会话标题
      await this.sessionRepo.update(sessionId, { title: newTitle });

      this.logger.log(
        `Successfully generated title '${newTitle}' for session ${sessionId}`,
      );

      return {
        title: newTitle,
        skipped: false,
        old_title: session.title,
      };
    } catch (error: any) {
      this.logger.error(
        `Error generating title for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      return {
        title: session?.title || "",
        skipped: true,
        reason: "error",
        error: error.message,
      };
    }
  }

  /**
   * 压缩会话历史记录
   */
  async compressHistory(
    sessionId: string,
    userId: string,
    compressionRatio: number = 50,
    minRetainedTurns: number = 3,
    cleaningStrategy: CleaningStrategy = "moderate",
  ) {
    // 0. 尝试获取会话锁，防止并发压缩
    if (!this.sessionLockService.tryLock(sessionId)) {
      throw new ConflictException("Session is busy with another operation (e.g., chatting or compressing)");
    }

    try {
      // 1. 验证会话归属权
      const session = await this.sessionRepo.findById(sessionId);
      if (!session || session.userId !== userId) {
        throw new Error("Session not found or unauthorized");
      }

      // 2. 获取全局设置中的历史压缩模型
      const compressionModelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_COMPRESS_MODEL,
      );

      if (!compressionModelId) {
        throw new Error("No default history compression model configured in settings");
      }

      const model = await this.modelRepo.findById(compressionModelId);
      if (!model) {
        throw new Error(`Compression model ${compressionModelId} not found`);
      }

      // 3. 获取上一次生成的摘要（如果存在）
      const lastSummary = await this.contextStateRepo.findLatestBySessionId(sessionId);

      // 4. 使用 ContextManagerService 获取待处理的消息片段
      const allNewMessages = await this.contextManager.getMessagesForCompression(
        sessionId,
        lastSummary?.lastCompressedMessageId,
      );

      if (allNewMessages.length === 0) {
        return {
          success: false,
          reason: "no_new_messages",
          message: "自上次压缩以来没有新的对话内容。",
        };
      }

      // 5. 使用语义轮次进行分组和统计
      const semanticTurns = this.contextManager.groupMessagesBySemanticTurns(
        allNewMessages,
      );
      const semanticTurnCount = semanticTurns.length;

      if (semanticTurnCount <= minRetainedTurns) {
        return {
          success: false,
          reason: "insufficient_messages",
          message: `新增对话中的语义轮次数 (${semanticTurnCount}) 小于或等于保留下限 (${minRetainedTurns})，无需压缩。`,
        };
      }

      // 6. 确定保护的消息 ID（每个逻辑轮次的最后一条消息）
      const protectedMessageIds = new Set<string>();
      semanticTurns.forEach(turn => {
        const lastMsg = allNewMessages[turn.endIndex];
        if (lastMsg && lastMsg.id) {
          protectedMessageIds.add(lastMsg.id);
        }
      });

      // 7. 计算 Token 并确定压缩目标（使用通用模型 gpt4 进行估算，满足比例压缩的精度要求）
      const totalTokens = this.tokenizerService.countTokens("gpt4", allNewMessages);
      const targetTokenCount = Math.floor(totalTokens * (compressionRatio / 100));

      // 阶段一：清理与评估
      const cleanedAllMessages = this.toolResultCleaner.cleanToolResults(
        allNewMessages,
        cleaningStrategy,
        protectedMessageIds,
      );
      const cleanedTotalTokens = this.tokenizerService.countTokens("gpt4", cleanedAllMessages);

      let summaryContent: string | undefined = lastSummary?.summaryContent;
      let finalCleaningStrategy: string = "none";
      let splitIndex = allNewMessages.length; // 默认全部保留

      if (cleanedTotalTokens > targetTokenCount) {
        // 阶段二：如果清理后仍超限，则进行 LLM 摘要
        let currentTokens = 0;
        for (let i = 0; i < semanticTurns.length; i++) {
          const turn = semanticTurns[i];
          const turnMessages = cleanedAllMessages.slice(turn.startIndex, turn.endIndex + 1);

          // 检查剩余轮次是否满足保留下限
          const remainingTurns = semanticTurns.length - i;
          if (remainingTurns <= minRetainedTurns) {
            break;
          }

          const effectiveTurnTokens = this.tokenizerService.countTokens("gpt4", turnMessages);
          if (currentTokens + effectiveTurnTokens > targetTokenCount) {
            break;
          }

          currentTokens += effectiveTurnTokens;
          splitIndex = turn.endIndex + 1;
        }

        const toCompress = cleanedAllMessages.slice(0, splitIndex);
        const retainedMessages = cleanedAllMessages.slice(splitIndex);

        // 构造 Prompt 并调用 LLM
        const promptParts = [];
        if (lastSummary) {
          promptParts.push(`【历史对话摘要】\n${lastSummary.summaryContent}\n`);
        }

        promptParts.push("【待压缩的新增对话内容】");
        toCompress.forEach((msg) => {
          let contentStr = '';
          if (typeof msg.content === 'string') {
            contentStr = msg.content;
          } else if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter((part: any)   => part.type === 'text').map((part: any) => part.text);
            contentStr = textParts.join('\n');
          } else {
            contentStr = JSON.stringify(msg.content);
          }

          if (msg.role === "tool") {
            promptParts.push(`工具调用结果: ${contentStr}`);
          } else {
            promptParts.push(`${msg.role === "user" ? "用户" : "助手"}: ${contentStr}`);
          }
        });

        promptParts.push(
          "\n任务：请将上述【历史对话摘要】(若有)与【待压缩的新增对话内容】合并为一个简洁、连贯的新的会话摘要。直接输出摘要内容，不要包含额外的解释或描述或者标题。",
        );

        const response = await this.llmService.completions({
          model: model.modelName,
          messages: [{ role: "user", content: promptParts.join("\n") }],
          temperature: 0.3,
          maxTokens: 1000,
          thinkingEnabled: false,
          stream: false,
          modelConfig: model,
        });

        summaryContent = response.content?.trim();
        if (!summaryContent) {
          throw new Error("LLM generated empty summary");
        }
        finalCleaningStrategy = "summarized";
      } else {
        // 仅清理即可满足要求，跳过 LLM 摘要
        finalCleaningStrategy = cleaningStrategy;
      }

      // 8. 持久化新状态
      const compressedLastMessageId = allNewMessages[splitIndex - 1]?.id;
      
      await this.contextStateRepo.create({
        sessionId,
        summaryContent: summaryContent || null,
        lastCompressedMessageId: compressedLastMessageId || undefined,
        cleaningStrategy: finalCleaningStrategy,
        lastCleanedMessageId: compressedLastMessageId || undefined,
      });

      this.logger.log(
        `Successfully compressed history for session ${sessionId}. Tokens processed: ${cleanedTotalTokens}. Cleaning strategy: ${finalCleaningStrategy}.`,
      );

      return {
        success: true,
        compressedTokens: cleanedTotalTokens,
        retainedTokens: this.tokenizerService.countTokens("gpt4", allNewMessages.slice(splitIndex)),
        summary: summaryContent,
        cleaningStrategy: finalCleaningStrategy,
      };
    } finally {
      // 统一在最外层释放锁
      this.sessionLockService.unlock(sessionId);
    }
  }

  /**
   * 获取会话的 Token 使用统计
   */
  async getTokenStats(sessionId: string, userId: string) {
    // 1. 验证会话归属权并获取会话信息
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 2. 确定使用的模型（优先使用会话绑定的模型，否则使用默认模型）
    let modelId = session.modelId;
    if (!modelId) {
      modelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
      );
    }

    // 3. 获取模型配置以确定上下文窗口大小
    let contextWindow = 128000; // 默认值（GPT-4）
    let modelName = "gpt-4";

    if (modelId) {
      const model = await this.modelRepo.findById(modelId);
      if (model) {
        // contextWindow 存储在 config JSON 字段中
        const config = model.config as any;
        contextWindow = config?.contextWindow || 128000;
        modelName = model.modelName || model.name || "gpt-4";
      }
    }

    // 4. 合并设置
    const mergedSettings = this.mergeSessionSettings(session);

    // 5. 使用 ContextManager 获取用于统计的完整上下文
    const { messages } = await this.contextManager.getContextForTokenStats(
      sessionId,
      userId,
      mergedSettings,
    );

    // 6. 计算 Token 总数
    const usedTokens = this.tokenizerService.countTokens(modelName, messages);

    // 7. 计算使用率
    const percentage = Math.min((usedTokens / contextWindow) * 100, 100);
    const remainingTokens = Math.max(contextWindow - usedTokens, 0);

    return {
      usedTokens,
      totalTokens: contextWindow,
      remainingTokens,
      percentage: parseFloat(percentage.toFixed(2)),
      modelName,
      messageCount: messages.filter(m => m.role === 'user').length, // 仅统计用户消息数（对话轮次）
    };
  }



}
