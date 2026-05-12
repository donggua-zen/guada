import { Injectable, Logger } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { LLMService } from "../llm-core/llm.service";
import { MessageStoreService } from "./message-store.service";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { SG_MODELS, SK_MOD_CHAT, SK_MOD_TITLE_MODEL } from "../../constants/settings.constants";
import { SessionContextService } from "./session-context.service";

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private sessionRepo: SessionRepository,
    private characterRepo: CharacterRepository,
    private modelRepo: ModelRepository,
    private settingsStorage: SettingsStorage,
    private contextStateRepo: SessionContextStateRepository,
    private llmService: LLMService,
    private contextManager: MessageStoreService,
    private urlService: UrlService,
    private workspaceService: WorkspaceService,
    private sessionContextService: SessionContextService,
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

    return this.contextStateRepo.findAllBySessionId(sessionId);
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

    // 处理会话设置：过滤非法字段 + 处理 memory 继承
    const filteredSettings = this.filterAndMergeSessionSettings(settings, character.settings);

    // 确定使用的模型 ID：优先使用传入的 modelId，其次使用角色的 modelId，最后使用默认对话模型
    let finalModelId = modelId || character.modelId;

    // 如果角色和会话均未设置模型，尝试使用默认对话模型
    if (!finalModelId) {
      finalModelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
      );
    }

    // 验证模型是否存在（isActive 只影响前端展示，不影响实际使用）
    if (finalModelId) {
      const model = await this.modelRepo.findById(finalModelId);
      if (!model) {
        throw new Error(`模型不存在：${finalModelId}，请检查模型配置`);
      }
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
   * 过滤并合并会话设置：防止非法字段 + 处理 memory 继承
   * 
   * @param sessionSettings 客户端传递的会话设置
   * @param characterSettings 角色的默认设置
   * @returns 过滤后的安全设置
   */
  private filterAndMergeSessionSettings(sessionSettings: any, characterSettings: any) {
    // 如果 sessionSettings 为空，使用空对象
    if (!sessionSettings) {
      sessionSettings = {};
    }

    // 定义允许的顶层字段白名单
    const allowedTopLevelFields = [
      'thinkingEnabled',
      'referencedKbs',
      'modelName',
      'memoryEnabled',  // 控制是否启用自定义记忆配置
      'memory'          // 具体的记忆配置对象
    ];

    // 第一步：过滤掉非法字段
    const filteredSettings: any = {};
    for (const key of allowedTopLevelFields) {
      if (sessionSettings[key] !== undefined) {
        filteredSettings[key] = sessionSettings[key];
      }
    }

    // 第二步：处理 memory 分组的继承逻辑
    // 如果未开启自定义配置（memoryEnabled === false），则继承角色的 memory 配置
    if (filteredSettings.memoryEnabled === false) {
      filteredSettings.memory = characterSettings?.memory || null;
    } else if (!filteredSettings.memory && characterSettings?.memory) {
      // 如果没有传递 memory 但有角色配置，则继承角色配置
      filteredSettings.memory = characterSettings.memory;
    } else if (filteredSettings.memory) {
      // 开启了自定义配置，使用客户端传递的值并确保结构完整
      const sessionMemory = filteredSettings.memory;

      filteredSettings.memory = {
        maxMemoryLength: sessionMemory.maxMemoryLength ?? null,
        compressionTriggerRatio: sessionMemory.compressionTriggerRatio ?? 0.8,
        compressionTargetRatio: sessionMemory.compressionTargetRatio ?? 0.5,
        summaryMode: sessionMemory.summaryMode ?? 'fast', // 默认快速模式
        maxTokensLimit: sessionMemory.maxTokensLimit ?? null,
      };
    }

    return filteredSettings;
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

    // 异步清理会话工作目录
    this.workspaceService.cleanupWorkspace(sessionId).catch(err =>
      this.logger.error(`Failed to cleanup workspace for session ${sessionId}: ${err.message}`)
    );
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

      // 使用 MessageStoreService 获取最近的 3 条消息（已过滤系统消息，正序排列）
      const recentMessages =
        await this.contextManager.loadMessages({
          sessionId,
          maxMessages: 2
        }
        );



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

      // 遍历 recentMessages，构建简洁的消息数组（只保留 role 和 content）
      const simplifiedMessages = recentMessages
        .filter((m) => {
          // 过滤掉空内容
          if (!m.content) return false;
          // 如果是字符串，检查是否为空或只有空白字符
          if (typeof m.content === "string") return m.content.trim().length > 0;
          // 如果是数组，检查是否非空
          return Array.isArray(m.content) && m.content.length > 0;
        })
        .map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));

      if (simplifiedMessages.length === 0) {
        this.logger.warn(
          `Session ${sessionId} has no valid messages for title generation`,
        );
        return {
          title: session.title,
          skipped: true,
          reason: "no_valid_messages",
        };
      }

      // 序列化消息数组为字符串
      const messagesText = JSON.stringify(simplifiedMessages, null, 2);

      // 构建提示词
      const prompt = `${titlePrompt}\n\n对话内容：\n${messagesText}\n\n生成的标题：`;

      // 调用 LLM 生成标题
      // 注意：使用 model.id 或 model.code 作为 API 请求的模型标识，而非 name
      const response = await this.llmService.completions({
        model: model.modelName,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3, // 较低的温度使输出更稳定
        maxTokens: 50, // 限制输出长度
        thinkingEnabled: false,
        stream: false,
        providerConfig: model.provider,
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
   * 获取会话的 Token 使用统计
   * 使用 SessionContextService 确保与 Agent 对话使用完全一致的参数
   */
  async getTokenStats(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    const { context, effectiveContextWindow } = await this.sessionContextService.buildContext(
      session,
    );

    const messages = context.getHistory();
    const usedTokens = context.getTokenCount();
    const percentage = Math.min((usedTokens / effectiveContextWindow) * 100, 100);
    const remainingTokens = Math.max(effectiveContextWindow - usedTokens, 0);

    return {
      usedTokens,
      totalTokens: effectiveContextWindow,
      remainingTokens,
      percentage: parseFloat(percentage.toFixed(2)),
      modelName: session.model?.modelName || "gpt-4",
      messageCount: messages.length,
    };
  }

  /**
   * 手动触发会话压缩
   * 使用 SessionContextService 确保与 Agent 对话使用完全一致的参数
   */
  async compressSession(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }
  
    const { context } = await this.sessionContextService.buildContext(session);
  
    const beforeTokenCount = context.getTokenCount();
    const beforeMessageCount = context.getHistory().length;
  
    this.logger.log(`Manually triggering compression for session ${sessionId}`);
    await context.forceCompress();
  
    const afterTokenCount = context.getTokenCount();
    const compressedMessages = context.getHistory();
    const afterMessageCount = compressedMessages.length;
  
    const checkpoint = await this.contextStateRepo.findBySessionId(sessionId);
    const compressionStrategy = checkpoint?.cleaningStrategy || 'none';
  
    return {
      success: true,
      before: {
        tokenCount: beforeTokenCount,
        messageCount: beforeMessageCount,
        contextWindow: (session.model?.config as any)?.contextWindow || 128000,
      },
      after: {
        tokenCount: afterTokenCount,
        messageCount: afterMessageCount,
        compressionRatio: beforeTokenCount > 0
          ? ((1 - afterTokenCount / beforeTokenCount) * 100).toFixed(2) + '%'
          : '0%',
      },
      strategy: compressionStrategy,
      modelName: session.model?.modelName || "gpt-4",
    };
  }

}
