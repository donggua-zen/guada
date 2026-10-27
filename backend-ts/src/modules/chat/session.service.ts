import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { getSessionDir } from "../../common/utils/session-path.util";
import { qualifiesForProjectGroup } from "../../common/utils/workspace-key.util";
import type { BaseEvent } from "../../common/persistence/types";
import {
  GENERAL_PROJECT_GROUP_ID,
  SessionMetaStore,
  toRow,
} from "./session-meta.store";
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
import type {
  LLMCompletionResult,
  StreamChunk,
} from "../llm-core/types/llm.types";
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
  SK_MOD_TITLE_MODEL,
} from "../../constants/settings.constants";
import { SessionContextFactory } from "./session-context.factory";
import { WorkspaceWatcherService } from "../../common/services/workspace-watcher.service";
import { SessionStreamManager } from "./session-stream.manager";
import { JobRegistryService } from "../jobs/job-registry.service";
import { EventBusService } from "../../common/events/event-bus.service";
import { StreamStatusChangedEvent } from "../../common/events/stream.events";
import { SessionReplayService } from "./session-replay.service";
import { mergePlanModeSettings } from "./plan-mode-settings.util";
import { normalizeSandboxMode } from "../../common/services/sandbox-policy";
import { pickTitleMessages } from "./session-title.util";
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
    // 允许直接 new 的测试/嵌入场景不挂 Registry；生产由 ChatModule imports JobsModule 注入。
    @Optional() private readonly jobRegistry?: JobRegistryService,
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
    /** 工作目录比较键：null = 通用桶（空路径 + 未注册目录），undefined = 不过滤 */
    workspaceKey?: string | null;
    keyword?: string;
    includeArchived?: boolean;
    /** undefined = 不按置顶过滤；false = 排除置顶（分组区）；true = 仅置顶 */
    pinned?: boolean;
  }): Promise<{ items: any[]; total: number }> {
    const {
      skip = 0,
      limit = 20,
    groupId,
    workspaceKey,
    keyword,
    includeArchived = false,
    pinned,
  } = opts;
    const { rows, total } = this.sessionStore.queryPaged(
      {
        sessionType: "web",
        archived: includeArchived ? undefined : false,
        pinned,
        groupId,
        workspaceKey,
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
    return this.normalizeSessionSettings({ ...session, agent });
  }

  /**
   * 返回带归一化 sandboxMode 的会话副本。
   *
   * 只改响应，不原地改写 store 缓存对象：历史 Windows 会话里可能仍是
   * read-only，读取时必须与执行侧（JsonlSessionContext）保持同一语义。
   */
  private normalizeSessionSettings<T extends Record<string, any>>(session: T): T {
    const settings = session?.settings;
    if (!settings || typeof settings !== "object") return session;
    if (settings.sandboxMode === undefined) return session;
    const normalized = normalizeSandboxMode(settings.sandboxMode);
    if (normalized === settings.sandboxMode) return session;
    return { ...session, settings: { ...settings, sandboxMode: normalized } };
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
    return sessions.map((s) =>
      this.normalizeSessionSettings({
        ...s,
        agent: s.agentId ? (map.get(s.agentId) ?? null) : null,
      }),
    );
  }

  /**
   * 获取用户会话列表，按最后活跃时间倒序排列
   */
  /**
   * 获取用户会话列表，支持按分组查询
   *
   * 端点是侧边栏「加载更多」专用（GET /sessions），与 sidebar 首屏同口径：
   * 排除置顶项（pinned: false）——否则置顶的旧会话会占用分页槽位，
   * 被前端过滤后表现为"少了一条"。置顶会话由 GET /sessions/pinned 提供。
   * @param groupId 分组ID，null表示未分组，undefined表示全部
   */
  async getSessions(
    skip: number = 0,
    limit: number = 20,
    groupId?: string | null,
    keyword?: string,
    includeArchived: boolean = false,
  ): Promise<PaginatedResponse<any>> {
    const { items, total } = await this.querySessions({
      skip,
      limit,
      groupId,
      keyword,
      includeArchived,
      pinned: false,
    });

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
   *
   * 分组区排除置顶项（pinned: false）——置顶会话由 getPinnedSessions 单独提供，
   * 两者互斥避免同一会话在侧边栏出现两次；total 同步排除，保证分页计数一致。
   */
  async getSidebarSessions(limit: number = 10) {
    const groups = await this.sessionGroupService.getGroups();

    // 所有分组 ID + null（未分组），并行查询
    const groupIds: (string | null)[] = [...groups.map((g) => g.id), null];
    const results = await Promise.all(
      groupIds.map((gid) =>
        this.querySessions({
          skip: 0,
          limit,
          groupId: gid,
          includeArchived: false,
          pinned: false,
        }),
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
   * 侧边栏按工作目录批量获取（目录模式）。
   *
   * 返回 = 已注册的 `project_groups`（按用户 position 排序）+ 虚拟「通用」桶。
   * 「通用」= 空 workspacePath + 未注册目录（含自动生成目录与 public），
   * 由 `workspaceKey: null` 谓词统一表达，无需在 SQL 里做命名匹配。
   */
  async getSidebarSessionsByProject(limit: number = 10) {
    const groups = await this.sessionStore.listProjectGroups();
    const results = await Promise.all([
      ...groups.map((group) =>
        this.querySessions({
          skip: 0,
          limit,
          workspaceKey: group.pathKey,
          includeArchived: false,
          pinned: false,
        }),
      ),
      // 末位是通用桶（未注册目录 + 空路径）
      this.querySessions({
        skip: 0,
        limit,
        workspaceKey: null,
        includeArchived: false,
        pinned: false,
      }),
    ]);
    const general = results[groups.length];

    // 目录分组从会话派生：没有可见会话的目录不渲染，避免侧栏出现一片
    // 「暂无任务」的空分组。分组行与用户改名/排序保留——取消归档或取消
    // 置顶后，该目录自动重新出现在侧栏。
    const visible = groups
      .map((group, index) => ({ group, result: results[index] }))
      .filter(({ result }) => result.total > 0);

    const toBucket = (groupId: string, result: { items: any[]; total: number }) => ({
      groupId,
      items: result.items.map((item) => ({
        ...item,
        isStreaming: this.streamManager.hasActiveStream(item.id),
      })),
      total: result.total,
      hasMore: result.items.length < result.total,
    });

    return {
      groupBy: "workspace",
      groups: visible.map(({ group }) => ({
        id: group.id,
        name: group.name,
        path: group.path,
        pathKey: group.pathKey,
        icon: group.icon,
        sortOrder: group.position,
        isOverridden: group.nameOverridden,
        kind: "workspace",
      })),
      // 名称由前端 i18n 提供（后端不做文案）
      generalGroup: { id: GENERAL_PROJECT_GROUP_ID, kind: "general" },
      groupSessions: [
        ...visible.map(({ group, result }) => toBucket(group.id, result)),
        toBucket(GENERAL_PROJECT_GROUP_ID, general),
      ],
    };
  }

  /**
   * 目录模式下按桶分页（侧栏「加载更多」）。
   * - `bucketId = __general__` → 通用桶
   * - 其他 → 分组 id（未知 id 返回空页，不报错）
   */
  async getSessionsByProjectGroup(
    bucketId: string,
    skip: number = 0,
    limit: number = 20,
  ) {
    let workspaceKey: string | null | undefined;
    if (bucketId === GENERAL_PROJECT_GROUP_ID) {
      workspaceKey = null;
    } else {
      const group = await this.sessionStore.findProjectGroup(bucketId);
      workspaceKey = group?.pathKey;
    }
    if (workspaceKey === undefined) {
      return createPaginatedResponse([], 0, { skip, limit });
    }
    const { items, total } = await this.querySessions({
      skip,
      limit,
      workspaceKey,
      includeArchived: false,
      pinned: false,
    });
    return createPaginatedResponse(
      items.map((item) => ({
        ...item,
        isStreaming: this.streamManager.hasActiveStream(item.id),
      })),
      total,
      { skip, limit },
    );
  }

  /**
   * 项目分组统计（仅 web 会话，与侧栏口径一致）。
   * 供删除/归档确认弹窗展示影响范围。
   */
  async getProjectGroupStats(pathKey: string) {
    const count = (extra: { archived?: boolean; pinned?: boolean }) =>
      this.sessionStore.queryPaged(
        { workspaceKey: pathKey, sessionType: "web", ...extra },
        "lastActiveDesc",
        { skip: 0, limit: 0 },
      ).total;

    const total = count({});
    const active = count({ archived: false });
    const pinned = count({ archived: false, pinned: true });
    return { total, active, archived: total - active, pinned };
  }

  /**
   * 归档项目下的全部对话：置顶也归档，已归档跳过，流式输出中的跳过。
   * 返回成功归档的 id，供前端精确清理本地会话缓存。
   */
  async archiveProjectGroupSessions(
    pathKey: string,
  ): Promise<{ archived: number; skipped: number; sessionIds: string[] }> {
    const ids = this.sessionStore
      .query(
        { workspaceKey: pathKey, sessionType: "web", archived: false },
        "createdAsc",
      )
      .map((meta) => meta.id);
    if (ids.length === 0) {
      return { archived: 0, skipped: 0, sessionIds: [] };
    }

    const result = await this.batchArchiveSessions(ids, true);
    const skipped = new Set(result.skipped);
    const sessionIds = ids.filter((id) => !skipped.has(id));
    return {
      archived: sessionIds.length,
      skipped: skipped.size,
      sessionIds,
    };
  }

  /**
   * 删除项目下的全部对话（含已归档/置顶；子会话级联删除）。
   *
   * 先整体预检流式输出：任一会话或其子会话在跑就直接拒绝，避免"删了一半"。
   * 工作目录与其中的文件不删除（deleteWorkspace=false）。
   */
  async deleteProjectGroupSessions(
    pathKey: string,
  ): Promise<{ deleted: number; sessionIds: string[] }> {
    const metas = this.sessionStore.query(
      { workspaceKey: pathKey, sessionType: "web" },
      "createdAsc",
    );

    // 预检：主会话或任一子会话有活跃流 → 整体中止（不做部分删除）
    for (const meta of metas) {
      const activeChild = this.sessionStore
        .childrenOf(meta.id)
        .find((child) => this.streamManager.hasActiveStream(child.id));
      if (this.streamManager.hasActiveStream(meta.id) || activeChild) {
        throw new HttpException(
          {
            error: activeChild
              ? "子代理正在运行中，请先停止后再删除项目"
              : "项目下有会话正在流式输出中，请先停止后再删除项目",
            code: "PROJECT_GROUP_STREAMING",
            activeSessionId: activeChild ? activeChild.id : meta.id,
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    const sessionIds: string[] = [];
    for (const meta of metas) {
      await this.deleteSession(meta.id, false);
      sessionIds.push(meta.id);
    }
    return { deleted: sessionIds.length, sessionIds };
  }

  /**
   * 置顶会话清单（侧边栏顶部「已置顶」分区）。
   *
   * 归集所有「已置顶且未归档」的 web 会话，lastActiveAt desc。
   * 不分页——置顶数量天然有限；与分组区互斥（分组区查询传 pinned: false）。
   */
  async getPinnedSessions() {
    const rows = this.sessionStore.query(
      { sessionType: "web", archived: false, pinned: true },
      "lastActiveDesc",
    );
    const items = await this.hydrateMany(rows.map((m) => toRow(m)));
    return {
      items: items.map((item) => ({
        ...item,
        isStreaming: this.streamManager.hasActiveStream(item.id),
      })),
    };
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
   * 目录分组写时注册（幂等、失败不阻断建会话）。
   *
   * 只有用户显式指定的真实目录才注册；自动生成目录与 `<baseDir>/public` 不注册
   * —— 它们在侧栏目录模式下统一归入「通用」桶（避免自动目录撑爆分组列表）。
   */
  private async registerProjectGroupForWorkspace(
    workspacePath: string | null | undefined,
  ): Promise<void> {
    if (!workspacePath) return;
    try {
      const baseDir = await this.workspaceService.getEffectiveBaseDir();
      if (!qualifiesForProjectGroup(workspacePath, baseDir)) return;
      await this.sessionStore.ensureProjectGroup({
        path: workspacePath,
        prepend: true,
      });
    } catch (err: any) {
      this.logger.warn(
        `Directory group registration failed for ${workspacePath}: ${err?.message ?? err}`,
      );
    }
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

    // 确定使用的模型 ID：优先使用传入的 modelId，其次使用智能体的 modelId。
    // 全局默认对话模型已移除：两者都没有时直接拒绝创建，避免落一个无法对话的会话。
    const finalModelId = modelId || agent.modelId;
    if (!finalModelId) {
      throw new BadRequestException({
        error: "未指定模型：请先为会话或智能体选择模型",
        code: "MODEL_REQUIRED",
      });
    }

    // 验证模型是否存在（isActive 只影响前端展示，不影响实际使用）
    const model = await this.modelStore.findModel(finalModelId);
    if (!model) {
      throw new Error(`模型不存在：${finalModelId}，请检查模型配置`);
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

    // 目录分组：显式目录写时注册（幂等）。失败不影响建会话。
    await this.registerProjectGroupForWorkspace(finalWorkspacePath);

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
      // 老会话未绑定模型时继承智能体模型；全局默认已移除
      modelId: source.modelId || source.agent?.modelId || null,
      settings: (() => {
        if (!source.settings) return null;
        const copied = JSON.parse(JSON.stringify(source.settings));
        copied.sandboxMode = normalizeSandboxMode(
          copied.sandboxMode ?? "workspace-write",
        );
        return copied;
      })(),
      groupId: source.groupId,
      workspacePath: source.workspacePath,
      sessionType: "web",
    });
    const newSessionId = created.id as string;

    // 分支继承同一工作目录 → 确保对应目录分组已注册（幂等）
    await this.registerProjectGroupForWorkspace(source.workspacePath);

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
   * 覆盖：user/message.blocks、assistant/message.content 的 attachment，
   * tool-result 块的 images，以及 tool/result 事件顶层的 images（工具图片归属字段）。
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
      // 附件内嵌位置：user/message 的 blocks、assistant/message 的 content 块数组、
      // tool/result 顶层 images（工具图片不拆分落库，引用挂在工具结果上）
      const data = event.data as {
        blocks?: any[];
        content?: any[];
        images?: any[];
      };
      const blocks =
        event.type === "user/message"
          ? data?.blocks
          : event.type === "assistant/message"
            ? data?.content
            : undefined;
      const refs: any[] = [];
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block?.attachment) refs.push(block.attachment);
          // tool-result 块内嵌图片（兼容形态）
          if (Array.isArray(block?.images)) refs.push(...block.images);
        }
      }
      if (event.type === "tool/result" && Array.isArray(data?.images)) {
        refs.push(...data.images);
      }
      for (const ref of refs) {
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

    // 安全档位：Windows 不再提供 read-only，入口即归一化，避免历史/旧客户端
    // 把已取消的档位写进新会话。
    if (filteredSettings.sandboxMode !== undefined) {
      filteredSettings.sandboxMode = normalizeSandboxMode(
        filteredSettings.sandboxMode,
      );
    }

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
    const allowedFields = ["modelId", "settings", "title", "groupId", "agentId", "pinned"];
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

    // 计划模式：合并 settings 并维护 epoch（false -> true 生成新周期）
    let planTransition: { from: boolean; to: boolean } | null = null;
    if (updateData.settings !== undefined) {
      const merged = mergePlanModeSettings(session.settings, updateData.settings);
      const nextSettings: Record<string, any> = { ...merged.settings };
      // 安全档位：即使本次只改其它字段，也把历史 read-only 收敛为当前平台支持的档位；
      // 未传时沿用会话现值，避免部分更新丢字段。
      const currentSettings =
        (session.settings as Record<string, any> | undefined) ?? {};
      nextSettings.sandboxMode = normalizeSandboxMode(
        nextSettings.sandboxMode ??
          currentSettings.sandboxMode ??
          "workspace-write",
      );
      updateData.settings = nextSettings;
      planTransition = merged.transition;
    }

    const updatedSession = await this.sessionStore.update(sessionId, updateData);

    // 用户开关的审计事件：模型退出由 ExitPlanMode 自己写（source='tool'）
    if (planTransition) {
      try {
        await this.contextManager.appendSessionModeChanged(sessionId, {
          planEnabled: planTransition.to,
          previousPlanEnabled: planTransition.from,
          sandboxMode: (updateData.settings?.sandboxMode ??
            (session.settings as Record<string, any>)?.sandboxMode ??
            'workspace-write') as any,
          source: 'user',
        });
      } catch (error: any) {
        this.logger.warn(
          `Failed to append session mode change for ${sessionId}: ${error?.message}`,
        );
      }
    }

    // 返回与 GET /sessions/:id 同形的完整会话：PUT 响应会被客户端直接写回
    // store 作为权威快照，裸 meta 缺少 agent/subSessions，会丢展示字段。
    return (await this.getSessionById(sessionId)) ?? updatedSession;
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
    // 子会话通过 parentId 关联；只删主会话会让它们变成孤儿，因此一并清理。
    // 先取消并清理父/子会话的后台作业，避免删除后 job 仍尝试投递到不存在的会话。
    if (this.jobRegistry) {
      try {
        await Promise.all(
          [sessionId, ...children.map((child) => child.id)].map((id) =>
            this.jobRegistry!.disposeSession(id),
          ),
        );
      } catch (err: any) {
        this.logger.warn(
          `清理会话后台作业失败 (${sessionId}): ${err?.message ?? err}`,
        );
      }
    }

    await this.sessionStore.deleteChildrenOf(sessionId);

    // 级联删除消息（deleteSession 同时清理 JSONL 事件目录）
    await this.sessionStore.deleteSession(sessionId);

    // 同步删除 JSONL 事件存储目录（含子会话），避免遗留孤儿目录。
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

      // 取最近 6 条后过滤 hidden / 注入的 user 消息（计划模式完整提醒落库为
      // role='user' + kind='model'），再取最后 2 条。助手消息同样是 kind='model'，
      // 因此不能只按 kind 过滤，必须同时看 role。
      const recentMessages = pickTitleMessages(
        await this.contextManager.loadContext({
          sessionId,
          maxMessages: 6,
        }),
        2,
      );

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
      const response = (await this.llmService.completions({
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
        purpose: "session_title",
        usageContext: { sessionId },
      })) as LLMCompletionResult;

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
   * 解析提交信息生成所用模型：标题总结模型优先，无则回退当前对话模型
   * （会话自选 modelId → 智能体 modelId，与 JsonlSessionContext.resolveModel 同链）。
   * 配置了但解析不到（模型已删除等）→ model_not_found，不静默换用其它模型。
   */
  private async resolveCommitMessageModel(
    sessionId: string,
  ): Promise<{ model: any; source: "title" | "chat" } | { reason: string }> {
    const titleModelId = await this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_TITLE_MODEL,
    );
    if (titleModelId) {
      const model = this.modelStore.findModel(titleModelId);
      return model ? { model, source: "title" } : { reason: "model_not_found" };
    }

    // 会话自选模型即用户当前对话所用模型；老会话未绑定时回退智能体模型。
    const session = await this.getSessionById(sessionId);
    const sessionModelId = session?.modelId as string | undefined;
    if (sessionModelId) {
      const model = this.modelStore.findModel(sessionModelId);
      return model ? { model, source: "chat" } : { reason: "model_not_found" };
    }

    const agentModelId = session?.agent?.modelId as string | undefined;
    if (agentModelId) {
      const model = this.modelStore.findModel(agentModelId);
      return model ? { model, source: "chat" } : { reason: "model_not_found" };
    }

    return { reason: "no_model_configured" };
  }

  /**
   * 根据 git diff 流式生成提交信息（SSE）
   * 模型选择：优先标题总结模型（SK_MOD_TITLE_MODEL），无则回退当前对话模型
   * （会话自选 modelId → 智能体 modelId）
   * 事件序列：{ type: "text", content } 增量 / { type: "done", message, modelId, modelName, modelSource } /
   *          { type: "skipped", reason }
   * @param sessionId 会话 ID（用于解析当前对话模型）
   * @param diffText git diff 文本
   * @param constraintText 项目提交约束（.guada/git/commit_constraint.md 内容，可为空）
   * @param abortSignal 取消信号
   */
  async *generateCommitMessageStream(
    sessionId: string,
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
      const resolved = await this.resolveCommitMessageModel(sessionId);
      if ("reason" in resolved) {
        yield { type: "skipped", reason: resolved.reason };
        return;
      }
      const { model, source: modelSource } = resolved;

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
      const stream = (await this.llmService.completions({
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
        purpose: "commit_message",
        usageContext: { sessionId },
      })) as AsyncGenerator<StreamChunk>;

      let fullText = "";
      let finishReason: string | undefined;
      for await (const chunk of stream) {
        if (abortSignal?.aborted) break;
        // 规范词表：正文增量为 text_delta（text 字段）；reasoning_delta 是思考内容，不计入
        if (chunk?.type === "text_delta" && chunk.text) {
          fullText += chunk.text;
          yield { type: "text", content: chunk.text };
        } else if (chunk?.type === "finish") {
          finishReason = chunk.finishReason;
        }
      }

      const message = fullText.trim();
      if (!message) {
        this.logger.warn(
          `生成提交信息：模型未返回文本内容（model=${model.modelName}, finishReason=${finishReason ?? "unknown"}）`,
        );
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
  async compressSession(
    sessionId: string,
    opts: { instructions?: string } = {},
  ) {
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
        ...(opts.instructions === undefined
          ? {}
          : { instructions: opts.instructions }),
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
   * 搜索会话 — 标题匹配（SQL LIKE）+ 消息内容匹配（JSONL 实时批扫描）
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
