import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { LLMService } from "../llm-core/llm.service";
import { MessageStoreService } from "./message-store.service";
import { AgentEngine } from "./agent-engine.service";
import {
  createPaginatedResponse,
  PaginatedResponse,
} from "../../common/types/pagination";
import { UrlService } from "../../common/services/url.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import {
  SG_MODELS,
  SK_MOD_CHAT,
  SK_MOD_TITLE_MODEL,
} from "../../constants/settings.constants";
import { SessionContextFactory } from "./session-context.factory";
import { FileWatcherService } from "../../common/services/file-watcher.service";
import { SessionStreamManager } from "./session-stream.manager";
import { TeamRepository } from "../../common/database/team.repository";
import { SummaryMode } from "./compression-engine";

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
    private sessionContextFactory: SessionContextFactory,
    private fileWatcherService: FileWatcherService,
    private streamManager: SessionStreamManager,
    private teamRepo: TeamRepository,
    private agentEngine: AgentEngine,
  ) {}

  /**
   * 获取用户会话列表，按最后活跃时间倒序排列
   */
  /**
   * 获取用户会话列表，支持按分组查询
   * @param groupId 分组ID，null表示未分组，undefined表示全部
   */
  async getSessionsByUser(
    userId: string,
    skip: number = 0,
    limit: number = 20,
    groupId?: string | null,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.sessionRepo.findByUserId(
      userId,
      skip,
      limit,
      groupId,
    );

    // 转换所有 session 的 URL（使用 character 的 avatarUrl），并注入流式状态
    const transformedItems = items.map((item) => ({
      ...item,
      isStreaming: this.streamManager.hasActiveStream(item.id),
      // character: item.character
      //   ? {
      //       ...item.character,
      //       avatarUrl: item.character.avatarUrl
      //         ? this.urlService.toResourceAbsoluteUrl(item.character.avatarUrl)
      //         : null,
      //     }
      //   : null,
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
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }

    // 转换 URL（使用 character 的 avatarUrl）并注入子会话
    if (!session) return null;

    return {
      ...session,
      character: session.character
        ? {
            ...session.character,
            avatarUrl: session.character.avatarUrl
              ? this.urlService.toResourceAbsoluteUrl(
                  session.character.avatarUrl,
                )
              : null,
          }
        : null,
      subSessions: (session.children || []).map((child) => ({
        ...child,
        isStreaming: this.streamManager.hasActiveStream(child.id),
      })),
    };
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
    const modelId = data.modelId;
    const teamId = data.teamId;
    const { title, settings, workspacePath } = data;

    // 团队模式：从团队获取主理人角色ID
    let characterId = data.characterId;
    let team = null;
    if (teamId) {
      team = await this.teamRepo.findById(teamId, false);
      if (!team) {
        throw new Error(`Team with ID ${teamId} not found`);
      }
      characterId = team.leaderCharacterId;
    }

    if (!characterId) {
      throw new Error("characterId is required");
    }

    // 获取角色信息
    const character = await this.characterRepo.findById(characterId, false);
    if (!character) {
      throw new Error(`Character with ID ${characterId} not found`);
    }

    // 处理会话设置：过滤非法字段 + 处理 memory 继承 + 继承角色模型参数
    const filteredSettings = this.filterAndMergeSessionSettings(
      settings,
      character.settings,
      !!character.modelId,
    );

    // 确定使用的模型 ID：优先使用传入的 modelId，其次使用角色的 modelId，最后使用默认对话模型
    let finalModelId = modelId || character.modelId;

    // 如果角色和会话均未设置模型，尝试使用默认对话模型
    if (!finalModelId) {
      finalModelId = await this.settingsStorage.getSettingValue(
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

    // 确定工作目录路径：客户端未传值时生成新的默认工作目录
    let finalWorkspacePath = workspacePath;
    if (finalWorkspacePath === undefined || finalWorkspacePath === null) {
      finalWorkspacePath = await this.workspaceService.generateWorkspaceDir();
    }

    // 团队模式：使用团队信息作为会话标题/头像/描述
    let finalTitle = title || character.title;
    let finalAvatarUrl = character.avatarUrl;
    let finalDescription = character.description;
    if (team) {
      // 使用团队名称作为会话标题，团队头像作为会话头像
      finalTitle = title || team.name;
      finalAvatarUrl = team.avatarUrl || character.avatarUrl;
      finalDescription = team.description || character.description;
    }

    // 继承角色配置
    const sessionData = {
      userId,
      characterId: teamId ? null : characterId,
      title: finalTitle,
      avatarUrl: finalAvatarUrl,
      description: finalDescription,
      modelId: finalModelId,
      settings: filteredSettings,
      workspacePath: finalWorkspacePath,
      groupId: data.groupId || null,
      teamId: teamId || null,
      sessionType: teamId ? "team" : "web",
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
  private filterAndMergeSessionSettings(
    sessionSettings: any,
    characterSettings: any,
    characterHasModel: boolean = false,
  ) {
    // 如果 sessionSettings 为空，使用空对象
    if (!sessionSettings) {
      sessionSettings = {};
    }

    // 定义允许的顶层字段白名单
    const allowedTopLevelFields = [
      "thinkingEffort",
      "referencedKbs",
      "modelName",
      "memoryEnabled",
      "memory",
      "modelOverrideEnabled",
      "model",
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
        summaryMode: sessionMemory.summaryMode ?? SummaryMode.DEFAULT,
        maxTokensLimit: sessionMemory.maxTokensLimit ?? null,
      };
    }

    // 第三步：模型参数继承（创建会话时从角色拷贝，之后除非显式修改不再跟随角色变动）
    // 仅当角色使能了覆盖且绑定了模型时，才将角色参数作为会话初始值
    if (filteredSettings.modelOverrideEnabled === undefined) {
      const charOverride = characterSettings?.overrideModelParams ?? false;
      if (charOverride && characterHasModel) {
        filteredSettings.modelOverrideEnabled = true;
        filteredSettings.model = {
          temperature: characterSettings.modelTemperature ?? undefined,
          topP: characterSettings.modelTopP ?? undefined,
          frequencyPenalty: characterSettings.modelFrequencyPenalty ?? undefined,
        };
      } else {
        filteredSettings.modelOverrideEnabled = false;
        filteredSettings.model = null;
      }
    } else if (filteredSettings.modelOverrideEnabled === false) {
      filteredSettings.model = null;
    } else if (filteredSettings.model) {
      // 确保 model 对象结构完整
      filteredSettings.model = {
        temperature: filteredSettings.model.temperature ?? undefined,
        topP: filteredSettings.model.topP ?? undefined,
        frequencyPenalty: filteredSettings.model.frequencyPenalty ?? undefined,
      };
    }

    return filteredSettings;
  }

  /**
   * 更新会话配置
   * @param data UpdateSessionDto，仅允许更新白名单字段
   */
  async updateSession(sessionId: string, userId: string, data: any) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 只允许更新特定字段（工作目录路径不允许通过此接口更新）
    const allowedFields = ["modelId", "settings", "title", "groupId"];
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
   * 更新会话的工作目录路径
   * 不允许设置为空，必须提供有效路径
   */
  async updateSessionWorkspacePath(
    sessionId: string,
    userId: string,
    workspacePath: string,
  ) {
    // 验证会话权限
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 不允许设置为空
    if (!workspacePath || workspacePath.trim() === "") {
      throw new Error("工作目录路径不能为空，如需恢复默认请删除会话后重新创建");
    }

    // 验证路径
    await this.workspaceService.validateCustomWorkspacePath(workspacePath);

    // 更新会话配置
    await this.sessionRepo.update(sessionId, { workspacePath });

    // 级联更新所有子会话的工作目录
    const children = await this.sessionRepo.findByParentId(sessionId);
    for (const child of children) {
      await this.sessionRepo.update(child.id, { workspacePath });
    }
  }

  /**
   * 删除会话及其关联的消息
   * @param sessionId 会话 ID
   * @param userId 用户 ID
   * @param deleteWorkspace 是否同时删除工作目录（默认 false）
   */
  async deleteSession(
    sessionId: string,
    userId: string,
    deleteWorkspace: boolean = false,
  ) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // 停止文件监听（强制关闭，不等待引用计数）
    this.fileWatcherService.stopWatching(sessionId, "__force_close__");

    // 级联删除消息（Prisma Schema 中已配置 onDelete: Cascade）
    await this.sessionRepo.deleteById(sessionId);

    // 根据参数决定是否删除工作目录
    if (deleteWorkspace) {
      // 用户勾选了删除工作目录，同步删除默认工作目录
      try {
        await this.workspaceService.cleanupDefaultWorkspace(sessionId);
        this.logger.log(`Default workspace deleted for session ${sessionId}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to delete default workspace for session ${sessionId}: ${err.message}`,
        );
        // 不抛出错误，避免影响会话删除
      }
    } else {
      // 用户未勾选，保留工作目录，不做任何操作
      this.logger.log(`Workspace preserved for session ${sessionId}`);
    }
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

      if (session.sessionType === "sub_agent")
        return {
          title: session.title,
          skipped: true,
          reason: "session_type_sub_agent",
        };

      // 从全局设置中获取标题总结模型
      const titleModelId = await this.settingsStorage.getSettingValue(
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
      const recentMessages = await this.contextManager.loadMessages({
        sessionId,
        maxMessages: 2,
      });

      // 获取全局设置中的标题总结提示词（已暂时移除用户配置，使用固定提示词）
      const titlePrompt =
        "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题（不超过 20 个字）。直接返回标题即可，不需要其他解释。";
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
          content:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
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
        thinkingEffort: "off", // 禁用思考功能
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

    const context = await this.sessionContextFactory.createFromSession(session);
    const effectiveContextWindow = context.getEffectiveContextWindow();

    const messages = await context.getMessages();
    const usedTokens = context.getTokenCount();
    const percentage = Math.min(
      (usedTokens / effectiveContextWindow) * 100,
      100,
    );
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

    // 检查会话是否正在流式输出，避免干扰工作流程
    if (this.streamManager.hasActiveStream(sessionId)) {
      throw new HttpException(
        { error: "当前会话正在流式输出，请等待结束后再压缩", code: "SESSION_STREAMING" },
        HttpStatus.CONFLICT,
      );
    }

    const context = await this.sessionContextFactory.createFromSession(session);

    const beforeTokenCount = context.getTokenCount();
    const beforeMessageCount = (await context.getMessages()).length;

    this.logger.log(`Manually triggering compression for session ${sessionId}`);
    await context.compress(async () => {
      if (context.getMemoryConfig().summaryMode === "memory_sync") {
        await this.agentEngine.runMemorySaveShadowTurn(context);
      }
    });

    const afterTokenCount = context.getTokenCount();
    const compressedMessages = await context.getMessages();
    const afterMessageCount = compressedMessages.length;

    const checkpoint = await this.contextStateRepo.findBySessionId(sessionId);
    const compressionStrategy = checkpoint?.cleaningStrategy || "none";

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
        compressionRatio:
          beforeTokenCount > 0
            ? ((1 - afterTokenCount / beforeTokenCount) * 100).toFixed(2) + "%"
            : "0%",
      },
      strategy: compressionStrategy,
      modelName: session.model?.modelName || "gpt-4",
    };
  }

  /**
   * 更新会话最后活跃时间
   */
  async updateLastActiveAt(sessionId: string) {
    return this.sessionRepo.updateLastActiveAt(sessionId);
  }
}
