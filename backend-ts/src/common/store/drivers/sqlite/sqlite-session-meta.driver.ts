/**
 * SQLite 会话元信息驱动（实现 `SessionMetaPort`）
 *
 * 这是**个人版默认驱动**：`<sessions根>/_meta.db` 单文件 SQLite。
 * 启动自愈（孤儿/幽灵行收敛）只活在这里——它是「目录即会话」的个人版语义，
 * 不进端口，数据库/HTTP 驱动不需要也不可能实现。
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';

import {
  resolveSessionsBasePath,
  assertValidId,
} from '../../../utils/session-path.util';
import { mintId } from '../../../persistence/file-store-kit';
import { ID_PREFIXES } from '../../../utils/id.util';
import { normalizeWorkspaceKey } from '../../../utils/workspace-key.util';
import type { SessionMetaPort } from '../../ports/session-meta.port';
import type {
  CreateSessionInput,
  PagedSessionRows,
  SessionQueryFilter,
  SessionQueryPage,
  SessionRow,
  SessionSortKey,
} from '../../ports/types';
import {
  META_COLUMNS,
  buildDataJson,
  escapeLike,
  inspectOrphanLogContent,
  metaToBindings,
  openMetaDb,
  rowToMeta,
  sortSql,
  toISO,
  upsertMetaRow,
} from './meta-schema';

/** 新建会话 id 前缀（统一铸造见 common/utils/id.util.ts） */
const SESSION_ID_PREFIX = ID_PREFIXES.session;

@Injectable()
export class SqliteSessionMetaDriver implements SessionMetaPort, OnModuleDestroy {
  private readonly log = new Logger(SqliteSessionMetaDriver.name);
  private readonly sessionsRoot = resolveSessionsBasePath();

  private db: Database.Database | null = null;
  private initReady: Promise<void> | null = null;

  // ============ 生命周期 ============

  /** 幂等初始化：开库建表 → 孤儿/幽灵收敛 */
  async startup(): Promise<void> {
    this.initReady ??= this.runInitialize();
    return this.initReady;
  }

  private async runInitialize(): Promise<void> {
    await fsp.mkdir(this.sessionsRoot, { recursive: true });
    this.open();
    await this.healOrphanRows();
    this.removeGhostRows();
    this.backfillWorkspaceKeys();
  }

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  private open(): void {
    this.db = openMetaDb(this.sessionsRoot);
  }

  private sessionDir(id: string): string {
    assertValidId(id);
    return path.join(this.sessionsRoot, id);
  }

  /**
   * 派生键自愈：补齐任何漏回填的 `workspace_key`（转换中断 / 迁移中途退出 /
   * 旧行手改）。正常情况下零行命中，代价仅一次索引扫描。
   */
  private backfillWorkspaceKeys(): void {
    if (!this.db) return;
    const rows = this.db
      .prepare(
        `SELECT id, workspace_path FROM sessions
         WHERE workspace_path IS NOT NULL AND workspace_key IS NULL`,
      )
      .all() as { id: string; workspace_path: string }[];
    if (rows.length === 0) return;
    const update = this.db.prepare(
      `UPDATE sessions SET workspace_key = ? WHERE id = ?`,
    );
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        update.run(normalizeWorkspaceKey(row.workspace_path), row.id);
      }
    });
    tx();
  }

  // ============ 启动收敛（孤儿/幽灵） ============

  /**
   * 孤儿自愈：目录有事件日志而库无行（转换中断 / 手删库 / 目录手建）时，
   * 从 `seg-0000.jsonl` 重建骨架——只救含真实往来消息的会话。
   */
  private async healOrphanRows(): Promise<number> {
    if (!this.db) return 0;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.sessionsRoot, { withFileTypes: true });
    } catch {
      return 0;
    }
    let healed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const id = entry.name;
      if (this.readMeta(id)) continue;

      let content: string;
      try {
        content = await fsp.readFile(
          path.join(this.sessionsRoot, id, 'seg-0000.jsonl'),
          'utf8',
        );
      } catch {
        continue; // 无事件日志 → 不是会话
      }
      const parsed = inspectOrphanLogContent(content);
      if (!parsed) continue;

      const meta: SessionRow = {
        id,
        title: parsed.title || null,
        avatarUrl: null,
        description: null,
        modelId: null,
        agentId: null,
        groupId: null,
        settings: null,
        data: null,
        sessionType: 'web',
        archived: false,
        pinned: false,
        botId: null,
        platform: null,
        externalId: null,
        workspacePath: null,
        workspaceKey: null,
        parentId: null,
        rootId: null,
        closedAt: null,
        closeReason: null,
        createdAt: parsed.createdAt,
        updatedAt: parsed.createdAt,
        lastActiveAt: parsed.createdAt,
      };
      upsertMetaRow(this.db, meta);
      healed += 1;
      this.log.warn(`Recovered session "${id}" from event log (no meta row)`);
    }

    if (healed > 0) {
      this.log.log(`Recovered ${healed} session(s) from orphan directories`);
    }
    return healed;
  }

  /** 幽灵清理：库有行而目录无（被绕过本存储删除）→ 删行，对齐「目录即会话」语义 */
  private removeGhostRows(): number {
    if (!this.db) return 0;
    const rows = this.db.prepare(`SELECT id FROM sessions`).all() as {
      id: string;
    }[];
    let removed = 0;
    for (const { id } of rows) {
      if (!fs.existsSync(path.join(this.sessionsRoot, id))) {
        this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
        removed += 1;
        this.log.warn(`Dropped session row "${id}" (directory removed out-of-band)`);
      }
    }
    return removed;
  }

  // ============ 读取 ============

  private readMeta(id: string): SessionRow | null {
    if (!this.db) return null;
    const row = this.db
      .prepare(`SELECT ${META_COLUMNS} FROM sessions WHERE id = ?`)
      .get(id);
    return row ? rowToMeta(row) : null;
  }

  async get(id: string): Promise<SessionRow | null> {
    return this.readMeta(id);
  }

  async has(id: string): Promise<boolean> {
    return this.readMeta(id) !== null;
  }

  async query(
    filter: SessionQueryFilter,
    sort: SessionSortKey = 'lastActiveDesc',
  ): Promise<SessionRow[]> {
    if (!this.db) return [];
    const { where, params } = this.buildWhere(filter);
    const sql =
      `SELECT ${META_COLUMNS} FROM sessions` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY ${sortSql(sort)}`;
    return (this.db.prepare(sql).all(...params) as any[]).map(rowToMeta);
  }

  /**
   * 数据库原生分页：LIMIT/OFFSET + 同事务 COUNT(*)。
   * better-sqlite3 同步 API 下两条语句之间不会插入写；事务包裹使
   * 「total 与分页同一快照」成为硬性保证。排序 tiebreak 为 id，翻页确定。
   */
  async queryPaged(
    filter: SessionQueryFilter,
    sort: SessionSortKey,
    page: SessionQueryPage,
  ): Promise<PagedSessionRows> {
    if (!this.db) return { rows: [], total: 0 };
    const { where, params } = this.buildWhere(filter);
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const limit = page.limit ?? Infinity;
    const skip = page.skip ?? 0;
    const paged = Number.isFinite(limit);
    const run = this.db.transaction(() => {
      const total = (
        this.db!
          .prepare(`SELECT COUNT(*) AS n FROM sessions${whereSql}`)
          .get(...params) as { n: number }
      ).n;
      const sql =
        `SELECT ${META_COLUMNS} FROM sessions` +
        whereSql +
        ` ORDER BY ${sortSql(sort)}` +
        (paged ? ' LIMIT ? OFFSET ?' : '');
      const sqlParams = paged ? [...params, limit, skip] : params;
      const rows = (this.db!.prepare(sql).all(...sqlParams) as any[]).map(
        rowToMeta,
      );
      return { rows, total };
    });
    return run();
  }

  private buildWhere(filter: SessionQueryFilter): {
    where: string[];
    params: any[];
  } {
    const where: string[] = [];
    const params: any[] = [];
    if (filter.sessionType !== undefined) {
      where.push('session_type = ?');
      params.push(filter.sessionType);
    }
    if (filter.excludeSessionTypes?.length) {
      where.push(
        `session_type NOT IN (${filter.excludeSessionTypes.map(() => '?').join(', ')})`,
      );
      params.push(...filter.excludeSessionTypes);
    }
    if (filter.archived !== undefined) {
      where.push('archived = ?');
      params.push(filter.archived ? 1 : 0);
    }
    if (filter.pinned !== undefined) {
      where.push('pinned = ?');
      params.push(filter.pinned ? 1 : 0);
    }
    if (filter.groupId !== undefined) {
      if (filter.groupId === null) {
        where.push('group_id IS NULL');
      } else {
        where.push('group_id = ?');
        params.push(filter.groupId);
      }
    }
    // 工作目录范围：端口用显式三态，驱动在这里还原成 SQL。
    // 「通用」桶 = 空路径 + 未注册目录（自动生成目录与 public 从不注册，天然落这里）。
    if (filter.workspace && filter.workspace.scope !== 'all') {
      if (filter.workspace.scope === 'general') {
        where.push(
          '(workspace_key IS NULL OR workspace_key NOT IN (SELECT path_key FROM project_groups))',
        );
      } else {
        where.push('workspace_key = ?');
        params.push(filter.workspace.workspaceKey ?? null);
      }
    }
    if (filter.parentId !== undefined) {
      where.push('parent_id = ?');
      params.push(filter.parentId);
    }
    if (filter.botId !== undefined) {
      where.push('bot_id = ?');
      params.push(filter.botId);
    }
    const needle = filter.keyword?.toLowerCase();
    if (needle) {
      where.push(`lower(coalesce(title, '')) LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(needle)}%`);
    }
    return { where, params };
  }

  async childrenOf(parentId: string): Promise<SessionRow[]> {
    return this.query({ parentId }, 'createdAsc');
  }

  /** 某父会话下活跃子会话数（排除已冻结 closedAt）——子代理名额上限依据 */
  async countByParentId(parentId: string): Promise<number> {
    if (!this.db) return 0;
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM sessions WHERE parent_id = ? AND closed_at IS NULL`,
        )
        .get(parentId) as { n: number }
    ).n;
  }

  /** 按 botId + externalId 查 bot 会话（复合索引；幂等映射） */
  async findByBotAndExternalId(
    botId: string,
    externalId: string,
  ): Promise<SessionRow | null> {
    if (!this.db) return null;
    const row = this.db
      .prepare(
        `SELECT ${META_COLUMNS} FROM sessions WHERE bot_id = ? AND external_id = ? AND session_type = 'bot' LIMIT 1`,
      )
      .get(botId, externalId);
    return row ? rowToMeta(row) : null;
  }

  /** sessionType='web' 的 id 清单（lastActiveAt desc）——供内容搜索两阶段协议 */
  async listWebSessionIds(includeArchived = false): Promise<string[]> {
    return (
      await this.query(
        { sessionType: 'web', archived: includeArchived ? undefined : false },
        'lastActiveDesc',
      )
    ).map((m) => m.id);
  }

  /** 会话类型（web/bot/sub_agent/team） */
  async getSessionType(id: string): Promise<string | null> {
    return this.readMeta(id)?.sessionType ?? null;
  }

  /** 按 id 批量取行（保持入参顺序，缺失项忽略） */
  async getManyByIds(ids: string[]): Promise<SessionRow[]> {
    const out: SessionRow[] = [];
    for (const id of ids) {
      const row = this.readMeta(id);
      if (row) out.push(row);
    }
    return out;
  }

  /**
   * 列出未绑定模型的主会话（启动回填用）。
   *
   * 只处理 `session_type='web'`：bot 会话的模型由 Bot/智能体运行期解析，
   * 回填会错误覆盖 Bot 配置；子代理会话也不在此处兜底。
   */
  async listWebSessionsWithMissingModel(): Promise<
    Array<{ id: string; agentId: string | null }>
  > {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT id, agent_id FROM sessions
         WHERE session_type = 'web' AND (model_id IS NULL OR model_id = '')`,
      )
      .all() as Array<{ id: string; agent_id: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id ?? null,
    }));
  }

  // ============ 写入 ============

  /**
   * 创建会话元信息（建目录 + 插行；lastActiveAt 默认置为当前时间）。
   * root_id 由 parentId 自动解析（父会话的 root_id，顶层父则取父 id）。
   */
  async create(input: CreateSessionInput): Promise<SessionRow> {
    await this.startup();
    // 缺 id 时本地铸造；显式传入的 id 保持原值（fork 克隆子会话走显式 id）
    let id: string;
    if (input.id === undefined || input.id === null || String(input.id) === '') {
      id = mintId(SESSION_ID_PREFIX);
      while (this.readMeta(id)) id = mintId(SESSION_ID_PREFIX);
    } else {
      id = String(input.id);
      assertValidId(id);
    }
    const parentId = input.parentId ?? null;
    let rootId: string | null = null;
    if (parentId) {
      const parent = this.readMeta(String(parentId));
      rootId = parent?.rootId ?? String(parentId);
    }
    const now = new Date().toISOString();
    const meta: SessionRow = {
      id,
      title: input.title ?? null,
      avatarUrl: input.avatarUrl ?? null,
      description: input.description ?? null,
      modelId: input.modelId ?? null,
      agentId: input.agentId ?? null,
      groupId: input.groupId ?? null,
      settings: input.settings ?? null,
      data: isRecord(input.data) ? input.data : null,
      sessionType: input.sessionType ?? 'web',
      archived: input.archived === true,
      pinned: input.pinned === true,
      botId: input.botId ?? null,
      platform: input.platform ?? null,
      externalId: input.externalId ?? null,
      workspacePath: input.workspacePath ?? null,
      workspaceKey: input.workspacePath
        ? normalizeWorkspaceKey(String(input.workspacePath))
        : null,
      parentId,
      rootId,
      closedAt: toISO(input.closedAt),
      closeReason: input.closeReason ?? null,
      createdAt: toISO(input.createdAt) ?? now,
      updatedAt: now,
      lastActiveAt: toISO(input.lastActiveAt) ?? now,
    };
    // 目录先建：bot 会话在首条消息前没有 JSONL，目录存在性是幽灵清理的判据
    await fsp.mkdir(this.sessionDir(id), { recursive: true });
    this.db!.prepare(
      `INSERT OR REPLACE INTO sessions (${META_COLUMNS}) VALUES ` +
        `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...(metaToBindings(meta) as any[]));
    return meta;
  }

  /**
   * 更新会话元信息（部分字段；undefined 保持原值，`null` 显式置空）。
   * 未命中时返回 null（对齐旧 update 语义）。
   */
  async update(
    id: string,
    patch: Partial<SessionRow>,
  ): Promise<SessionRow | null> {
    await this.startup();
    const current = this.readMeta(id);
    if (!current || !this.db) return null;

    const merged: SessionRow = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === 'createdAt') {
        merged.createdAt = toISO(value) ?? merged.createdAt;
      } else if (
        key === 'updatedAt' ||
        key === 'lastActiveAt' ||
        key === 'closedAt'
      ) {
        (merged as any)[key] = toISO(value);
      } else if (key in merged) {
        (merged as any)[key] = value;
      }
    }
    merged.updatedAt = new Date().toISOString();
    // workspacePath 一旦变更，派生键必须同步重算（当前接口不允许改路径，属防御分支）
    merged.workspaceKey = merged.workspacePath
      ? normalizeWorkspaceKey(merged.workspacePath)
      : null;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (${META_COLUMNS}) VALUES ` +
          `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...(metaToBindings(merged) as any[]));
    return merged;
  }

  /** 仅刷新最后活跃时间（每条消息一次；单字段 UPDATE） */
  async updateLastActiveAt(id: string): Promise<void> {
    await this.startup();
    if (!this.db || !this.readMeta(id)) return;
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE sessions SET updated_at = ?, last_active_at = ? WHERE id = ?`)
      .run(now, now, id);
  }

  /**
   * 仅回填模型引用（启动迁移用）：不触碰 updated_at / last_active_at，
   * 避免历史会话因迁移被顶到最近排序。
   */
  async backfillModelId(id: string, modelId: string): Promise<void> {
    await this.startup();
    if (!this.db) return;
    const result = this.db
      .prepare(`UPDATE sessions SET model_id = ? WHERE id = ?`)
      .run(modelId, id);
    if (result.changes === 0) {
      throw new Error(`session not found: ${id}`);
    }
  }

  // ============ 删除 ============

  /** 按 id 批量删行（不碰磁盘；目录删除归 SessionAssetPort）；返回删除行数 */
  async deleteRows(ids: string[]): Promise<number> {
    await this.startup();
    if (!this.db) return 0;
    let removed = 0;
    for (const id of ids) {
      const existed = this.readMeta(id) !== null;
      if (existed) {
        this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
        removed += 1;
      }
      // 用量账本与 sessions 同库：会话删除即清理，避免统计残留已删除会话。
      // 表不存在时（旧库尚未迁移）忽略——下次 openMetaDb 会补建。
      try {
        this.db.prepare(`DELETE FROM model_usage WHERE session_id = ?`).run(id);
      } catch {
        /* schema 迁移前删除会话：无用量表，忽略 */
      }
    }
    return removed;
  }

  /** 批量把某分组的会话置为未分组（单语句原子；顺带刷新 updatedAt） */
  async clearGroup(groupId: string): Promise<number> {
    await this.startup();
    if (!this.db) return 0;
    const result = this.db
      .prepare(
        `UPDATE sessions SET group_id = NULL, updated_at = ? WHERE group_id = ?`,
      )
      .run(new Date().toISOString(), groupId);
    return result.changes;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export { buildDataJson };
