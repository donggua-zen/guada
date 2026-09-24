import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { getSessionDir } from "../../common/utils/session-path.util";
import type { BaseEvent } from "../../common/persistence/types";
import { SessionMetaStore, toRow } from "./session-meta.store";
import {
  extractTodoStateFromEvents,
  writeTodoStore,
} from "../../common/utils/todo-store.util";
import { AgentFileStore } from "../agents/agent-file.store";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { toRuntimeProviderConfig } from "../llm-core/utils/provider-runtime.util";
import { assertResolvableModelRef } from "../llm-core/utils/model-reference.util";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { LLMService } from "../llm-core/llm.service";
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from "../../common/persistence/message-store.interface";
import { CompactionCoordinatorService } from "./compaction/compaction-coordinator.service";
import { SessionGroupService } from "./session-group.service";
import {
  createPaginatedResponse,
  PaginatedResponse,
  CursorPaginatedResponse,
} from "../../common/types/pagination";
import { SessionContentSearchService } from "../../common/search/session-content-search.service";
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
import { EventBusService } from "../../common/events/event-bus.service";
import { StreamStatusChangedEvent } from "../../common/events/stream.events";
import { SessionReplayService } from "./session-replay.service";
import { resolveThinkingEffort } from "../llm-core";

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private sessionStore: SessionMetaStore,
    private agentStore: AgentFileStore,
    private modelStore: ProviderFileStore,
    private settingsStorage: SettingsStorage,
    private llmService: LLMService,
    @Inject(MESSAGE_STORE_TOKEN) private contextManager: IMessageStore,
    private urlService: UrlService,
    private workspaceService: WorkspaceService,
    private sessionContextFactory: SessionContextFactory,
    private workspaceWatcherService: WorkspaceWatcherService,
    private streamManager: SessionStreamManager,
    private compactionCoordinator: CompactionCoordinatorService,
    private eventBus: EventBusService,
    private sessionReplayService: SessionReplayService,
    private contentSearch: SessionContentSearchService,
    private sessionGroupService: SessionGroupService,
  ) {}

  /**
   * 会话查询（原 SessionRepository.findAll）：web 会话按分组/关键词/归档过滤，
   * lastActiveAt desc，SQLite 原生分页（COUNT + LIMIT/OFFSET 同事务快照），
   * 并水合 agent 视图。
   */
  private async querySessions(opts: {
    skip?: number;
    limit?: number;
    groupId?: string | null;
    keyword?: string;
    includeArchived?: boolean;
  }): Promise<{ items: any[]; total: number }> {
    const {
      skip = 0,
      limit = 20,
    groupId,
    keyword,
    includeArchived = false,
  } = opts;
    const { rows, total } = this.sessionStore.queryPaged(
      {
        sessionType: "web",
        archived: includeArchived ? undefined : false,
        groupId,
        keyword,
      },
      "lastActiveDesc",
      { skip, limit },
    );
    return {
      items: await this.hydrateMany(rows.map((m) => toRow(m))),
      total,
    };
  }

  /**
   * 已归档会话查询（原 SessionRepository.findArchived）。
   */
  private async queryArchivedSessions(opts: {
    skip?: number;
    limit?: number;
    keyword?: string;
    groupId?: string | null;
  }): Promise<{ items: any[]; total: number }> {
    const { skip = 0, limit = 50, keyword, groupId } = opts;
    const { rows, total } = this.sessionStore.queryPaged(
      {
        sessionType: "web",
        archived: true,
        groupId,
        keyword,
      },
      "updatedDesc",
      { skip, limit },
    );
    return {
      items: await this.hydrateMany(rows.map((m) => toRow(m))),
      total,
    };
  }

  /** 单会话视图：meta + children + agent（原 SessionRepository.findById） */
  private async hydrateSession(id: string): Promise<any | null> {
    const meta = this.sessionStore.get(id);
    if (!meta) return null;
    const children = this.sessionStore.childrenOf(id);
    return this.hydrateOne({ ...meta, children });
  }

  private async hydrateOne(session: any): Promise<any> {
    if (!session) return session;
    const agent = session.agentId
      ? ((await this.agentStore.findById(session.agentId)) ?? null)
      : null;
    return { ...session, agent };
  }

  private async hydrateMany(sessions: any[]): Promise<any[]> {
    const ids = Array.from(
      new Set(
        sessions
          .map((s) => s.agentId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );
    const map = await this.agentStore.findManyByIds(ids);
    return sessions.map((s) => ({
      ...s,
      agent: s.agentId ? (map.get(s.agentId) ?? null) : null,
    }));
  }

  /**
   * 获取用户会话列表，按最后活跃时间倒序排列
   */
  /**
   * 获取用户会话列表，支持按分组查询
   * @param groupId 分组ID，null表示未分组，undefined表示全部
   */
  async getSessions(
    skip: number = 0,
    limit: number = 20,
    groupId?: string | null,
    keyword?: string,
    includeArchived: boolean = false,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.querySessions({ skip, limit, groupId, keyword, includeArchived });

    // 转换所有 session 的 URL（使用 agent 的 avatarUrl），并注入流式状态
    const transformedItems = items.map((item) => ({
      ...item,
      isStreaming: this.streamManager.hasActiveStream(item.id),
      // agent: item.agent
      //   ? {
      //       ...item.agent,
      //       avatarUrl: item.agent.avatarUrl
      //         ? this.urlService.toResourceAbsoluteUrl(item.agent.avatarUrl)
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
  async getSidebarSessions(limit: number = 10) {
    const groups = await this.sessionGroupService.getGroups();

    // 所有分组 ID + null（未分组），并行查询
    const groupIds: (string | null)[] = [...groups.map((g) => g.id), null];
    const results = await Promise.all(
      groupIds.map((gid) =>
        this.querySessions({ skip: 0, limit, groupId: gid, includeArchived: false }),
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
    archived: boolean,
  ): Promise<{ success: boolean; session?: any }> {
    const session = await this.hydrateSession(sessionId);
    if (!session) {
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

    const updated = await this.sessionStore.update(sessionId, updateData);
    return { success: true, session: updated };
  }

  /**
   * 批量归档/取消归档会话
   * 流式输出中的会话会被跳过
   */
  async batchArchiveSessions(
    sessionIds: string[],
    archived: boolean,
  ): Promise<{ success: boolean; skipped: string[] }> {
    const skipped: string[] = [];

    for (const id of sessionIds) {
      const session = await this.hydrateSession(id);
      if (!session) {
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
      await this.sessionStore.update(id, updateData);
    }

    return { success: true, skipped };
  }

  /**
   * 获取用户已归档的会话列表
   */
  async getArchivedSessions(
    skip: number = 0,
    limit: number = 50,
    keyword?: string,
    groupId?: string | null,
  ): Promise<PaginatedResponse<any>> {
    const parsedGroupId = groupId === "null" ? null : groupId;
    const { items, total } = await this.queryArchivedSessions({ skip, limit, keyword, groupId: parsedGroupId });

    const transformedItems = items.map((item) => ({
      ...item,
      isStreaming: false,
    }));
    return createPaginatedResponse(transformedItems, total, { skip, limit });
  }

  /**
   * 根据 ID 获取单个会话详情
   */
  async getSessionById(sessionId: string) {
    const session = await this.hydrateSession(sessionId);
    if (!session) return null;

    return {
      ...session,
      agent: session.agent
        ? {
            ...session.agent,
            avatarUrl: session.agent.avatarUrl
              ? this.urlService.toResourceAbsoluteUrl(
                  session.agent.avatarUrl,
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
   * 获取会话的压缩历史（从 JSONL compaction 事件聚合，替代已移除的 DB 线）
   * @param limit 可选，限制返回条数（最近 N 条）
   * @returns { items, total }
   */
  async getSessionSummaries(sessionId: string, limit?: number) {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    return this.sessionReplayService.getCompactionHistory(sessionId, limit);
  }

  /**
   * 创建新会话，支持从智能体继承配置
   */
  async createSession(data: any) {
    const { modelId, agentId, title, settings, workspacePath } = data;

    let mainAgentId = agentId;

    if (!mainAgentId) {
      throw new Error("agentId is required");
    }

    // 获取智能体信息
    const agent = await this.agentStore.findById(mainAgentId);
    if (!agent) {
      throw new Error(`Agent with ID ${mainAgentId} not found`);
    }

    // 处理会话设置：过滤非法字段 + 处理 memory 继承
    const filteredSettings = this.filterAndMergeSessionSettings(
      settings,
      agent.settings,
    );

    // 确定使用的模型 ID：优先使用传入的 modelId，其次使用智能体的 modelId，最后使用默认对话模型
    let finalModelId = modelId || agent.modelId;

    // 如果智能体和会话均未设置模型，尝试使用默认对话模型
    if (!finalModelId) {
      finalModelId = await this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
      );
    }

    // 验证模型是否存在（isActive 只影响前端展示，不影响实际使用）
    if (finalModelId) {
      const model = await this.modelStore.findModel(finalModelId);
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

    // 继承智能体配置
    const sessionData = {
      agentId: mainAgentId,
      title: title || agent.name,
      avatarUrl: agent.avatarUrl,
      description: agent.description,
      modelId: finalModelId,
      settings: filteredSettings,
      workspacePath: finalWorkspacePath,
      groupId: data.groupId || null,
      sessionType: "web",
    };

    const session: any = await this.sessionStore.create(sessionData);

    // 创建即初始化 JSONL 事件存储（eager 创建）：此后所有并发请求 hasSession 恒为 true，
    // 消除懒创建在首屏并行请求下的 TOCTOU 竞态（ensureSession 内部另有串行化兜底）。
    // 失败不阻断建会话：懒创建兜底会在首次访问时自愈补建。
    try {
      await this.contextManager.ensureSession(session.id, { title: sessionData.title });
    } catch (err: any) {
      this.logger.error(
        `Eager session storage init failed for ${session.id}: ${err?.message ?? err}`,
      );
    }

    // 转换 URL 后返回（avatarUrl 是上传文件）
    return {
      ...session,
      avatarUrl: session.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(session.avatarUrl)
        : null,
    };
  }

  /**
   * 分支会话：以指定助手消息所在回合为节点，复制源会话（元信息 + 事件前缀）为新会话。
   *
   * 只允许以「已完成回合」（存在 turn/finish）为节点——分支必须是完整的一轮对话，
   * 不能是中间状态。复制范围：
   * - meta 业务字段（workspacePath 共用：分支延续同一工作目录上下文）
   * - 事件前缀（seq ≤ 锚点回合 turn/finish；剔除 session/init 与 session/rotate，
   *   两者由新会话自有初始化承担、重放均为 no-op），消息/回合 id 保留原值
   * - 会话目录内附件（refType='session'，url 内嵌源会话 id）：物理文件拷入新会话目录
   *   并改写引用，分支图片不随源会话删除断链
   * - TODO：从事件前缀中最后一个 todo 工具结果的 meta 还原锚点时刻的列表，写入
   *   分支自己的工作目录（TODO 本身不进事件流，见 common/utils/todo-store.util.ts）
   * 子代理子会话与 workflows/ 运行记录均不复制——分支只保留主对话。子代理运行中
   * 同样允许分支（克隆目录的竞态已随克隆一并消失），该取舍由前端分支前弹窗告知。
   * store/workspace/local 形态附件为外部路径引用，按现有共享语义不改写。
   */
  async branchSession(
    sourceSessionId: string,
    options: { turnId: string; title?: string },
  ) {
    const source = await this.hydrateSession(sourceSessionId);
    if (!source) {
      throw new Error("Session not found");
    }
    if (source.sessionType !== "web") {
      throw new HttpException("仅支持对网页会话分支", HttpStatus.BAD_REQUEST);
    }
    // 流式防护（对齐 deleteSession）：生成中的回合未完成，不能作为分支节点
    if (this.streamManager.hasActiveStream(sourceSessionId)) {
      throw new HttpException(
        {
          error: "会话正在流式输出中，无法分支",
          code: "SESSION_STREAMING",
        },
        HttpStatus.CONFLICT,
      );
    }
    // 锚点校验：目标回合必须已完整结束（turn/finish 存在即完整一轮）
    const events = await this.contextManager.getAllEvents(sourceSessionId);
    const anchorFinish = events.find(
      (e) =>
        e.type === "turn/finish" &&
        (e.data as { turnId?: string } | undefined)?.turnId === options.turnId,
    );
    if (!anchorFinish) {
      throw new HttpException(
        "分支锚点不存在或该回合尚未完成（仅支持以完整一轮对话为节点分支）",
        HttpStatus.BAD_REQUEST,
      );
    }

    const created: any = await this.sessionStore.create({
      agentId: source.agentId,
      title: options.title || (source.title ? `${source.title} (fork)` : "Fork"),
      avatarUrl: source.avatarUrl,
      description: source.description,
      modelId: source.modelId,
      settings: source.settings
        ? JSON.parse(JSON.stringify(source.settings))
        : null,
      groupId: source.groupId,
      workspacePath: source.workspacePath,
      sessionType: "web",
    });
    const newSessionId = created.id as string;

    // 事件前缀：锚点回合（含）之前的全部事件
    const prefix = events.filter(
      (e) =>
        e.seq <= anchorFinish.seq &&
        e.type !== "session/init" &&
        e.type !== "session/rotate",
    );
    // 附件引用改写（就地改传入事件对象，纯计算）；物理拷贝在下方 try 内
    const migrated = this.rewriteSessionFileRefs(
      prefix,
      sourceSessionId,
      newSessionId,
    );

    try {
      // 新会话事件存储初始化（写 session/init seq=0）；失败不阻断（懒创建自愈）
      await this.contextManager.ensureSession(newSessionId, {
        title: created.title,
      });

      // 会话目录内附件：物理文件拷入新会话目录
      await this.copySessionAssetDirs(sourceSessionId, newSessionId);

      await this.contextManager.importEvents(newSessionId, migrated);
    } catch (err: any) {
      this.logger.error(
        `Failed to branch session ${sourceSessionId} -> ${newSessionId}: ${err?.message ?? err}`,
      );
      // 回滚半成品分支（meta + JSONL 事件目录一起删，对齐 deleteSession 的级联），
      // 避免残留空分支
      await this.sessionStore.deleteSession(newSessionId).catch(() => {});
      await this.contextManager.clearSessionTurns(newSessionId).catch(() => {});
      throw err;
    }

    // TODO 重建：TODO 不进事件流，只能从锚点前最后一个 todo 工具结果的 meta 还原
    // （无 meta 的存量会话得到 null → 不写，分支 TODO 为空）。
    // 置于回滚 try 之外：TODO 失败绝不能连带回滚已建好的分支。
    try {
      const todoState = extractTodoStateFromEvents(migrated);
      if (todoState && todoState.items.length > 0) {
        const destDir = await this.workspaceService.resolveSessionWorkspaceDir(
          created,
        );
        await writeTodoStore(destDir, newSessionId, todoState);
      }
    } catch (err: any) {
      this.logger.warn(
        `[branch] todo rebuild skipped for ${newSessionId}: ${err?.message ?? err}`,
      );
    }

    this.logger.log(
      `Branched session ${sourceSessionId} (turn=${options.turnId}) -> ${newSessionId}`,
    );

    // 转换 URL 后返回（对齐 createSession 的返回形状）
    return {
      ...created,
      avatarUrl: created.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(created.avatarUrl)
        : null,
    };
  }

  /** 拷贝会话目录内的附件子目录（images/previews）；源目录不存在时静默跳过 */
  private async copySessionAssetDirs(
    sourceSessionId: string,
    targetSessionId: string,
  ) {
    for (const dirName of ["images", "previews"]) {
      const from = path.join(getSessionDir(sourceSessionId), dirName);
      if (!fs.existsSync(from)) continue;
      await fs.promises.cp(from, path.join(getSessionDir(targetSessionId), dirName), {
        recursive: true,
      });
    }
  }

  /**
   * 改写事件前缀中的会话内附件引用（refType='session'，url 内嵌 sessionId）：
   * sessions/<srcId>/... → sessions/<newId>/...（url 与 previewUrl 同步改写）。
   * 就地修改传入事件（调用方持有的是 getAllEvents 新解析出的对象，无共享引用）。
   */
  private rewriteSessionFileRefs(
    events: BaseEvent[],
    sourceSessionId: string,
    targetSessionId: string,
  ): BaseEvent[] {
    const srcSegment = `sessions/${sourceSessionId}/`;
    const dstSegment = `sessions/${targetSessionId}/`;
    const rewriteUrl = (url: string) =>
      url.includes(srcSegment) ? url.split(srcSegment).join(dstSegment) : url;

    for (const event of events) {
      // 附件只内嵌于 user/message 的 blocks 与 assistant/message 的 content 块数组
      const data = event.data as { blocks?: any[]; content?: any[] };
      const blocks =
        event.type === "user/message"
          ? data?.blocks
          : event.type === "assistant/message"
            ? data?.content
            : undefined;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        const ref = block?.attachment;
        if (ref?.refType !== "session") continue;
        if (typeof ref.url === "string") ref.url = rewriteUrl(ref.url);
        if (typeof ref.previewUrl === "string") {
          ref.previewUrl = rewriteUrl(ref.previewUrl);
        }
      }
    }
    return events;
  }

  /**
   * 过滤并合并会话设置：防止非法字段 + 处理 memory 继承
   *
   * @param sessionSettings 客户端传递的会话设置
   * @param agentSettings 智能体的默认设置
   * @returns 过滤后的安全设置
   */
  private filterAndMergeSessionSettings(
    sessionSettings: any,
    agentSettings: any,
  ) {
    if (!sessionSettings) {
      sessionSettings = {};
    }

    const filteredSettings = { ...sessionSettings };

    // memory 配置始终从智能体继承，会话不再支持自定义 memory 覆盖
    filteredSettings.memory = agentSettings?.memory || null;
    // 移除 memoryEnabled 字段，不再使用
    delete filteredSettings.memoryEnabled;

    return filteredSettings;
  }

  /**
   * 更新会话配置
   * @param data UpdateSessionDto，仅允许更新白名单字段
   */
  async updateSession(sessionId: string, data: any) {
    const session = await this.hydrateSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // 只允许更新特定字段（工作目录路径不允许通过此接口更新）
    const allowedFields = ["modelId", "settings", "title", "groupId", "agentId"];
    const updateData: any = {};

    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    // 模型引用写入边界校验：拒绝解析不到的 id（权威来源是 providers/*.yaml）
    if (updateData.modelId !== undefined) {
      assertResolvableModelRef(this.modelStore, updateData.modelId, 'modelId');
    }

    const updatedSession = await this.sessionStore.update(sessionId, updateData);

    return updatedSession;
  }

  /**
   * 删除会话及其关联的消息
   * @param sessionId 会话 ID
   * @param deleteWorkspace 是否同时删除工作目录（默认 false）
   */
  async deleteSession(sessionId: string, deleteWorkspace: boolean = false) {
    const session = await this.hydrateSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // 运行中禁止删除（对齐 archiveSession 的护栏）：主会话或任一子会话有活跃流即拒绝。
    // 子会话随主会话级联删除，若此时引擎仍在写 JSONL，会写向已删目录产生竞态
    // （孤儿 SSE 事件 + 落盘报错），故子会话的活跃流同样纳入检测。
    const children = this.sessionStore.childrenOf(sessionId);
    const activeChild = children.find((c) =>
      this.streamManager.hasActiveStream(c.id),
    );
    if (this.streamManager.hasActiveStream(sessionId) || activeChild) {
      throw new HttpException(
        {
          error: activeChild
            ? "子代理正在运行中，请先停止后再删除会话"
            : "会话正在流式输出中，无法删除",
          code: "SESSION_STREAMING",
          activeSessionId: activeChild ? activeChild.id : sessionId,
        },
        HttpStatus.CONFLICT,
      );
    }

    // 子会话（子代理 / workflow 成员，含已冻结的）随主会话一并删除：
    // Prisma 自关联未配置 onDelete，若只删主会话，子会话会被 ON DELETE SET NULL 孤儿化
    await this.sessionStore.deleteChildrenOf(sessionId);

    // 级联删除消息（Prisma Schema 中已配置 onDelete: Cascade）
    await this.sessionStore.deleteSession(sessionId);

    // 同步删除 JSONL 事件存储目录（含子会话），避免遗留孤儿目录（此前只删 DB，目录会永久泄漏）。
    // 失败不影响会话删除本身：DB 行已删，目录可稍后手工清理。
    try {
      await this.contextManager.clearSessionTurns(sessionId);
      for (const child of children) {
        await this.contextManager.clearSessionTurns(child.id);
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to delete session storage for ${sessionId}: ${err?.message ?? err}`,
      );
    }

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
  async generateTitle(sessionId: string) {
    let session: any = null;
    try {
      // 验证会话归属权
      session = await this.getSessionById(sessionId);
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
      const recentMessages = await this.contextManager.loadContext({
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
      const model = await this.modelStore.findModel(titleModelId);
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
          // 过滤掉空内容（三层 Message：提取 text/tool-result 块文本）
          const text = m.content
            .map((b) => (b.type === "text" ? b.text : b.type === "tool-result" ? b.content : ""))
            .join("")
            .trim();
          return text.length > 0;
        })
        .map((m) => ({
          role: m.role,
          content: m.content
            .map((b) => (b.type === "text" ? b.text : b.type === "tool-result" ? b.content : ""))
            .join("")
            .trim(),
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
        messages: [
          {
            id: "title",
            role: "user",
            kind: "user",
            source: { kind: "user" },
            metadata: {},
            content: [{ type: "text", text: prompt }],
          },
        ],
        temperature: 0.3, // 较低的温度使输出更稳定
        maxTokens: 50, // 限制输出长度
        thinkingEffort: resolveThinkingEffort(model, "none"), // 禁用思考功能
        stream: false,
        providerConfig: toRuntimeProviderConfig(model.provider),
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
      await this.sessionStore.update(sessionId, { title: newTitle });

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
   * 根据 git diff 流式生成提交信息（SSE）
   * 模型选择：优先标题总结模型（SK_MOD_TITLE_MODEL），无则回退当前对话模型（SK_MOD_CHAT）
   * 事件序列：{ type: "text", content } 增量 / { type: "done", message, modelId, modelName, modelSource } /
   *          { type: "skipped", reason }
   * @param diffText git diff 文本
   * @param constraintText 项目提交约束（.guada/git/commit_constraint.md 内容，可为空）
   * @param abortSignal 取消信号
   */
  async *generateCommitMessageStream(
    diffText: string,
    constraintText?: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<
    { type: string; content?: string; message?: string; modelId?: string; modelName?: string; modelSource?: string; reason?: string; error?: string },
    void,
    unknown
  > {
    try {
      if (!diffText?.trim()) {
        yield { type: "skipped", reason: "empty_diff" };
        return;
      }

      // 1. 模型选择：标题总结模型优先，无则回退当前对话模型
      let modelId = await this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_TITLE_MODEL,
      );
      let modelSource = "title";
      if (!modelId) {
        modelId = await this.settingsStorage.getSettingValue(
          SG_MODELS,
          SK_MOD_CHAT,
        );
        modelSource = "chat";
      }
      if (!modelId) {
        yield { type: "skipped", reason: "no_model_configured" };
        return;
      }

      const model = await this.modelStore.findModel(modelId);
      if (!model) {
        yield { type: "skipped", reason: "model_not_found" };
        return;
      }

      // 2. 构建提示词：引导输出项目提交风格（Conventional Commits + 中文标题 + 要点正文）
      const constraintSection =
        constraintText?.trim()
          ? `\n项目提交规范（必须严格遵守）：\n${constraintText.trim()}\n`
          : "";
      const prompt = `你是一名资深工程师，请根据以下 git diff 生成一条规范的提交信息。

提交信息格式要求：
1. 第一行为标题：type(scope): 中文描述（type 取 feat/fix/refactor/chore/docs/style/perf/test；scope 可选，如组件/模块名）
2. 若改动有多个要点，标题下空一行，用编号列表（1. 2. 3.）补充 2-5 条要点
3. 直接返回提交信息本体，不要任何解释、引号或代码块包裹
${constraintSection}
git diff：
${diffText}

生成的提交信息：`;

      // 3. 流式调用 LLM（禁用思考）
      const stream = await this.llmService.completions({
        model: model.modelName,
        messages: [
          {
            id: "commit",
            role: "user",
            kind: "user",
            source: { kind: "user" },
            metadata: {},
            content: [{ type: "text", text: prompt }],
          },
        ],
        temperature: 0.3,
        maxTokens: 300,
        thinkingEffort: resolveThinkingEffort(model, "none"),
        stream: true,
        abortSignal,
        providerConfig: toRuntimeProviderConfig(model.provider),
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (abortSignal?.aborted) break;
        if (chunk?.type === "text" && chunk.content) {
          fullText += chunk.content;
          yield { type: "text", content: chunk.content };
        }
      }

      const message = fullText.trim();
      if (!message) {
        yield { type: "skipped", reason: "generation_failed" };
        return;
      }
      yield {
        type: "done",
        message,
        modelId: model.id,
        modelName: model.modelName,
        modelSource,
      };
    } catch (error: any) {
      if (abortSignal?.aborted) {
        yield { type: "skipped", reason: "aborted" };
        return;
      }
      this.logger.error(
        `Error streaming commit message: ${error.message}`,
        error.stack,
      );
      yield { type: "skipped", reason: "error", error: error.message };
    }
  }

  /**
   * 手动触发会话压缩（异步）
   *
   * 以 kind='maintenance' 维护伪流占用会话（与对话互斥、防重复压缩、支持取消），
   * 压缩事件（compression_start/end/summary/error）经现有流管道下发，REST 立即返回。
   * 使用 SessionContextFactory 确保与 Agent 对话使用完全一致的参数
   */
  async compressSession(sessionId: string) {
    const session = await this.hydrateSession(sessionId);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    // 检查会话是否正在流式输出（含压缩维护流），避免干扰工作流程
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

    // 维护伪流：压缩事件经流管道下发；startStream 失败 = 已有任务进行中（含并发压缩）
    const abortController = new AbortController();
    if (!this.streamManager.startStream(sessionId, abortController, "maintenance")) {
      throw new HttpException(
        { error: "当前会话已有任务进行中", code: "SESSION_BUSY" },
        HttpStatus.CONFLICT,
      );
    }

    this.logger.log(`Manual compression started (async maintenance stream) for session ${sessionId}`);

    const emitStatus = (
      status: "running" | "completed" | "error",
      extra?: Partial<StreamStatusChangedEvent["payload"]>,
    ) => {
      const statusEvent: StreamStatusChangedEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        payload: { status, kind: "maintenance", ...extra },
      };
      this.eventBus.emit("stream.status_changed", statusEvent);
    };

    emitStatus("running");

    void this.compactionCoordinator
      .maybeCompress(context, {
        force: true,
        reason: "manual",
        abortSignal: abortController.signal,
      })
      .then(() => {
        this.streamManager.stopStream(sessionId, "completed");
        emitStatus("completed");
      })
      .catch((error: any) => {
        // coordinator 内部已捕获压缩错误并广播 compression_error；此处兜底流生命周期
        this.logger.error(
          `Manual compression failed for session ${sessionId}: ${error?.message ?? error}`,
        );
        this.streamManager.stopStream(sessionId, "error");
        emitStatus("error", { reason: "error", error: error?.message });
      });

    return { success: true, started: true };
  }

  /**
   * 更新会话最后活跃时间
   */
  async updateLastActiveAt(sessionId: string) {
    return this.sessionStore.updateLastActiveAt(sessionId);
  }

  // ── 会话搜索 ──

  /**
   * 搜索会话 — 标题匹配（Prisma contains）+ 消息内容匹配（JSONL 实时批扫描）
   *
   * 游标协议（base64 JSON，前端不透明透传）：
   * - 无 cursor：title 阶段 —— 标题命中先行返回，并携带扫描清单规模（progress.total）
   * - { phase: "content", offset }：content 阶段 —— 每次扫描 limit 个会话，
   *   前端自动循环拉取直到 hasMore=false，结果边扫边出（VSCode 式渐进）
   *
   * 内容扫描零索引零缓存：每批读 JSONL → 展示链路折叠 → 文本匹配 → 即弃，
   * 不存在索引断供/同步延迟问题（替代已移除的 FTS5 旁路索引）。
   * 扫描顺序 = lastActiveAt DESC，结果大致按新旧程度陆续出现。
   *
   * @param limit 每批扫描的会话数（钳制 1..100）
   */
  async searchSessions(
    keyword: string,
    cursor?: string,
    limit: number = 25,
    includeArchived: boolean = false,
  ): Promise<CursorPaginatedResponse<any>> {
    const batchSize = Math.min(Math.max(limit, 1), 100);
    if (!keyword.trim()) {
      return {
        items: [],
        hasMore: false,
        nextCursor: null,
        progress: { scanned: 0, total: 0 },
      };
    }

    // 标题匹配（两个阶段都查：title 阶段直接返回，content 阶段用于去重）
    const titleMatches = await this.querySessions({ skip: 0, limit: 200, keyword, includeArchived });
    const titleIds = new Set<string>(titleMatches.items.map((s: any) => s.id));

    // 解析游标（旧版时间游标/base64("time|id") 解析失败时视为首扫，自然降级）
    let phase: "title" | "content" = "title";
    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
        if (decoded?.phase === "content") {
          phase = "content";
          offset = Math.max(0, Number(decoded.offset) || 0);
        }
      } catch { /* invalid cursor — ignore */ }
    }

    // 全量会话 id 清单（扫描顺序 = lastActiveAt DESC；bot/子代理会话被 sessionType 排除）
    const scanIds = this.sessionStore.listWebSessionIds(includeArchived);
    const total = scanIds.length;

    if (phase === "title") {
      const items = titleMatches.items.map((item: any) => ({
        ...item,
        isStreaming: this.streamManager.hasActiveStream(item.id),
        matchType: "title" as const,
      }));
      return {
        items,
        hasMore: total > 0,
        nextCursor: total > 0 ? encodeScanCursor(0) : null,
        progress: { scanned: 0, total },
      };
    }

    // content 阶段：扫描一批会话
    const { matches, scanned } = await this.contentSearch.scanBatch(
      keyword, scanIds, offset, batchSize,
    );
    const nextOffset = offset + scanned;
    const contentIds = [...matches.keys()].filter((id) => !titleIds.has(id));

    let items: any[] = [];
    if (contentIds.length > 0) {
      const rows = this.sessionStore.getManyByIds(contentIds);
      const charMap = await this.agentStore.findManyByIds(
        rows
          .map((r: any) => r.agentId)
          .filter((id: any): id is string => typeof id === "string" && id.length > 0),
      );
      const rowMap = new Map(
        rows.map((r: any) => [
          r.id,
          {
            ...r,
            agent: r.agentId ? charMap.get(r.agentId) ?? null : null,
          },
        ]),
      );
      // 保持扫描顺序（lastActiveAt DESC）
      items = contentIds
        .map((id) => rowMap.get(id))
        .filter(Boolean)
        .map((item: any) => ({
          ...item,
          isStreaming: this.streamManager.hasActiveStream(item.id),
          matchType: "content" as const,
          matchSnippet: matches.get(item.id),
        }));
    }

    const hasMore = nextOffset < total;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? encodeScanCursor(nextOffset) : null,
      progress: { scanned: nextOffset, total },
    };
  }
}

/** 搜索游标编码：base64(JSON { phase, offset })，前端不透明透传 */
function encodeScanCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({ phase: "content", offset }),
    "utf-8",
  ).toString("base64");
}
