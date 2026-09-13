import { Injectable } from "@nestjs/common";
import { CharacterFileStore } from "../../modules/characters/character-file.store";
import {
  byCreatedAsc,
  byLastActiveDesc,
  byUpdatedDesc,
  SessionFileStore,
  SessionMeta,
} from "../../modules/chat/session-file.store";

/** 会话对象上补充的 character 视图（原 Prisma include 形状，title 已更名 name） */
type WithCharacter = { characterId?: string | null };

/**
 * 会话仓储（文件实现）
 *
 * 元信息权威来源 = `<sessions根>/<sessionId>/meta.json`（见 SessionFileStore）。
 * 本类保留原 Prisma 版本的方法签名，使调用方无需感知存储介质变化。
 */
@Injectable()
export class SessionRepository {
  constructor(
    private sessionStore: SessionFileStore,
    private characterStore: CharacterFileStore,
  ) {}

  /**
   * 角色权威来源是 agents/<id>/AGENT.md，不再是 DB 关系表。
   * 保持 `session.character` 字段形状，调用方（jsonl-session-context / 前端）零改动。
   */
  private async hydrate(session: any): Promise<any> {
    if (!session) return session;
    const character = session.characterId
      ? (await this.characterStore.findById(session.characterId)) ?? null
      : null;
    return { ...session, character };
  }

  private async hydrateMany(sessions: any[]): Promise<any[]> {
    const ids = Array.from(
      new Set(
        sessions
          .map((s) => s.characterId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    const map = await this.characterStore.findManyByIds(ids);
    return sessions.map((s) => ({
      ...s,
      character: s.characterId ? map.get(s.characterId) ?? null : null,
    }));
  }

  async findById(id: string): Promise<any> {
    const session = this.sessionStore.get(id);
    if (!session) return null;
    // children 升序（原 include children orderBy createdAt asc）
    const children = this.sessionStore.childrenOf(id);
    return this.hydrate({ ...session, children });
  }

  /**
   * 轻量查询会话类型（web/bot/sub_agent），仅取 sessionType。
   * 供 SSE 补发 stream_status_changed 携带 sessionType 使用。
   */
  async getSessionType(id: string): Promise<string | null> {
    return this.sessionStore.getMeta(id)?.sessionType ?? null;
  }

  /**
   * 获取用户会话列表，支持按分组筛选
   * 默认排除已归档会话
   * @param groupId undefined-全部, null-未分组, string-指定分组
   * @param includeArchived 是否包含已归档会话，默认 false
   * @param keyword 关键词搜索（标题模糊匹配，不区分大小写）
   */
  async findAll(
    skip: number = 0,
    limit: number = 20,
    groupId?: string | null,
    keyword?: string,
    includeArchived: boolean = false,
  ) {
    const needle = keyword?.toLowerCase();
    const rows = this.sessionStore.query(
      (m) =>
        m.sessionType === "web" &&
        (includeArchived || !m.archived) &&
        (groupId === null
          ? m.groupId === null
          : groupId === undefined
            ? true
            : m.groupId === groupId) &&
        (needle ? (m.title ?? "").toLowerCase().includes(needle) : true),
      byLastActiveDesc,
    );
    return {
      items: await this.hydrateMany(
        rows.slice(skip, skip + limit).map((m) => this.sessionStore.get(m.id)!),
      ),
      total: rows.length,
    };
  }

  /**
   * 获取用户已归档的会话列表，支持关键词搜索和分组筛选
   */
  async findArchived(
    skip: number = 0,
    limit: number = 50,
    keyword?: string,
    groupId?: string | null,
  ) {
    const needle = keyword?.toLowerCase();
    const rows = this.sessionStore.query(
      (m) =>
        m.sessionType === "web" &&
        m.archived &&
        (groupId === null
          ? m.groupId === null
          : groupId === undefined
            ? true
            : m.groupId === groupId) &&
        (needle ? (m.title ?? "").toLowerCase().includes(needle) : true),
      byUpdatedDesc,
    );
    return {
      items: await this.hydrateMany(
        rows.slice(skip, skip + limit).map((m) => this.sessionStore.get(m.id)!),
      ),
      total: rows.length,
    };
  }

  async create(data: any): Promise<any> {
    return this.sessionStore.create(data);
  }

  async update(id: string, data: any): Promise<any> {
    return this.sessionStore.update(id, data);
  }

  async deleteById(id: string) {
    return this.sessionStore.deleteSession(id);
  }

  async updateLastActiveAt(id: string) {
    return this.sessionStore.updateLastActiveAt(id);
  }

  /**
   * 查找指定父会话下的所有子会话（createdAt 升序）
   */
  async findByParentId(parentSessionId: string) {
    return this.sessionStore
      .query((m) => m.parentId === parentSessionId, byCreatedAsc)
      .map((m) => this.sessionStore.get(m.id)!);
  }

  /**
   * 统计指定父会话下的活跃子会话数量（排除已冻结的）
   *
   * 子代理每父会话数量上限以此为依据：close/one_shot 冻结子会话后名额即释放。
   */
  async countByParentId(parentSessionId: string) {
    return this.sessionStore.query(
      (m) => m.parentId === parentSessionId && !m.closedAt,
    ).length;
  }

  /**
   * 级联删除指定父会话下的所有子会话
   */
  async deleteByParentId(parentSessionId: string) {
    const children = await this.findByParentId(parentSessionId);
    return this.sessionStore.deleteMany(children.map((c: any) => c.id));
  }

  /**
   * 查询 Bot 专属会话列表（sessionType='bot'）
   */
  async findBotSessions(skip: number = 0, limit: number = 20) {
    const rows = this.sessionStore.query(
      (m) => m.sessionType === "bot",
      byLastActiveDesc,
    );
    return {
      items: await this.hydrateMany(
        rows.slice(skip, skip + limit).map((m) => this.sessionStore.get(m.id)!),
      ),
      total: rows.length,
    };
  }

  /**
   * 根据 botId 和 externalId 查找 Bot 会话
   *
   * 注意：Bot 会话的 characterId 和 modelId 都为 null，这两个字段由调用方动态挂载。
   * 幂等映射直接从内存索引派生，无需独立索引文件。
   */
  async findByBotAndExternalId(botId: string, externalId: string) {
    const meta = this.sessionStore.query(
      (m) =>
        m.botId === botId &&
        m.externalId === externalId &&
        m.sessionType === "bot",
    )[0];
    if (!meta) return null;
    return this.sessionStore.get(meta.id) ?? null;
  }

  // ---- 供搜索等场景直接使用的索引访问 ----

  /** 按 sessionType='web' 的 id 清单（lastActiveAt desc），供内容搜索两阶段协议 */
  listWebSessionIds(includeArchived = false): string[] {
    return this.sessionStore
      .query(
        (m) =>
          m.sessionType === "web" &&
          (includeArchived || !m.archived),
        byLastActiveDesc,
      )
      .map((m) => m.id);
  }

  /** 按 id 批量取行（保持入参顺序，缺失项忽略） */
  getManyByIds(ids: string[]): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const id of ids) {
      const row = this.sessionStore.get(id);
      if (row) out.push(row);
    }
    return out;
  }

  /** 供调试/统计 */
  countAll(): number {
    return this.sessionStore.count();
  }

  /** 原始 meta（含 ISO 时间），供内部判断 */
  getMeta(id: string): SessionMeta | undefined {
    return this.sessionStore.getMeta(id);
  }
}
