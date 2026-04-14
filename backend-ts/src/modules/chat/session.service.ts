import { Injectable, Logger } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { MessageRepository } from "../../common/database/message.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { GlobalSettingRepository } from "../../common/database/global-setting.repository";
import { SessionSummaryRepository } from "../../common/database/session-summary.repository";
import { LLMService } from "./llm.service";
import { MemoryManagerService } from "./memory.service";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private sessionRepo: SessionRepository,
    private characterRepo: CharacterRepository,
    private messageRepo: MessageRepository,
    private modelRepo: ModelRepository,
    private globalSettingRepo: GlobalSettingRepository,
    private summaryRepo: SessionSummaryRepository,
    private llmService: LLMService,
    private memoryManager: MemoryManagerService,
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

    return createPaginatedResponse(items, total, { skip, limit });
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

    return session;
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
    const mergedSettings = this.mergeSettings(character.settings, settings);

    // 确定使用的模型 ID：优先使用传入的 modelId，其次使用角色的 modelId，最后使用默认对话模型
    let finalModelId = modelId || character.modelId;

    // 如果角色和会话均未设置模型，尝试使用默认对话模型
    if (!finalModelId) {
      const defaultChatModelSetting = await this.globalSettingRepo.findByKey(
        "default_chat_model_id",
        userId,
      );
      if (defaultChatModelSetting && defaultChatModelSetting.value) {
        finalModelId = defaultChatModelSetting.value;
      }
      // 如果默认对话模型也未设置或已失效，则 finalModelId 保持为 null/undefined
    }

    // 继承角色配置
    const sessionData = {
      userId,
      characterId: characterId,
      title: title || character.title,
      avatarUrl: character.avatarUrl,
      description: character.description,
      modelId: finalModelId,
      settings: mergedSettings,
    };

    const session = await this.sessionRepo.create(sessionData);

    return session;
  }

  /**
   * 合并设置：角色设置为基准，用户传入的设置优先
   */
  private mergeSettings(characterSettings: any, userSettings: any): any {
    const base = characterSettings || {};
    const override = userSettings || {};

    // 深度合并逻辑（此处简化为浅层合并，实际可根据需求扩展）
    return { ...base, ...override };
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
      const titleModelId = await this.getGlobalSetting(
        "default_title_summary_model_id",
        userId,
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

      // 使用 MemoryManagerService 获取最近的 3 条消息（已过滤系统消息，正序排列）
      const recentMessages =
        await this.memoryManager.getRecentMessagesForSummary(
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

      // 获取全局设置中的标题总结提示词
      const titlePrompt = await this.getGlobalSetting(
        "default_title_summary_prompt",
        "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题（不超过 20 个字）。直接返回标题即可，不需要其他解释。",
      );

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
  ) {
    // 1. 验证会话归属权
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 2. 获取全局设置中的历史压缩模型
    const compressionModelId = await this.getGlobalSetting(
      "default_history_compression_model_id",
      userId,
    );

    if (!compressionModelId) {
      throw new Error("No default history compression model configured in settings");
    }

    const model = await this.modelRepo.findById(compressionModelId);
    if (!model) {
      throw new Error(`Compression model ${compressionModelId} not found`);
    }

    // 3. 获取上一次生成的摘要（如果存在）
    const lastSummary = await this.summaryRepo.findLatestBySessionId(sessionId);

    // 4. 使用 MemoryManagerService 获取待处理的消息片段
    const { messages: allNewMessages, lastMessageId } =
      await this.memoryManager.getMessagesForCompression(
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

    // 5. 确定保留范围（基于用户消息数量，确保上下文连贯性）
    // 统计新增片段中的用户消息数量
    const newUserMessageCount = allNewMessages.filter((m) => m.role === "user").length;

    if (newUserMessageCount <= minRetainedTurns) {
      return {
        success: false,
        reason: "insufficient_messages",
        message: `新增对话中的用户提问数 (${newUserMessageCount}) 小于或等于保留下限 (${minRetainedTurns})，无需压缩。`,
      };
    }

    // 6. 计算 Token 并确定压缩目标
    const totalTokens = this.memoryManager.countTokens(allNewMessages);
    const targetTokenCount = Math.floor(totalTokens * (compressionRatio / 100));

    // 逐步累加消息直到达到目标 Token 数，同时确保不压缩掉最后 N 个用户提问对应的内容
    let currentTokens = 0;
    let splitIndex = 0;

    for (let i = 0; i < allNewMessages.length; i++) {
      const msg = allNewMessages[i];

      // 1. 检查剩余部分是否包含足够的用户消息（保留下限约束）
      const remainingUserCount = allNewMessages.slice(i).filter((m) => m.role === "user").length;
      if (remainingUserCount <= minRetainedTurns) {
        break; // 剩余的用户提问数已达到下限，停止向前压缩
      }

      // 2. 确定当前轮次的完整范围（从 User 开始到下一个 User 之前）
      let turnEndIndex = i;
      if (msg.role === "user") {
        // 寻找下一个 User 消息的位置
        const nextUserIndex = allNewMessages.findIndex((m, idx) => idx > i && m.role === "user");
        turnEndIndex = nextUserIndex !== -1 ? nextUserIndex - 1 : allNewMessages.length - 1;
      }

      // 3. 计算这一整轮次（User + 所有后续非 User 消息）的 Token 总数
      let turnTokens = 0;
      for (let j = i; j <= turnEndIndex; j++) {
        turnTokens += this.memoryManager.countTokens([allNewMessages[j]]);
      }

      // 4. 检查加入这一整轮次是否会超过目标阈值
      if (currentTokens + turnTokens > targetTokenCount) {
        break;
      }

      currentTokens += turnTokens;
      splitIndex = turnEndIndex + 1; // 更新切分点到这一轮次的末尾
      i = turnEndIndex; // 跳过已处理的轮次内部消息
    }

    const toCompress = allNewMessages.slice(0, splitIndex);
    const retainedMessages = allNewMessages.slice(splitIndex);

    // 7. 构造 Prompt 并调用 LLM
    const promptParts = [];
    if (lastSummary) {
      promptParts.push(`【历史对话摘要】\n${lastSummary.summaryContent}\n`);
    }

    promptParts.push("【待压缩的新增对话内容】");
    toCompress.forEach((msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      promptParts.push(`${msg.role === "user" ? "用户" : "助手"}: ${content}`);
    });

    promptParts.push(
      "\n任务：请将上述【历史对话摘要】与【待压缩的新增对话内容】合并为一个简洁、连贯的新的会话摘要。直接输出摘要内容，不要包含额外的解释或描述。",
    );

    try {
      const response = await this.llmService.completions({
        model: model.modelName,
        messages: [{ role: "user", content: promptParts.join("\n") }],
        temperature: 0.3,
        maxTokens: 1000,
        thinkingEnabled: false,
        stream: false,
        modelConfig: model,
      });

      const newSummaryContent = response.content?.trim();
      if (!newSummaryContent) {
        throw new Error("LLM generated empty summary");
      }

      // 8. 持久化新摘要
      // 注意：lastCompressedMessageId 应该是原始 Message 表的 ID
      // 由于 getMessagesForCompression 返回的是转换后的格式，我们需要通过 rawMessages 映射
      // 这里简化处理：假设 lastMessageId 是有效的分界点
      await this.summaryRepo.create({
        sessionId,
        summaryContent: newSummaryContent,
        lastCompressedMessageId: lastMessageId || undefined,
      });

      this.logger.log(
        `Successfully compressed history for session ${sessionId}. Tokens processed: ${this.memoryManager.countTokens(toCompress)}.`,
      );

      return {
        success: true,
        compressedTokens: this.memoryManager.countTokens(toCompress),
        retainedTokens: this.memoryManager.countTokens(retainedMessages),
        summary: newSummaryContent,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to compress history for session ${sessionId}: ${error.message}`,
      );
      throw new Error(`Compression failed: ${error.message}`);
    }
  }

  /**
   * 获取全局设置值（优先用户设置，回退到全局默认）
   */
  private async getGlobalSetting(
    key: string,
    userId: string,
    defaultValue: any = null,
  ): Promise<any> {
    const setting = await this.globalSettingRepo.findByKey(key, userId);
    return setting ? setting.value : defaultValue;
  }
}
