import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import {
  resolveSessionsBasePath,
  assertValidId,
} from "../../common/utils/session-path.util";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import { mintId, atomicWriteFile } from "../../common/persistence/file-store-kit";
import { ID_PREFIXES } from "../../common/utils/id.util";

/**
 * 会话元信息文件存储
 *
 * 权威来源 = `<sessions根>/<sessionId>/meta.json`（与 JSONL 事件日志、workflows 同目录）。
 * - 目录名即 id，两种来源：
 *   · 存量迁移 = 原 DB 主键（cuid，25 字符）→ 无需重键，引用零改写
 *   · 新建 = `${SESSION_ID_PREFIX}<uuid v4>`（DSH 同款，见 file-store-kit 的 mintId）
 * - 会话增删 = 目录增删；删除会话即 `rm -rf <sessionId>/`（meta 与消息、工作流一起走）
 * - 目录内 JSONL 缺失时仍可是合法会话（bot 会话在首条消息前只有 meta.json）
 *
 * 顺序保证（见 plan）：
 * - 排序键（lastActiveAt/createdAt/updatedAt）是业务数据，落 meta.json 而非文件系统时间
 *   （Electron 数据目录迁移整目录拷贝不保留 mtime，用文件时间会让列表顺序错乱）
 * - 查询时内存过滤 + `sort(...)` + 确定性 id tiebreak；磁盘文件顺序无意义
 * - 内存索引是盘的缓存，不是独立真相；重启全量重扫自愈
 *
 * 设计参考：AgentFileStore/ProviderFileStore（chokidar + 原子写 + 非法隔离），
 * 以及 DSH 的 projcache 模式（派生数据坏了就丢弃，权威永远是文件本身）。
 */

export const META_FILE = "meta.json";
export const GROUPS_FILE = "_groups.json";
/** 分域迁移标记（由 MetadataFileBootstrapService 落盘） */
export const SESSIONS_MIGRATED_MARKER = ".migrated-sessions";

/** 新建会话 id 前缀（统一铸造见 common/utils/id.util.ts，此处为兼容性别名） */
export const SESSION_ID_PREFIX = ID_PREFIXES.session;

// id 合法性校验见 common/utils/session-path.util.ts 的 assertValidId（单一真相，
// 供会话存储与取图路由共用——id 会进 path.join，挡住分隔符与 `..` 是硬约束）。

/**
 * 会话元信息（= 原 session 表行，字段名保持一致便于调用方零改动）
 *
 * 时间字段用 ISO 字符串（JSON 可读、可手改；读取时按需转 Date 供 Prisma 形状兼容）。
 */
export interface SessionMeta {
  id: string;
  title: string | null;
  avatarUrl: string | null;
  description: string | null;
  modelId: string | null;
  agentId: string | null;
  groupId: string | null;
  settings: Record<string, any> | null;
  sessionType: string;
  archived: boolean;
  botId: string | null;
  platform: string | null;
  externalId: string | null;
  workspacePath: string | null;
  parentId: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}

/** 会话分组（原 session_group 表；整表一份文件） */
export interface SessionGroupMeta {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionLoadError {
  file: string;
  message: string;
}

/** 外层用 Date 形状（对齐 Prisma 返回，避免调用方处理字符串） */
function toRow(meta: SessionMeta): Record<string, any> {
  return {
    ...meta,
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
    lastActiveAt: meta.lastActiveAt ? new Date(meta.lastActiveAt) : null,
    closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
}

function toISO(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

@Injectable()
export class SessionFileStore {
  private readonly logger = new Logger(SessionFileStore.name);
  private readonly baseDir: string;

  /** id → meta（内存索引；盘为权威，此处只是缓存） */
  private index = new Map<string, SessionMeta>();
  private loadErrors = new Map<string, SessionLoadError>();

  private ready: Promise<void> | null = null;

  /** 每会话写互斥：meta.json 是整文件重写（RMW），并发写会丢更新 */
  private writeChains = new Map<string, Promise<unknown>>();

  constructor(private readonly gate: MetadataBootstrapGate) {
    this.baseDir = resolveSessionsBasePath();
  }

  getDirectory(): string {
    return this.baseDir;
  }

  /** 会话目录（meta.json 与 JSONL/workflows 同目录） */
  getSessionDir(sessionId: string): string {
    return path.join(this.baseDir, sessionId);
  }

  getMetaPath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), META_FILE);
  }

  /** 幂等初始化：等导出引导放行 → 全量扫描建索引 → 启动监听 */
  async initialize(): Promise<void> {
    this.ready ??= this.doInitialize();
    return this.ready;
  }

  private async doInitialize(): Promise<void> {
    // 迁移导出未完成时不得读索引（否则读到空目录会把会话"变没"）
    await this.gate.wait(META_DOMAIN_SESSIONS);
    await fsp.mkdir(this.baseDir, { recursive: true });
    await this.loadAll();
    const healed = await this.healOrphanSessions();
    if (healed > 0) await this.loadAll();
  }

  /**
   * 孤儿自愈：目录内有 JSONL 事件日志但缺 meta.json（用户手删 / 导出中断）时，
   * 从 manifest.json + `session/init` 事件重建骨架 meta，避免会话从列表里"消失"。
   *
   * 只救含真实往来消息的会话：仅 `session/init` 的空壳目录是历史遗留产物
   * （例如建了目录但从未对话），复活它们会在侧边栏产生幽灵会话，故跳过。
   */
  private async healOrphanSessions(): Promise<number> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.baseDir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let healed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = entry.name;
      if (fs.existsSync(path.join(this.baseDir, id, META_FILE))) continue;

      const segment = path.join(this.baseDir, id, "seg-0000.jsonl");
      let content: string;
      try {
        content = await fsp.readFile(segment, "utf8");
      } catch {
        continue; // 无事件日志 → 不是会话
      }

      const parsed = this.inspectOrphanLog(content);
      if (!parsed) continue;

      const meta: SessionMeta = {
        id,
        title: parsed.title || null,
        avatarUrl: null,
        description: null,
        modelId: null,
        agentId: null,
        groupId: null,
        settings: null,
        sessionType: "web",
        archived: false,
        botId: null,
        platform: null,
        externalId: null,
        workspacePath: null,
        parentId: null,
        closedAt: null,
        closeReason: null,
        createdAt: parsed.createdAt,
        updatedAt: parsed.createdAt,
        lastActiveAt: parsed.createdAt,
      };
      await this.writeMeta(meta);
      this.index.set(id, meta);
      healed += 1;
      this.logger.warn(
        `Recovered session "${id}" from event log (missing meta.json)`,
      );
    }

    if (healed > 0) {
      this.logger.log(`Recovered ${healed} session(s) from orphan directories`);
    }
    return healed;
  }

  /** 解析孤儿日志：取首个 init 的标题/时间，跳过纯空壳 */
  private inspectOrphanLog(content: string): {
    title: string;
    createdAt: string;
  } | null {
    const lines = content.split("\n").filter((l) => l.trim());
    let title = "";
    let createdAt: string | null = null;
    let hasRealMessage = false;

    for (const line of lines) {
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt?.type === "session/init") {
        if (!title && typeof evt.data?.title === "string") {
          title = evt.data.title;
        }
        if (!createdAt && typeof evt.time === "number") {
          createdAt = new Date(evt.time).toISOString();
        }
      } else if (typeof evt?.type === "string") {
        // 除 init 外任何事件都说明会话真实发生过（user/message、assistant/message…）
        hasRealMessage = true;
      }
    }

    if (!hasRealMessage) return null;
    return {
      title,
      createdAt: createdAt ?? new Date().toISOString(),
    };
  }

  /**
   * 外部批量写入（迁移导出）后强制重载。
   *
   * **不经过 initialize()**：导出引导自身在门控放行前调用本方法，
   * 若在此等待门控会自锁（等待一个只有导出完成后才会被 complete 的信号）。
   */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  // ============ 索引加载（可插拔点） ============

  /**
   * 全量重扫。
   *
   * 索引来源隔离在此方法内：当前实现直接读每个会话目录的 meta.json。
   * 将来若会话数增长到冷扫成为瓶颈，可在此加派生缓存（权威仍是文件，缓存可丢可重建）。
   */
  private async loadAll(): Promise<void> {
    const started = Date.now();
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.baseDir, { withFileTypes: true });
    } catch {
      return;
    }

    const next = new Map<string, SessionMeta>();
    const nextErrors = new Map<string, SessionLoadError>();
    let skipped = 0;

    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith("."),
    );
    // 限量并发读：串行读在 200+ 会话时约 250ms，并发后约 75ms（上限 32 防句柄耗尽）
    const queue = [...dirs];
    const workers = Array.from(
      { length: Math.min(32, queue.length) },
      async () => {
        while (queue.length > 0) {
          const entry = queue.shift();
          if (!entry) break;
          const id = entry.name;
          const metaPath = path.join(this.baseDir, id, META_FILE);
          try {
            const raw = await fsp.readFile(metaPath, "utf8");
            next.set(id, this.parseMeta(raw, id));
          } catch (err: any) {
            if (err?.code === "ENOENT") {
              // 恰在原子写窗口内的重扫：跳过而非视为已删
              skipped += 1;
              continue;
            }
            nextErrors.set(id, {
              file: `${id}/${META_FILE}`,
              message: err?.message || String(err),
            });
            this.logger.warn(
              `Invalid session meta "${id}" (isolated): ${err?.message || err}`,
            );
          }
        }
      },
    );
    await Promise.all(workers);

    this.index = next;
    this.loadErrors = nextErrors;

    const elapsed = Date.now() - started;
    this.logger.log(
      `Session index built: ${next.size} session(s) in ${elapsed}ms` +
        (nextErrors.size ? `, ${nextErrors.size} invalid` : "") +
        (skipped ? `, ${skipped} skipped (write in flight)` : ""),
    );
  }

  private parseMeta(raw: string, fallbackId: string): SessionMeta {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("meta.json 必须是对象");
    }
    const r = doc as Record<string, any>;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : fallbackId;
    if (id !== fallbackId) {
      // 目录名即 id 是唯一性来源，文件内 id 不一致时以目录名为准
      this.logger.warn(
        `Session meta "${fallbackId}" declares id "${id}", using dir name instead`,
      );
    }
    const now = new Date().toISOString();
    return {
      id: fallbackId,
      title: typeof r.title === "string" ? r.title : null,
      avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : null,
      description: typeof r.description === "string" ? r.description : null,
      modelId: typeof r.modelId === "string" ? r.modelId : null,
      agentId: typeof r.agentId === "string" ? r.agentId : null,
      groupId: typeof r.groupId === "string" ? r.groupId : null,
      settings:
        r.settings && typeof r.settings === "object" && !Array.isArray(r.settings)
          ? r.settings
          : null,
      sessionType: typeof r.sessionType === "string" ? r.sessionType : "web",
      archived: r.archived === true,
      botId: typeof r.botId === "string" ? r.botId : null,
      platform: typeof r.platform === "string" ? r.platform : null,
      externalId: typeof r.externalId === "string" ? r.externalId : null,
      workspacePath:
        typeof r.workspacePath === "string" ? r.workspacePath : null,
      parentId: typeof r.parentId === "string" ? r.parentId : null,
      closedAt: toISO(r.closedAt),
      closeReason: typeof r.closeReason === "string" ? r.closeReason : null,
      createdAt: toISO(r.createdAt) ?? now,
      updatedAt: toISO(r.updatedAt) ?? now,
      lastActiveAt: toISO(r.lastActiveAt),
    };
  }

  // ============ 查询 API（同步，走内存索引） ============

  listLoadErrors(): SessionLoadError[] {
    return Array.from(this.loadErrors.values());
  }

  count(): number {
    return this.index.size;
  }

  /** 原始 meta（含 ISO 字符串时间） */
  getMeta(id: string): SessionMeta | undefined {
    return this.index.get(id);
  }

  /** 行视图（Date 形状，对齐原 Prisma 返回） */
  get(id: string): Record<string, any> | undefined {
    const meta = this.index.get(id);
    return meta ? toRow(meta) : undefined;
  }

  /**
   * 过滤查询。predicate 在内存中执行，返回按 `sort` 排序后的全量结果，
   * 由调用方分页——保证 total 与分页来自同一份快照。
   */
  query(
    predicate: (meta: SessionMeta) => boolean,
    sort: (a: SessionMeta, b: SessionMeta) => number = byLastActiveDesc,
  ): SessionMeta[] {
    const out: SessionMeta[] = [];
    for (const meta of this.index.values()) {
      if (predicate(meta)) out.push(meta);
    }
    out.sort(sort);
    return out;
  }

  /** 由 id 取子会话（升序，用于 findById 的 children） */
  childrenOf(parentId: string): Record<string, any>[] {
    return this.query((m) => m.parentId === parentId, byCreatedAsc).map(toRow);
  }

  /** 某父会话下活跃子会话数（排除已冻结 closedAt）——子代理名额上限依据 */
  countByParentId(parentId: string): number {
    return this.query((m) => m.parentId === parentId && !m.closedAt).length;
  }

  /** 按 botId + externalId 查 bot 会话（幂等映射；无需独立索引文件） */
  findByBotAndExternalId(
    botId: string,
    externalId: string,
  ): Record<string, any> | null {
    const meta = this.query(
      (m) =>
        m.botId === botId &&
        m.externalId === externalId &&
        m.sessionType === "bot",
    )[0];
    if (!meta) return null;
    return this.get(meta.id) ?? null;
  }

  /** sessionType='web' 的 id 清单（lastActiveAt desc）——供内容搜索两阶段协议 */
  listWebSessionIds(includeArchived = false): string[] {
    return this.query(
      (m) => m.sessionType === "web" && (includeArchived || !m.archived),
      byLastActiveDesc,
    ).map((m) => m.id);
  }

  /** 按 id 批量取行（保持入参顺序，缺失项忽略） */
  getManyByIds(ids: string[]): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const id of ids) {
      const row = this.get(id);
      if (row) out.push(row);
    }
    return out;
  }

  /** 会话类型（web/bot/sub_agent） */
  getSessionType(id: string): string | null {
    return this.index.get(id)?.sessionType ?? null;
  }

  /** 级联删除某父会话下的全部子会话（原 deleteByParentId） */
  async deleteChildrenOf(parentId: string): Promise<number> {
    const children = this.query((m) => m.parentId === parentId, byCreatedAsc);
    let n = 0;
    for (const meta of children) {
      if (await this.deleteSession(meta.id)) n += 1;
    }
    return n;
  }

  // ============ 写入 API ============

  /** 是否存在（内存索引；目录存在但 meta 非法时视为不存在） */
  has(id: string): boolean {
    return this.index.has(id);
  }

  /**
   * 创建会话元信息（写 meta.json；目录不存在则创建）。
   * 原 create 语义：lastActiveAt 默认置为当前时间。
   */
  async create(data: Record<string, any>): Promise<Record<string, any>> {
    await this.initialize();
    // 缺 id 时本地铸造（原 DB 的 @default(cuid()) 职责迁到这里）；
    // 生成 id 需避开既有条目，显式传入的 id 保持原值（覆盖语义不变）。
    let id: string;
    if (data.id === undefined || data.id === null || String(data.id) === "") {
      id = this.generateId();
      while (this.index.has(id)) id = this.generateId();
    } else {
      id = String(data.id);
      assertValidId(id);
    }
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id,
      title: data.title ?? null,
      avatarUrl: data.avatarUrl ?? null,
      description: data.description ?? null,
      modelId: data.modelId ?? null,
      agentId: data.agentId ?? null,
      groupId: data.groupId ?? null,
      settings: data.settings ?? null,
      sessionType: data.sessionType ?? "web",
      archived: data.archived === true,
      botId: data.botId ?? null,
      platform: data.platform ?? null,
      externalId: data.externalId ?? null,
      workspacePath: data.workspacePath ?? null,
      parentId: data.parentId ?? null,
      closedAt: toISO(data.closedAt),
      closeReason: data.closeReason ?? null,
      createdAt: toISO(data.createdAt) ?? now,
      updatedAt: now,
      lastActiveAt: toISO(data.lastActiveAt) ?? now,
    };
    await this.withLock(id, async () => {
      await this.writeMeta(meta);
      this.index.set(id, meta);
    });
    return toRow(meta);
  }

  /**
   * 更新会话元信息（部分字段；undefined 保持原值，`null` 显式置空）。
   * 未命中索引时返回 undefined（对齐 Prisma update 抛 P2025 前的调用方预期）。
   */
  async update(
    id: string,
    data: Record<string, any>,
  ): Promise<Record<string, any> | undefined> {
    await this.initialize();
    const current = this.index.get(id);
    if (!current) return undefined;

    const next = await this.withLock(id, async () => {
      const merged: SessionMeta = { ...this.index.get(id)! };
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === "createdAt") {
          merged.createdAt = toISO(value) ?? merged.createdAt;
        } else if (
          key === "updatedAt" ||
          key === "lastActiveAt" ||
          key === "closedAt"
        ) {
          (merged as any)[key] = toISO(value);
        } else if (key in merged) {
          (merged as any)[key] = value;
        }
      }
      merged.updatedAt = new Date().toISOString();
      await this.writeMeta(merged);
      this.index.set(id, merged);
      return merged;
    });
    return toRow(next);
  }

  /** 仅刷新最后活跃时间（每条消息一次；带退避重试） */
  async updateLastActiveAt(id: string): Promise<void> {
    await this.initialize();
    if (!this.index.has(id)) return;
    await this.withLock(id, async () => {
      const current = this.index.get(id);
      if (!current) return;
      const merged: SessionMeta = {
        ...current,
        updatedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };
      await this.writeMeta(merged);
      this.index.set(id, merged);
    });
  }

  /** 删除会话元信息（整目录，含 JSONL/workflows） */
  async deleteSession(id: string): Promise<boolean> {
    await this.initialize();
    // 先校验：下面是无条件的整目录 rm，非法 id（`..`／分隔符）必须挡在这里
    assertValidId(id);
    const existed = this.index.has(id);
    await this.withLock(id, async () => {
      await this.removeDir(this.getSessionDir(id));
      this.index.delete(id);
    });
    return existed;
  }

  /** 级联删除多个会话（子会话） */
  async deleteMany(ids: string[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      if (await this.deleteSession(id)) n += 1;
    }
    return n;
  }

  /** 批量把某分组的会话置为未分组（替代 FK onDelete SetNull） */
  async clearGroup(groupId: string): Promise<number> {
    await this.initialize();
    const targets = this.query((m) => m.groupId === groupId);
    let n = 0;
    for (const meta of targets) {
      await this.update(meta.id, { groupId: null });
      n += 1;
    }
    return n;
  }

  /** 由外部（迁移导出）直接写入 meta.json 并刷新索引 */
  async writeMetaDirect(meta: SessionMeta): Promise<void> {
    await this.withLock(meta.id, async () => {
      await this.writeMeta(meta);
      this.index.set(meta.id, meta);
    });
  }

  // ============ 分组（_groups.json） ============

  private get groupsPath(): string {
    return path.join(this.baseDir, GROUPS_FILE);
  }

  async readGroups(): Promise<SessionGroupMeta[]> {
    try {
      const raw = await fsp.readFile(this.groupsPath, "utf8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.groups;
      if (!Array.isArray(list)) return [];
      return list.filter(
        (g: any) => g && typeof g === "object" && typeof g.id === "string",
      ) as SessionGroupMeta[];
    } catch {
      return [];
    }
  }

  async writeGroups(groups: SessionGroupMeta[]): Promise<void> {
    await fsp.mkdir(this.baseDir, { recursive: true });
    await this.atomicWrite(this.groupsPath, JSON.stringify(groups, null, 2));
  }

  /** 分组列表（按 sortOrder 升序；与旧 repo.findAll 同序） */
  async listGroups(): Promise<SessionGroupMeta[]> {
    const groups = await this.readGroups();
    return groups.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findGroupById(id: string): Promise<SessionGroupMeta | undefined> {
    return (await this.readGroups()).find((g) => g.id === id);
  }

  /** 新建分组（id 为 cuid 风格，与存量分组 id 形态一致） */
  async createGroup(data: {
    name: string;
    sortOrder?: number;
  }): Promise<SessionGroupMeta> {
    const groups = await this.readGroups();
    const now = new Date().toISOString();
    const group: SessionGroupMeta = {
      id: this.generateGroupId(),
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    groups.push(group);
    await this.writeGroups(groups);
    return group;
  }

  async updateGroup(
    id: string,
    data: { name?: string; sortOrder?: number },
  ): Promise<SessionGroupMeta | undefined> {
    const groups = await this.readGroups();
    const target = groups.find((g) => g.id === id);
    if (!target) return undefined;
    if (data.name !== undefined) target.name = data.name;
    if (data.sortOrder !== undefined) target.sortOrder = data.sortOrder;
    target.updatedAt = new Date().toISOString();
    await this.writeGroups(groups);
    return target;
  }

  /** 删除分组：连同该组会话解绑（groupId 置 null，替代 FK onDelete SetNull） */
  async deleteGroup(id: string): Promise<{ id: string }> {
    const groups = await this.readGroups();
    await this.writeGroups(groups.filter((g) => g.id !== id));
    await this.clearGroup(id);
    return { id };
  }

  /** 当前最大 sortOrder（新建分组排在最后） */
  async getMaxGroupSortOrder(): Promise<number> {
    const groups = await this.readGroups();
    return groups.reduce((max, g) => Math.max(max, g.sortOrder ?? 0), 0);
  }

  /** 批量更新分组排序（整表一次重写，替代旧 $transaction） */
  async batchUpdateGroupSortOrder(
    updates: { id: string; sortOrder: number }[],
  ): Promise<SessionGroupMeta[]> {
    const groups = await this.readGroups();
    const map = new Map(updates.map((u) => [u.id, u.sortOrder]));
    const now = new Date().toISOString();
    for (const g of groups) {
      const next = map.get(g.id);
      if (next !== undefined) {
        g.sortOrder = next;
        g.updatedAt = now;
      }
    }
    await this.writeGroups(groups);
    return groups.filter((g) => map.has(g.id));
  }

  /** 新建分组 id：统一铸造（grp-<uuid>，前缀见 ID_PREFIXES.group；存量 cuid 分组不迁移） */
  private generateGroupId(): string {
    return mintId(ID_PREFIXES.group);
  }

  // ============ 内部：写入与锁 ============

  /** 新建会话 id（DSH 同款：前缀 + UUID v4；前缀见 SESSION_ID_PREFIX） */
  private generateId(): string {
    return mintId(SESSION_ID_PREFIX);
  }

  private async writeMeta(meta: SessionMeta): Promise<void> {
    const dir = this.getSessionDir(meta.id);
    await fsp.mkdir(dir, { recursive: true });
    await this.atomicWrite(
      path.join(dir, META_FILE),
      JSON.stringify(meta, null, 2),
    );
  }

  /** 每会话串行化，保证读-改-写不丢更新 */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(id) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // 存归一化后的 promise（吞掉异常），保证 finally 里的身份比较成立、条目能被清理
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeChains.set(id, tracked);
    try {
      return await run;
    } finally {
      if (this.writeChains.get(id) === tracked) this.writeChains.delete(id);
    }
  }

  /**
   * 原子写：tmp + rename。
   *
   * Windows 下 rename 不能覆盖已存在文件，且目标被杀毒/索引服务短暂持有时会
   * EPERM/EBUSY——因此先 unlink 再 rename，并对失败做退避重试。
   * updateLastActiveAt 是每条消息一次的最高频写，静默失败会让会话在侧边栏不跳顶。
   * 机制实现在 common/persistence/file-store-kit（atomicWriteFile）。
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    await atomicWriteFile(filePath, content);
  }

  /** 删除目录（Windows 上句柄可能短暂占用，重试） */
  private async removeDir(dir: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fsp.rm(dir, { recursive: true, force: true });
        return;
      } catch (err: any) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }
}

// ============ 排序（确定性 tiebreak 保证同查询同顺序） ============

function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function byLastActiveDesc(a: SessionMeta, b: SessionMeta): number {
  const diff = timeOf(b.lastActiveAt) - timeOf(a.lastActiveAt);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

export function byUpdatedDesc(a: SessionMeta, b: SessionMeta): number {
  const diff = timeOf(b.updatedAt) - timeOf(a.updatedAt);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

export function byCreatedAsc(a: SessionMeta, b: SessionMeta): number {
  const diff = timeOf(a.createdAt) - timeOf(b.createdAt);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}
