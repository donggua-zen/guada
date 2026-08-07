import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { CharacterRepository } from "../../common/database/character.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { LLMService } from "../llm-core/llm.service";
import { MessageService } from "./message.service";
import { AgentEngine } from "./agent-engine.service";
import { SessionGroupService } from "./session-group.service";
import {
  createPaginatedResponse,
  PaginatedResponse,
  CursorPaginatedResponse,
} from "../../common/types/pagination";
import { SearchIndexService } from "../../common/search/search-index.service";
import { UrlService } from "../../common/services/url.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import {
  SG_MODELS,
  SK_MOD_CHAT,
  SK_MOD_TITLE_MODEL,
} from "../../constants/settings.constants";
import { SessionContextFactory } from "./session-context.factory";
import { WorkspaceWatcherService } from "../../common/services/workspace-watcher.service";
import { SessionStreamManager } from "./session-stream.manager";
import { SummaryMode } from "./compression-engine";
import { resolveThinkingEffort } from "../llm-core";

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
    private contextManager: MessageService,
    private urlService: UrlService,
    private workspaceService: WorkspaceService,
    private sessionContextFactory: SessionContextFactory,
    private workspaceWatcherService: WorkspaceWatcherService,
    private streamManager: SessionStreamManager,
    private agentEngine: AgentEngine,
    private searchIndex: SearchIndexService,
    private prisma: PrismaService,
    private sessionGroupService: SessionGroupService,
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
    keyword?: string,
    includeArchived: boolean = false,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.sessionRepo.findByUserId(
      userId,
      skip,
      limit,
      groupId,
      keyword,
      includeArchived,
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
   * 侧边栏批量获取：一次请求返回所有分组 + 各分组的前 N 条会话
   * 替代前端 N+2 次串行 HTTP 请求
   */
  async getSidebarSessions(userId: string, limit: number = 10) {
    const groups = await this.sessionGroupService.getGroupsByUser(userId);

    // 所有分组 ID + null（未分组），并行查询
    const groupIds: (string | null)[] = [...groups.map((g) => g.id), null];
    const results = await Promise.all(
      groupIds.map((gid) =>
        this.sessionRepo.findByUserId(userId, 0, limit, gid, undefined, false),
      ),
    );

    const groupSessions = groupIds.map((gid, i) => {
      const { items, total } = results[i];
      return {
        groupId: gid,
        items: items.map((item) => ({
          ...item,
          isStreaming: this.streamManager.hasActiveStream(item.id),
        })),
        total,
        hasMore: items.length < total,
      };
    });

    return { groups, groupSessions };
  }

  /**
   * 归档/取消归档会话
   * 流式输出中的会话禁止归档
   * 取消归档时同步更新最后活跃时间
   */
  async archiveSession(
    sessionId: string,
    userId: string,
    archived: boolean,
  ): Promise<{ success: boolean; session?: any }> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new HttpException("会话不存在", HttpStatus.NOT_FOUND);
    }

    // 归档时校验：流式输出中禁止归档
    if (archived && this.streamManager.hasActiveStream(sessionId)) {
      throw new HttpException("会话正在流式输出中，无法归档", HttpStatus.BAD_REQUEST);
    }

    const updateData: any = { archived };
    if (!archived) {
      updateData.lastActiveAt = new Date();
    }

    const updated = await this.sessionRepo.update(sessionId, updateData);
    return { success: true, session: updated };
  }

  /**
   * 批量归档/取消归档会话
   * 流式输出中的会话会被跳过
   */
  async batchArchiveSessions(
    sessionIds: string[],
    userId: string,
    archived: boolean,
  ): Promise<{ success: boolean; skipped: string[] }> {
    const skipped: string[] = [];

    for (const id of sessionIds) {
      const session = await this.sessionRepo.findById(id);
      if (!session || session.userId !== userId) {
        skipped.push(id);
        continue;
      }

      if (archived && this.streamManager.hasActiveStream(id)) {
        skipped.push(id);
        continue;
      }

      const updateData: any = { archived };
      if (!archived) {
        updateData.lastActiveAt = new Date();
      }
      await this.sessionRepo.update(id, updateData);
    }

    return { success: true, skipped };
  }

  /**
   * 获取用户已归档的会话列表
   */
  async getArchivedSessions(
    userId: string,
    skip: number = 0,
    limit: number = 50,
    keyword?: string,
    groupId?: string | null,
  ): Promise<PaginatedResponse<any>> {
    const parsedGroupId = groupId === "null" ? null : groupId;
    const { items, total } = await this.sessionRepo.findArchivedByUserId(
      userId,
      skip,
      limit,
      keyword,
      parsedGroupId,
    );

    const transformedItems = items.map((item) => ({
      ...item,
      isStreaming: false,
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
   * 获取会话的摘要记录（分页）
   * @param limit 可选，限制返回条数
   * @returns { items, total }
   */
  async getSessionSummaries(sessionId: string, userId: string, limit?: number) {
    // 验证会话归属权
    const session = await this.getSessionById(sessionId, userId);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    const [items, total] = await Promise.all([
      this.contextStateRepo.findAllBySessionId(sessionId, limit),
      this.contextStateRepo.countBySessionId(sessionId),
    ]);
    return { items, total };
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
    const { modelId, characterId, title, settings, workspacePath } = data;

    let mainCharacterId = characterId;

    if (!mainCharacterId) {
      throw new Error("characterId is required");
    }

    // 获取角色信息
    const character = await this.characterRepo.findById(mainCharacterId, false);
    if (!character) {
      throw new Error(`Character with ID ${mainCharacterId} not found`);
    }

    // 处理会话设置：过滤非法字段 + 处理 memory 继承
    const filteredSettings = this.filterAndMergeSessionSettings(
      settings,
      character.settings,
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
    } else {
      await this.workspaceService.validateCustomWorkspacePath(finalWorkspacePath);
      await this.workspaceService.ensureDirectoryExists(finalWorkspacePath);
    }

    // 继承角色配置
    const sessionData = {
      userId,
      characterId: mainCharacterId,
      title: title || character.title,
      avatarUrl: character.avatarUrl,
      description: character.description,
      modelId: finalModelId,
      settings: filteredSettings,
      workspacePath: finalWorkspacePath,
      groupId: data.groupId || null,
      sessionType: "web",
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
  ) {
    if (!sessionSettings) {
      sessionSettings = {};
    }

    const filteredSettings = { ...sessionSettings };

    // memory 配置始终从角色继承，会话不再支持自定义 memory 覆盖
    filteredSettings.memory = characterSettings?.memory || null;
    // 移除 memoryEnabled 字段，不再使用
    delete filteredSettings.memoryEnabled;

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
    const allowedFields = ["modelId", "settings", "title", "groupId", "characterId"];
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

    // 级联删除消息（Prisma Schema 中已配置 onDelete: Cascade）
    await this.sessionRepo.deleteById(sessionId);

    // 数据库删除成功后再停止监听并关闭对应 SSE
    this.workspaceWatcherService.stopWatchingSession(sessionId);

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
        thinkingEffort: resolveThinkingEffort(model, "none"), // 禁用思考功能
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
      breakdown: context.getTokenBreakdown(),
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
        {
          error: "当前会话正在流式输出，请等待结束后再压缩",
          code: "SESSION_STREAMING",
        },
        HttpStatus.CONFLICT,
      );
    }

    const context = await this.sessionContextFactory.createFromSession(session);

    const beforeTokenCount = context.getTokenCount();
    const beforeMessageCount = (await context.getMessages()).length;

    this.logger.log(`Manually triggering compression for session ${sessionId}`);
    await context.compress(async () => {
      if (context.getMemoryConfig().summaryMode === SummaryMode.MEMORY_SYNC) {
        console.log("run memory save shadow turn");
        await this.agentEngine.runMemorySaveShadowTurn(context);
        console.log("memory save shadow turn done");
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

  // ── 会话搜索 ──

  /**
   * 搜索会话 — 标题匹配 + 消息内容匹配（FTS5）
   *
   * 合并两种来源的匹配结果，按 lastActiveAt DESC 游标分页。
   * 内容匹配附带 snippet（匹配上下文片段）。
   *
   * @param cursor base64("lastActiveAt_iso|session_id")
   */
  async searchSessions(
    userId: string,
    keyword: string,
    cursor?: string,
    limit: number = 20,
    includeArchived: boolean = false,
  ): Promise<CursorPaginatedResponse<any>> {
    if (!keyword.trim()) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    // 1. FTS5 内容搜索
    const ftsResults = this.searchIndex.search(keyword, 200);
    const snippetMap = new Map<string, string>(); // sessionId → snippet
    const contentMatchSessionIds = new Set<string>();
    for (const r of ftsResults) {
      if (!contentMatchSessionIds.has(r.sessionId)) {
        contentMatchSessionIds.add(r.sessionId);
        snippetMap.set(r.sessionId, r.snippet);
      }
    }

    // 2. 标题搜索（Prisma contains）
    const titleMatches = await this.sessionRepo.findByUserId(
      userId, 0, 200, undefined, keyword, includeArchived,
    );
    const titleMatchSessionIds = new Set(titleMatches.items.map((s: any) => s.id));

    // 3. 合并所有匹配的 session_id
    const allMatchedIds = new Set<string>([
      ...contentMatchSessionIds,
      ...titleMatchSessionIds,
    ]);

    if (allMatchedIds.size === 0) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    // 4. 解析游标
    let cursorTime: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64").toString("utf-8");
        const sep = decoded.lastIndexOf("|");
        if (sep > 0) {
          cursorTime = decoded.substring(0, sep);
          cursorId = decoded.substring(sep + 1);
        }
      } catch { /* invalid cursor — ignore */ }
    }

    // 5. Prisma 查询：按 session_id + userId + 游标条件
    const where: any = {
      userId,
      sessionType: "web",
      id: { in: Array.from(allMatchedIds) },
    };
    if (!includeArchived) where.archived = false;

    if (cursorTime && cursorId) {
      where.OR = [
        { lastActiveAt: { lt: new Date(cursorTime) } },
        {
          lastActiveAt: { equals: new Date(cursorTime) },
          id: { lt: cursorId },
        },
      ];
    }

    // 多取一条判断 hasMore
    const sessions = await this.prisma.session.findMany({
      where,
      orderBy: [{ lastActiveAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { character: true },
    });

    const hasMore = sessions.length > limit;
    const items = hasMore ? sessions.slice(0, limit) : sessions;

    // 6. 组装结果
    const transformedItems = items.map((item: any) => {
      const isTitleMatch = titleMatchSessionIds.has(item.id);
      const isContentMatch = contentMatchSessionIds.has(item.id);
      return {
        ...item,
        isStreaming: this.streamManager.hasActiveStream(item.id),
        matchType: isTitleMatch ? "title" : "content",
        matchSnippet: isContentMatch ? (snippetMap.get(item.id) ?? undefined) : undefined,
      };
    });

    // 7. 生成 nextCursor
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      const lastActiveAt = last.lastActiveAt
        ? last.lastActiveAt.toISOString()
        : last.updatedAt.toISOString();
      nextCursor = Buffer.from(`${lastActiveAt}|${last.id}`, "utf-8").toString("base64");
    }

    return { items: transformedItems, hasMore, nextCursor };
  }
}
