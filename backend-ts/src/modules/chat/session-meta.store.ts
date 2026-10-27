import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Database from "better-sqlite3";

import {
  resolveSessionsBasePath,
  assertValidId,
} from "../../common/utils/session-path.util";
import { mintId } from "../../common/persistence/file-store-kit";
import { ID_PREFIXES } from "../../common/utils/id.util";
import {
  normalizeWorkspaceKey,
  workspaceBasename,
} from "../../common/utils/workspace-key.util";

/**
 * 会话元数据存储（`<sessions根>/_meta.db`）
 *
 * 权威来源 = 本 SQLite 库；消息事件仍是 JSONL 事件溯源（见 persistence/），互不越界。
 * 元数据是「小、关系型、写热」的数据（childrenOf / 分组过滤 / 每条消息一次的
 * lastActiveAt），SQLite 直接给到索引与事务；消息是「大、追加型」数据，留在文件。
 *
 * ## 无文件兼容层（刻意为之）
 *
 * 文件版会话元数据（meta.json / _groups.json）**从未上线**。本存储只认
 * `_meta.db`；删掉 `_meta.db` 后，有 `seg-0000.jsonl` 的会话目录会在启动自愈时
 * 重建骨架行（见下方「自愈」）。
 *
 * ## 自愈（启动收敛）
 *
 * - 目录有 `seg-0000.jsonl` 事件日志而库无行（转换中断 / 手删库）→ 重建骨架行；
 *   只救含真实往来消息的会话，纯 `session/init` 空壳跳过（否则侧栏出幽灵会话）
 * - 库有行而目录无（被绕过本存储手删）→ 删行。对齐「目录即会话」语义
 *
 * ## 扩展位
 *
 * 两表都有通用 `data` 列（JSON 文本，不索引）：新增非索引字段无需 schema 变更。
 * `settings` 是 `sessions.data` 下的受管键（读 = `data.settings ?? null`，写以
 * `meta.settings` 为准），data 其余键自由透传。
 */

export const META_DB_FILE = "_meta.db";
/** 当前 schema 版本；结构调整 +1 并在 migrate() 追加一步 */
export const SESSION_META_DB_VERSION = 7;
/**
 * 目录分组一次性注册标记（库内键）。删库即视为未注册，下次启动自动重扫历史
 * `workspace_key`；已改名的分组不会被覆盖（INSERT OR IGNORE）。
 */
export const PROJECT_GROUPS_BOOTSTRAPPED_KEY = "project_groups_bootstrapped_at";
/** 侧栏目录模式下的虚拟「通用」桶 id（无实体行；跨前后端协议常量） */
export const GENERAL_PROJECT_GROUP_ID = "__general__";

/**
 * 会话元信息（= 原 session 表行，字段名保持一致便于调用方零改动）
 *
 * 时间字段用 ISO 字符串（JSON 可读、可手改；读取时按需转 Date 兼容既有调用方）。
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
  /**
   * 通用扩展字段（不索引，未来新字段放这里）。
   * 落 `sessions.data` 列（JSON 文本），`settings` 折叠为其中的 `settings` 键
   * （以 meta.settings 为准）。
   */
  data: Record<string, any> | null;
  sessionType: string;
  archived: boolean;
  /** 置顶：侧边栏「已置顶」分区展示，并从所属分组区排除（互斥，避免重复） */
  pinned: boolean;
  botId: string | null;
  platform: string | null;
  externalId: string | null;
  workspacePath: string | null;
  /**
   * 工作目录比较键（`normalizeWorkspaceKey` 派生列，落库供 GROUP BY / 等值查询）。
   * 随接口原样下发，前端按它匹配目录分组，避免两端各自归一化产生漂移。
   */
  workspaceKey: string | null;
  parentId: string | null;
  /** 顶层祖先会话 id（主会话自身为 null；子会话 = 顶层主会话 id） */
  rootId: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}

/** 会话分组（原 session_group 表行） */
export interface SessionGroupMeta {
  id: string;
  name: string;
  sortOrder: number;
  /** 自定义图标 key（Fluent 白名单的字符串标识；null = 默认文件夹） */
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  /** 通用扩展字段（不索引），落 `session_groups.data` 列 */
  data?: Record<string, any> | null;
}

/**
 * 目录分组（`project_groups` 表行）。
 *
 * 身份用 `id`（与路径解耦）而非路径：用户重命名/移动目录后，分组名与排序
 * 不会变成孤儿；成员关系仍是派生——`sessions.workspace_key = path_key`。
 */
export interface ProjectGroupMeta {
  id: string;
  /** 展示用原始路径（首次注册时的写法） */
  path: string;
  /** 归一化比较键（`normalizeWorkspaceKey`），UNIQUE */
  pathKey: string;
  name: string;
  /** 用户改过名（bootstrap 永不覆盖） */
  nameOverridden: boolean;
  /** 自定义图标 key（Fluent 白名单的字符串标识；null = 默认文件夹） */
  icon: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 结构化查询过滤（tri-state 语义）：
 * - `groupId`：null = 仅未分组，undefined = 不过滤
 * - `archived`：undefined = 不过滤
 * - `pinned`：undefined = 不过滤（true = 仅置顶，false = 排除置顶）
 */
export interface SessionQueryFilter {
  sessionType?: string;
  /** 排除的会话类型（目录分组侧栏排除 bot / sub_agent） */
  excludeSessionTypes?: string[];
  archived?: boolean;
  pinned?: boolean;
  groupId?: string | null;
  /**
   * 工作目录比较键（tri-state）：
   * - string = 仅该目录
   * - null   = 「通用」桶（空路径 + 未注册目录 + 自动生成目录 + public）
   * - undefined = 不过滤
   */
  workspaceKey?: string | null;
  /** 标题子串（大小写不敏感） */
  keyword?: string;
  parentId?: string;
  botId?: string;
}

export type SessionSortKey = "lastActiveDesc" | "updatedDesc" | "createdAsc";

/** LIMIT/OFFSET 分页（limit 传 Infinity 或省略 = 不分页） */
export interface SessionQueryPage {
  skip?: number;
  limit?: number;
}

/** queryPaged 返回：页内行 + 同事务快照的总行数 */
export interface PagedQueryResult {
  rows: SessionMeta[];
  total: number;
}

/** 新建会话 id 前缀（统一铸造见 common/utils/id.util.ts） */
export const SESSION_ID_PREFIX = ID_PREFIXES.session;

const SORT_SQL: Record<SessionSortKey, string> = {
  // 确定性 id tiebreak：同查询同顺序
  lastActiveDesc: "last_active_at DESC, id ASC",
  updatedDesc: "updated_at DESC, id ASC",
  createdAsc: "created_at ASC, id ASC",
};

export const META_COLUMNS =
  "id, parent_id, root_id, session_type, title, avatar_url, description, " +
  "model_id, agent_id, group_id, data, workspace_path, workspace_key, bot_id, platform, " +
  "external_id, archived, pinned, closed_at, close_reason, created_at, updated_at, last_active_at";

const V1_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  root_id TEXT,
  session_type TEXT NOT NULL DEFAULT 'web',
  title TEXT,
  avatar_url TEXT,
  description TEXT,
  model_id TEXT,
  agent_id TEXT,
  group_id TEXT,
  settings TEXT,
  workspace_path TEXT,
  bot_id TEXT,
  platform TEXT,
  external_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  close_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_root ON sessions(root_id);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);
CREATE INDEX IF NOT EXISTS idx_sessions_bot ON sessions(bot_id, external_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned);
CREATE TABLE IF NOT EXISTS session_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS _bootstrap (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

/**
 * v5：Token 用量明细表。
 *
 * 一行 = 一次 LLM 请求尝试；回合/会话/日维度由 SQL 聚合，不另建 turn 表。
 * 放在 `_meta.db` 是为了直接 JOIN sessions（标题/类型）并在删除会话时清理。
 * `usage_missing` 标记供应商未返回 usage 的请求（计入请求数，不贡献 token）。
 */
const USAGE_DDL = `
CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY,
  logical_request_id TEXT,
  attempt_index INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  turn_id TEXT,
  assistant_message_id TEXT,
  source TEXT NOT NULL DEFAULT 'main_turn',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  started_at INTEGER NOT NULL,
  first_token_at INTEGER,
  completed_at INTEGER,
  duration_ms INTEGER,
  time_to_first_token_ms INTEGER,
  finish_reason TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  provider_total_tokens INTEGER,
  computed_total_tokens INTEGER NOT NULL DEFAULT 0,
  usage_missing INTEGER NOT NULL DEFAULT 0,
  error_type TEXT,
  error_message TEXT,
  raw_usage_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_usage_started
  ON model_usage(started_at);
CREATE INDEX IF NOT EXISTS idx_model_usage_session_turn
  ON model_usage(session_id, turn_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_message
  ON model_usage(assistant_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_usage_message_attempt
  ON model_usage(assistant_message_id, attempt_index)
  WHERE assistant_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_model_usage_provider_model
  ON model_usage(provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_source
  ON model_usage(source);
`;

/**
 * v6：目录分组。成员关系是派生的（`sessions.workspace_key = path_key`），
 * 因此这里没有成员表，删分组也不需要回写会话——会话自动回落到「通用」桶。
 * 全部 IF NOT EXISTS，无条件执行（对齐 USAGE_DDL 的热重载自愈策略）。
 */
const PROJECT_GROUP_DDL = `
CREATE TABLE IF NOT EXISTS project_groups (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_overridden INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_groups_position ON project_groups(position);
`;

// ============ 行 ↔ 领域对象 ============/** 外层用 Date 形状（兼容既有调用方，避免调用方处理字符串） */
export function toRow(meta: SessionMeta): Record<string, any> {
  return {
    ...meta,
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
    lastActiveAt: meta.lastActiveAt ? new Date(meta.lastActiveAt) : null,
    closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
}

export function toISO(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 普通对象判定（非 null/数组）——settings/data 字段归一用 */
export function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * data 列 JSON 合成：settings 是 data 下的受管键（以 meta.settings 为准），
 * data 其余键自由透传（未来扩展免 schema 变更）。
 */
export function buildDataJson(meta: SessionMeta): string | null {
  const hasData = isPlainObject(meta.data);
  const hasSettings = meta.settings != null;
  if (!hasData && !hasSettings) return null;
  const obj: Record<string, any> = { ...(hasData ? meta.data : {}) };
  obj.settings = meta.settings ?? null;
  return JSON.stringify(obj);
}

/** 分组 data 列 JSON 合成（文件形态可省略 data → 归一 null，better-sqlite3 拒绝 undefined 绑定） */
function groupDataJson(g: SessionGroupMeta): string | null {
  return isPlainObject(g.data) ? JSON.stringify(g.data) : null;
}

function parseJsonObject(text: unknown): Record<string, any> | null {
  if (typeof text !== "string" || !text) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function rowToMeta(r: any): SessionMeta {
  // settings 是 data 下的受管键（以 meta.settings 为准，见 buildDataJson）
  const dataObj = parseJsonObject(r.data);
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    rootId: r.root_id ?? null,
    sessionType: r.session_type,
    title: r.title ?? null,
    avatarUrl: r.avatar_url ?? null,
    description: r.description ?? null,
    modelId: r.model_id ?? null,
    agentId: r.agent_id ?? null,
    groupId: r.group_id ?? null,
    settings: dataObj?.settings ?? null,
    data: dataObj,
    workspacePath: r.workspace_path ?? null,
    // 派生列缺失时（迁移中断/旧行）就地兜底计算，保证读取永远有可用比较键
    workspaceKey:
      r.workspace_key ??
      (typeof r.workspace_path === "string" && r.workspace_path
        ? normalizeWorkspaceKey(r.workspace_path)
        : null),
    botId: r.bot_id ?? null,
    platform: r.platform ?? null,
    externalId: r.external_id ?? null,
    archived: r.archived === 1,
    pinned: r.pinned === 1,
    closedAt: r.closed_at ?? null,
    closeReason: r.close_reason ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActiveAt: r.last_active_at ?? null,
  };
}

function escapeLike(needle: string): string {
  return needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function projectGroupFromRow(r: any): ProjectGroupMeta {
  return {
    id: r.id,
    path: r.path,
    pathKey: r.path_key,
    name: r.name,
    nameOverridden: r.name_overridden === 1,
    icon: r.icon ?? null,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * 解析孤儿事件日志：取首个 `session/init` 的标题/时间，跳过纯空壳
 * （仅 session/init、无任何真实往来消息的目录是历史遗留产物）。
 */
export function inspectOrphanLogContent(content: string): {
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

// ============ 库的打开 / 迁移 / 一次性转换助手 ============
// 助手为「冻结主库 → _meta.db」转换与消息迁移的 meta 修复共用（bootstrap 自持连接，
// 不经 DI——迁移脚手架不得反向依赖域模块的初始化）。

/** 开库 + pragma + schema 迁移（调用方负责 close） */
export function openMetaDb(baseDir: string): Database.Database {
  fs.mkdirSync(baseDir, { recursive: true });
  const db = new Database(path.join(baseDir, META_DB_FILE));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  migrateMetaDbSchema(db);
  return db;
}

export function migrateMetaDbSchema(db: Database.Database): void {
  const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;
  // v2/v3 教训：dev 热重载可能在编辑中途加载「VERSION 已升、迁移步骤未加」的瞬时代码，
  // 把 user_version 误标记而实际没跑迁移，纯版本门控会永久跳过——
  // 因此后续步骤一律按**列存在性**判断，任何误标记状态都可自愈。
  if (version < 1) db.exec(V1_DDL);
  if (version < 3) migrateToDataColumn(db);
  if (version < 4) migrateToPinnedColumn(db);
  // v5 用量表：全部 IF NOT EXISTS，无条件执行，顺带修复热重载误标记。
  db.exec(USAGE_DDL);
  // v6 目录分组：建表、派生列与索引全部按存在性/IF NOT EXISTS 幂等执行。
  db.exec(PROJECT_GROUP_DDL);
  migrateToWorkspaceKeyColumn(db);
  // v7 分组图标：两张分组表各增可空 icon 列（按列存在性自愈）。
  migrateToGroupIconColumn(db);
  db.pragma(`user_version = ${SESSION_META_DB_VERSION}`);
}

/**
 * v6：sessions 增 `workspace_key` 派生列（工作目录比较键）+ 索引。
 *
 * 只在列缺失时回填一次（历史数据里同一目录存在 `/` 与 `\` 两种写法，
 * 必须逐行归一）；索引每次 `IF NOT EXISTS` 补齐。按列存在性判断而非版本号
 * 门控，原因见上方 v2/v3 教训。
 */
function migrateToWorkspaceKeyColumn(db: Database.Database): void {
  const tx = db.transaction(() => {
    const cols = new Set(
      (db.pragma("table_info(sessions)") as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has("workspace_key")) {
      db.exec(`ALTER TABLE sessions ADD COLUMN workspace_key TEXT`);
      const rows = db
        .prepare(
          `SELECT id, workspace_path FROM sessions WHERE workspace_path IS NOT NULL`,
        )
        .all() as { id: string; workspace_path: string }[];
      const update = db.prepare(
        `UPDATE sessions SET workspace_key = ? WHERE id = ?`,
      );
      for (const row of rows) {
        update.run(normalizeWorkspaceKey(row.workspace_path), row.id);
      }
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_workspace_key ON sessions(workspace_key)`,
    );
  });
  tx();
}

/**
 * v7：两张分组表各增可空 `icon` 列（Fluent 图标 key；NULL = 默认文件夹）。
 *
 * 新库的 DDL 已带该列，这里主要服务旧库升级。仍按 table_info 列存在性
 * 判断而非版本号门控，保证热重载误标版本号后可以自愈（见 v2/v3 教训）。
 */
function migrateToGroupIconColumn(db: Database.Database): void {
  const tx = db.transaction(() => {
    for (const table of ["session_groups", "project_groups"]) {
      const cols = new Set(
        (db.pragma(`table_info(${table})`) as { name: string }[])
          .map((c) => c.name),
      );
      if (!cols.has("icon")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN icon TEXT`);
      }
    }
  });
  tx();
}

/**
 * v4：sessions 增 `pinned` 列（置顶，参与「已置顶」分区查询）。
 * 同样按 table_info 列存在性判断，幂等自愈（勿用版本号门控，见上方教训）。
 */
function migrateToPinnedColumn(db: Database.Database): void {
  const tx = db.transaction(() => {
    const cols = new Set(
      (db.pragma("table_info(sessions)") as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has("pinned")) {
      db.exec(`ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned)`);
  });
  tx();
}

/**
 * v2/v3：两表增通用 `data` 扩展列（不索引），`settings` 折叠为 `data.settings`。
 * 全部步骤按 table_info 列存在性判断，幂等（settings 值是 JSON 文本，
 * json() 解析后嵌入对象；非法 JSON 跳过，属防御分支）。
 */
function migrateToDataColumn(db: Database.Database): void {
  const tx = db.transaction(() => {
    const sessionCols = new Set(
      (db.pragma("table_info(sessions)") as { name: string }[]).map((c) => c.name),
    );
    if (!sessionCols.has("data")) {
      db.exec(`ALTER TABLE sessions ADD COLUMN data TEXT`);
    }
    if (sessionCols.has("settings")) {
      db.exec(
        `UPDATE sessions SET data = json_object('settings', json(settings))
         WHERE settings IS NOT NULL AND json_valid(settings)`,
      );
      db.exec(`ALTER TABLE sessions DROP COLUMN settings`);
    }
    const groupCols = new Set(
      (db.pragma("table_info(session_groups)") as { name: string }[]).map((c) => c.name),
    );
    if (!groupCols.has("data")) {
      db.exec(`ALTER TABLE session_groups ADD COLUMN data TEXT`);
    }
  });
  tx();
}

/** 写入/覆盖一行会话元数据（转换、meta 修复与运行时写入共用同一口径） */
export function upsertMetaRow(db: Database.Database, meta: SessionMeta): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions (${META_COLUMNS}) VALUES ` +
      `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    meta.id,
    meta.parentId,
    meta.rootId,
    meta.sessionType,
    meta.title,
    meta.avatarUrl,
    meta.description,
    meta.modelId,
    meta.agentId,
    meta.groupId,
    buildDataJson(meta),
    meta.workspacePath,
    meta.workspaceKey ??
      (meta.workspacePath ? normalizeWorkspaceKey(meta.workspacePath) : null),
    meta.botId,
    meta.platform,
    meta.externalId,
    meta.archived ? 1 : 0,
    meta.pinned ? 1 : 0,
    meta.closedAt,
    meta.closeReason,
    meta.createdAt,
    meta.updatedAt,
    meta.lastActiveAt,
  );
}

/** 读一行（不存在返回 null）——meta 骨架判定与存在性检查用 */
export function readMetaRow(db: Database.Database, id: string): SessionMeta | null {
  const row = db.prepare(`SELECT ${META_COLUMNS} FROM sessions WHERE id = ?`).get(id);
  return row ? rowToMeta(row) : null;
}

/** 全量替换分组表（一次性转换用；运行时 CRUD 走 SessionMetaStore） */
export function replaceAllGroups(
  db: Database.Database,
  groups: SessionGroupMeta[],
): void {
  const tx = db.transaction((list: SessionGroupMeta[]) => {
    db.prepare(`DELETE FROM session_groups`).run();
    const insert = db.prepare(
      `INSERT INTO session_groups (id, name, sort_order, icon, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const g of list) {
      insert.run(
        g.id,
        g.name,
        g.sortOrder ?? 0,
        g.icon ?? null,
        g.createdAt,
        g.updatedAt,
        groupDataJson(g),
      );
    }
  });
  tx(groups);
}

/**
 * root_id 回填：沿父链解析顶层祖先（链上防御环，visited 封顶）。
 * 单层 sub_agent → web 是常态，但按链解析不设深度假设。
 */
export function backfillRootIds(db: Database.Database): void {
  const rows = db
    .prepare(`SELECT id, parent_id, root_id FROM sessions`)
    .all() as { id: string; parent_id: string | null; root_id: string | null }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const update = db.prepare(`UPDATE sessions SET root_id = ? WHERE id = ?`);
  for (const row of rows) {
    if (!row.parent_id) continue;
    let root = row.parent_id;
    const seen = new Set<string>([row.id]);
    let cursor = byId.get(row.parent_id);
    while (cursor?.parent_id && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      root = cursor.parent_id;
      cursor = byId.get(cursor.parent_id);
    }
    if (root !== row.root_id) update.run(root, row.id);
  }
}

/**
 * 批量写入（单一事务）：写行 → 回填 root_id → 覆盖分组。
 * 供测试与导入工具使用，避免调用方漏步。
 */
export function importSessionMetaRows(
  db: Database.Database,
  rows: SessionMeta[],
  groups: SessionGroupMeta[],
): void {
  const tx = db.transaction(() => {
    for (const meta of rows) upsertMetaRow(db, meta);
    backfillRootIds(db);
    replaceAllGroups(db, groups);
  });
  tx();
}

// ============ 存储实现 ============

@Injectable()
export class SessionMetaStore implements OnModuleDestroy {
  private readonly log = new Logger(SessionMetaStore.name);
  private readonly sessionsRoot = resolveSessionsBasePath();

  private db: Database.Database | null = null;
  private initReady: Promise<void> | null = null;

  private upsertStmt!: Database.Statement;
  private deleteRowStmt!: Database.Statement;
  private touchStmt!: Database.Statement;

  // ============ 生命周期 ============

  /** 幂等初始化：开库建表 → 孤儿/幽灵收敛 */
  async initialize(): Promise<void> {
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
    const db = openMetaDb(this.sessionsRoot);
    this.db = db;
    this.upsertStmt = db.prepare(
      `INSERT OR REPLACE INTO sessions (${META_COLUMNS}) VALUES ` +
        `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteRowStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
    this.touchStmt = db.prepare(
      `UPDATE sessions SET updated_at = ?, last_active_at = ? WHERE id = ?`,
    );
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
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = entry.name;
      if (this.getMeta(id)) continue;

      let content: string;
      try {
        content = await fsp.readFile(
          path.join(this.sessionsRoot, id, "seg-0000.jsonl"),
          "utf8",
        );
      } catch {
        continue; // 无事件日志 → 不是会话
      }
      const parsed = inspectOrphanLogContent(content);
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
        data: null,
        sessionType: "web",
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
        this.deleteRowStmt.run(id);
        removed += 1;
        this.log.warn(`Dropped session row "${id}" (directory removed out-of-band)`);
      }
    }
    return removed;
  }

  // ============ 查询 API（同步，走 SQLite） ============

  /** 原始 meta（含 ISO 字符串时间） */
  getMeta(id: string): SessionMeta | undefined {
    if (!this.db) return undefined;
    return readMetaRow(this.db, id) ?? undefined;
  }

  /** 行视图（Date 形状，兼容既有调用方） */
  get(id: string): Record<string, any> | undefined {
    const meta = this.getMeta(id);
    return meta ? toRow(meta) : undefined;
  }

  /**
   * 列出未绑定模型的主会话（启动回填用）。
   *
   * 只处理 `session_type='web'`：bot 会话的模型由 Bot/智能体运行期解析，
   * 回填会错误覆盖 Bot 配置；子代理会话也不在此处兜底。
   */
  listWebSessionsWithMissingModel(): Array<{ id: string; agentId: string | null }> {
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

  /**
   * 仅回填模型引用（启动迁移用）：不触碰 updated_at / last_active_at，
   * 避免历史会话因迁移被顶到最近排序。
   */
  async backfillModelId(id: string, modelId: string): Promise<void> {
    await this.initialize();
    if (!this.db) return;
    const result = this.db
      .prepare(`UPDATE sessions SET model_id = ? WHERE id = ?`)
      .run(modelId, id);
    if (result.changes === 0) {
      throw new Error(`session not found: ${id}`);
    }
  }

  /**
   * 结构化过滤查询（SQL 直译，返回按 `sort` 排序的全量结果——
   * 无界场景请改用 queryPaged；本方法留给 childrenOf / listWebSessionIds 等
   * 天然有界或需要完整清单的调用方）。
   */
  query(
    filter: SessionQueryFilter,
    sort: SessionSortKey = "lastActiveDesc",
  ): SessionMeta[] {
    if (!this.db) return [];
    const { where, params } = this.buildWhere(filter);
    const sql =
      `SELECT ${META_COLUMNS} FROM sessions` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY ${SORT_SQL[sort]}`;
    return (this.db.prepare(sql).all(...params) as any[]).map(rowToMeta);
  }

  /**
   * 数据库原生分页：LIMIT/OFFSET + 同事务 COUNT(*)。
   * better-sqlite3 同步 API 下两条语句之间不会插入写；事务包裹使
   * 「total 与分页同一快照」成为硬性保证。排序 tiebreak 为 id，翻页确定。
   */
  queryPaged(
    filter: SessionQueryFilter,
    sort: SessionSortKey,
    page: SessionQueryPage,
  ): PagedQueryResult {
    if (!this.db) return { rows: [], total: 0 };
    const { where, params } = this.buildWhere(filter);
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
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
        ` ORDER BY ${SORT_SQL[sort]}` +
        (paged ? " LIMIT ? OFFSET ?" : "");
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
      where.push("session_type = ?");
      params.push(filter.sessionType);
    }
    if (filter.excludeSessionTypes?.length) {
      where.push(
        `session_type NOT IN (${filter.excludeSessionTypes.map(() => "?").join(", ")})`,
      );
      params.push(...filter.excludeSessionTypes);
    }
    if (filter.archived !== undefined) {
      where.push("archived = ?");
      params.push(filter.archived ? 1 : 0);
    }
    if (filter.pinned !== undefined) {
      where.push("pinned = ?");
      params.push(filter.pinned ? 1 : 0);
    }
    if (filter.groupId !== undefined) {
      if (filter.groupId === null) {
        where.push("group_id IS NULL");
      } else {
        where.push("group_id = ?");
        params.push(filter.groupId);
      }
    }
    if (filter.workspaceKey !== undefined) {
      if (filter.workspaceKey === null) {
        // 「通用」桶：空路径 + 未注册目录（自动生成目录与 public 从不注册，天然落这里）
        where.push(
          "(workspace_key IS NULL OR workspace_key NOT IN (SELECT path_key FROM project_groups))",
        );
      } else {
        where.push("workspace_key = ?");
        params.push(filter.workspaceKey);
      }
    }
    if (filter.parentId !== undefined) {
      where.push("parent_id = ?");
      params.push(filter.parentId);
    }
    if (filter.botId !== undefined) {
      where.push("bot_id = ?");
      params.push(filter.botId);
    }
    const needle = filter.keyword?.toLowerCase();
    if (needle) {
      where.push(`lower(coalesce(title, '')) LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(needle)}%`);
    }
    return { where, params };
  }

  /** 由 id 取子会话（升序，用于 findById 的 children） */
  childrenOf(parentId: string): Record<string, any>[] {
    return this.query({ parentId }, "createdAsc").map(toRow);
  }

  /** 某父会话下活跃子会话数（排除已冻结 closedAt）——子代理名额上限依据 */
  countByParentId(parentId: string): number {
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
  findByBotAndExternalId(
    botId: string,
    externalId: string,
  ): Record<string, any> | null {
    if (!this.db) return null;
    const row = this.db
      .prepare(
        `SELECT ${META_COLUMNS} FROM sessions WHERE bot_id = ? AND external_id = ? AND session_type = 'bot' LIMIT 1`,
      )
      .get(botId, externalId);
    return row ? toRow(rowToMeta(row)) : null;
  }

  /** sessionType='web' 的 id 清单（lastActiveAt desc）——供内容搜索两阶段协议 */
  listWebSessionIds(includeArchived = false): string[] {
    return this.query(
      { sessionType: "web", archived: includeArchived ? undefined : false },
      "lastActiveDesc",
    ).map((m) => m.id);
  }

  /** 会话类型（web/bot/sub_agent/team） */
  getSessionType(id: string): string | null {
    return this.getMeta(id)?.sessionType ?? null;
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

  /** 级联删除某父会话下的全部子会话（行删除走 deleteSession，目录随行删） */
  async deleteChildrenOf(parentId: string): Promise<number> {
    const children = this.query({ parentId }, "createdAsc");
    let n = 0;
    for (const meta of children) {
      if (await this.deleteSession(meta.id)) n += 1;
    }
    return n;
  }

  // ============ 写入 API ============

  /** 是否存在 */
  has(id: string): boolean {
    return this.getMeta(id) !== undefined;
  }

  /**
   * 创建会话元信息（建目录 + 插行；lastActiveAt 默认置为当前时间）。
   * root_id 由 parentId 自动解析（父会话的 root_id，顶层父则取父 id）。
   */
  async create(data: Record<string, any>): Promise<Record<string, any>> {
    await this.initialize();
    // 缺 id 时本地铸造；显式传入的 id 保持原值（fork 克隆子会话走显式 id）
    let id: string;
    if (data.id === undefined || data.id === null || String(data.id) === "") {
      id = mintId(SESSION_ID_PREFIX);
      while (this.has(id)) id = mintId(SESSION_ID_PREFIX);
    } else {
      id = String(data.id);
      assertValidId(id);
    }
    const parentId = data.parentId ?? null;
    let rootId: string | null = null;
    if (parentId) {
      const parent = this.getMeta(String(parentId));
      rootId = parent?.rootId ?? String(parentId);
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
      data: isPlainObject(data.data) ? data.data : null,
      sessionType: data.sessionType ?? "web",
      archived: data.archived === true,
      pinned: data.pinned === true,
      botId: data.botId ?? null,
      platform: data.platform ?? null,
      externalId: data.externalId ?? null,
      workspacePath: data.workspacePath ?? null,
      workspaceKey: data.workspacePath
        ? normalizeWorkspaceKey(String(data.workspacePath))
        : null,
      parentId,
      rootId,
      closedAt: toISO(data.closedAt),
      closeReason: data.closeReason ?? null,
      createdAt: toISO(data.createdAt) ?? now,
      updatedAt: now,
      lastActiveAt: toISO(data.lastActiveAt) ?? now,
    };
    // 目录先建：bot 会话在首条消息前没有 JSONL，目录存在性是幽灵清理的判据
    await fsp.mkdir(this.sessionDir(id), { recursive: true });
    this.upsertMeta(meta);
    return toRow(meta);
  }

  /**
   * 更新会话元信息（部分字段；undefined 保持原值，`null` 显式置空）。
   * 未命中时返回 undefined（对齐旧 update 语义）。
   */
  async update(
    id: string,
    data: Record<string, any>,
  ): Promise<Record<string, any> | undefined> {
    await this.initialize();
    const current = this.getMeta(id);
    if (!current || !this.db) return undefined;

    const merged: SessionMeta = { ...current };
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
    // workspacePath 一旦变更，派生键必须同步重算（当前接口不允许改路径，属防御分支）
    merged.workspaceKey = merged.workspacePath
      ? normalizeWorkspaceKey(merged.workspacePath)
      : null;
    this.upsertMeta(merged);
    return toRow(merged);
  }

  /** 仅刷新最后活跃时间（每条消息一次；单字段 UPDATE） */
  async updateLastActiveAt(id: string): Promise<void> {
    await this.initialize();
    if (!this.db || !this.has(id)) return;
    const now = new Date().toISOString();
    this.touchStmt.run(now, now, id);
  }

  /** 删除会话元信息（先整目录 rm，再删行；崩溃残留由下次启动幽灵清理收敛） */
  async deleteSession(id: string): Promise<boolean> {
    await this.initialize();
    // 先校验：下面是无条件的整目录 rm，非法 id（`..`／分隔符）必须挡在这里
    assertValidId(id);
    const existed = this.has(id);
    await this.removeDirWithRetry(this.sessionDir(id));
    if (existed) this.deleteRowStmt.run(id);
    // 用量账本与 sessions 同库：会话删除即清理，避免统计残留已删除会话。
    // 表不存在时（旧库尚未迁移）忽略——下次 openMetaDb 会补建。
    try {
      this.db?.prepare(`DELETE FROM model_usage WHERE session_id = ?`).run(id);
    } catch {
      /* schema 迁移前删除会话：无用量表，忽略 */
    }
    return existed;
  }

  /** 级联删除多个会话 */
  async deleteMany(ids: string[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      if (await this.deleteSession(id)) n += 1;
    }
    return n;
  }

  /** 批量把某分组的会话置为未分组（单语句原子；顺带刷新 updatedAt） */
  async clearGroup(groupId: string): Promise<number> {
    await this.initialize();
    if (!this.db) return 0;
    const result = this.db
      .prepare(
        `UPDATE sessions SET group_id = NULL, updated_at = ? WHERE group_id = ?`,
      )
      .run(new Date().toISOString(), groupId);
    return result.changes;
  }

  // ============ 分组（session_groups 表） ============

  /** 分组列表（按 sortOrder 升序） */
  async listGroups(): Promise<SessionGroupMeta[]> {
    await this.initialize();
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT id, name, sort_order, icon, created_at, updated_at, data FROM session_groups ORDER BY sort_order ASC, id ASC`,
      )
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      icon: r.icon ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      data: parseJsonObject(r.data),
    }));
  }

  async findGroupById(id: string): Promise<SessionGroupMeta | undefined> {
    const groups = await this.listGroups();
    return groups.find((g) => g.id === id);
  }

  /** 新建分组（id 为 grp-<uuid>） */
  async createGroup(data: {
    name: string;
    sortOrder?: number;
    icon?: string | null;
  }): Promise<SessionGroupMeta> {
    await this.initialize();
    const now = new Date().toISOString();
    const group: SessionGroupMeta = {
      id: mintId(ID_PREFIXES.group),
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      icon: data.icon ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      ?.prepare(
        `INSERT INTO session_groups (id, name, sort_order, icon, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        group.id,
        group.name,
        group.sortOrder,
        group.icon,
        group.createdAt,
        group.updatedAt,
        null,
      );
    return group;
  }

  async updateGroup(
    id: string,
    data: {
      name?: string;
      sortOrder?: number;
      icon?: string | null;
      data?: Record<string, any> | null;
    },
  ): Promise<SessionGroupMeta | undefined> {
    await this.initialize();
    const target = await this.findGroupById(id);
    if (!target || !this.db) return undefined;
    const name = data.name !== undefined ? data.name : target.name;
    const sortOrder =
      data.sortOrder !== undefined ? data.sortOrder : target.sortOrder;
    const icon = data.icon !== undefined ? data.icon : target.icon;
    const groupData =
      data.data !== undefined
        ? isPlainObject(data.data)
          ? data.data
          : null
        : (target.data ?? null);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE session_groups SET name = ?, sort_order = ?, icon = ?, updated_at = ?, data = ? WHERE id = ?`,
      )
      .run(
        name,
        sortOrder,
        icon,
        updatedAt,
        groupData ? JSON.stringify(groupData) : null,
        id,
      );
    return { ...target, name, sortOrder, icon, updatedAt, data: groupData };
  }

  /** 删除分组：连同该组会话解绑（单事务，替代 FK onDelete SetNull） */
  async deleteGroup(id: string): Promise<{ id: string }> {
    await this.initialize();
    if (this.db) {
      const tx = this.db.transaction((groupId: string) => {
        this.db!.prepare(`DELETE FROM session_groups WHERE id = ?`).run(groupId);
        this.db!
          .prepare(
            `UPDATE sessions SET group_id = NULL, updated_at = ? WHERE group_id = ?`,
          )
          .run(new Date().toISOString(), groupId);
      });
      tx(id);
    }
    return { id };
  }

  /** 当前最大 sortOrder（新建分组排在最后） */
  async getMaxGroupSortOrder(): Promise<number> {
    await this.initialize();
    if (!this.db) return 0;
    const row = this.db
      .prepare(`SELECT MAX(sort_order) AS max FROM session_groups`)
      .get() as { max: number | null };
    return row.max ?? 0;
  }

  /** 批量更新分组排序（单事务） */
  async batchUpdateGroupSortOrder(
    updates: { id: string; sortOrder: number }[],
  ): Promise<SessionGroupMeta[]> {
    await this.initialize();
    if (!this.db) return [];
    const map = new Map(updates.map((u) => [u.id, u.sortOrder]));
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const update = this.db!.prepare(
        `UPDATE session_groups SET sort_order = ?, updated_at = ? WHERE id = ?`,
      );
      for (const [id, sortOrder] of map) {
        update.run(sortOrder, now, id);
      }
    });
    tx();
    const all = await this.listGroups();
    return all.filter((g) => map.has(g.id));
  }

  // ============ 目录分组（project_groups 表） ============
  //
  // 成员关系是派生的：`sessions.workspace_key = project_groups.path_key`。
  // 因此这里没有成员表，删分组也不需要回写会话——会话自动回落到「通用」桶。

  /** 目录分组列表（按 position 升序；tiebreak 用 id 保证翻页/渲染稳定） */
  async listProjectGroups(): Promise<ProjectGroupMeta[]> {
    await this.initialize();
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT id, path, path_key, name, name_overridden, icon, position, created_at, updated_at
         FROM project_groups ORDER BY position ASC, id ASC`,
      )
      .all() as any[];
    return rows.map(projectGroupFromRow);
  }

  async findProjectGroup(id: string): Promise<ProjectGroupMeta | undefined> {
    await this.initialize();
    if (!this.db) return undefined;
    const row = this.db
      .prepare(
        `SELECT id, path, path_key, name, name_overridden, icon, position, created_at, updated_at
         FROM project_groups WHERE id = ?`,
      )
      .get(id) as any;
    return row ? projectGroupFromRow(row) : undefined;
  }

  async findProjectGroupByKey(
    pathKey: string,
  ): Promise<ProjectGroupMeta | undefined> {
    await this.initialize();
    if (!this.db) return undefined;
    const row = this.db
      .prepare(
        `SELECT id, path, path_key, name, name_overridden, icon, position, created_at, updated_at
         FROM project_groups WHERE path_key = ?`,
      )
      .get(pathKey) as any;
    return row ? projectGroupFromRow(row) : undefined;
  }

  /**
   * 注册目录（幂等）：同 `path_key` 已存在时原样返回，**不覆盖**用户改过的名字。
   *
   * position 缺省：`prepend !== false` 时插到最前（新建会话/手动注册），
   * 否则排到末尾（bootstrap 会显式传 position）。
   */
  async ensureProjectGroup(data: {
    path: string;
    pathKey?: string;
    name?: string;
    position?: number;
    prepend?: boolean;
  }): Promise<ProjectGroupMeta> {
    await this.initialize();
    if (!this.db) {
      throw new Error("SessionMetaStore 未初始化，无法注册目录分组");
    }
    const pathKey = data.pathKey ?? normalizeWorkspaceKey(data.path);
    const existing = await this.findProjectGroupByKey(pathKey);
    if (existing) return existing;

    let position = data.position;
    if (position === undefined) {
      if (data.prepend === false) {
        const row = this.db
          .prepare(`SELECT MAX(position) AS max FROM project_groups`)
          .get() as { max: number | null };
        position = (row.max ?? 0) + 1;
      } else {
        const row = this.db
          .prepare(`SELECT MIN(position) AS min FROM project_groups`)
          .get() as { min: number | null };
        position = (row.min ?? 1) - 1;
      }
    }

    const now = new Date().toISOString();
    const group: ProjectGroupMeta = {
      id: mintId(ID_PREFIXES.projectGroup),
      path: data.path,
      pathKey,
      name: data.name?.trim() || workspaceBasename(data.path) || data.path,
      nameOverridden: false,
      icon: null,
      position,
      createdAt: now,
      updatedAt: now,
    };
    // OR IGNORE 兜住并发注册；零行变更说明已被抢先写入，读回既有行
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO project_groups
         (id, path, path_key, name, name_overridden, icon, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      )
      .run(
        group.id,
        group.path,
        group.pathKey,
        group.name,
        group.position,
        group.createdAt,
        group.updatedAt,
      );
    if (result.changes === 0) {
      const raced = await this.findProjectGroupByKey(pathKey);
      if (raced) return raced;
    }
    return group;
  }

  /**
   * 更新显示名和/或图标。
   *
   * - 传 `name` 时写 `name_overridden = 1`（bootstrap 永不覆盖已改名分组）；
   * - 只传 `icon` 时不动 `name_overridden`，避免「换图标」被误判为用户改名；
   * - 两个字段都未传时返回 undefined。
   */
  async updateProjectGroup(
    id: string,
    data: { name?: string; icon?: string | null },
  ): Promise<ProjectGroupMeta | undefined> {
    await this.initialize();
    if (!this.db) return undefined;
    const target = await this.findProjectGroup(id);
    if (!target) return undefined;
    if (data.name === undefined && data.icon === undefined) return undefined;

    const trimmedName =
      data.name !== undefined ? data.name.trim() : target.name;
    if (!trimmedName) return undefined;
    const nameOverridden =
      data.name !== undefined ? true : target.nameOverridden;
    const icon = data.icon !== undefined ? data.icon : target.icon;

    this.db
      .prepare(
        `UPDATE project_groups SET name = ?, name_overridden = ?, icon = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        trimmedName,
        nameOverridden ? 1 : 0,
        icon,
        new Date().toISOString(),
        id,
      );
    return this.findProjectGroup(id);
  }

  /** 拖拽排序：要求传入完整 id 集合（缺项/未知项直接拒绝，避免部分写入） */
  async reorderProjectGroups(ids: string[]): Promise<ProjectGroupMeta[]> {
    await this.initialize();
    if (!this.db) return [];
    const all = await this.listProjectGroups();
    const known = new Set(all.map((g) => g.id));
    if (
      ids.length !== known.size ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !known.has(id))
    ) {
      throw new Error("目录分组排序：id 集合不完整或包含未知 id");
    }
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const update = this.db!.prepare(
        `UPDATE project_groups SET position = ?, updated_at = ? WHERE id = ?`,
      );
      ids.forEach((id, index) => update.run(index, now, id));
    });
    tx();
    return this.listProjectGroups();
  }

  /**
   * 取消注册：只删分组行，**不修改任何会话**。
   * 成员关系派生自 path_key，删行后该目录的会话自动回落到「通用」桶。
   */
  async deleteProjectGroup(id: string): Promise<{ id: string }> {
    await this.initialize();
    this.db?.prepare(`DELETE FROM project_groups WHERE id = ?`).run(id);
    return { id };
  }

  // ============ 内部 ============

  private upsertMeta(meta: SessionMeta): void {
    this.upsertStmt.run(
      meta.id,
      meta.parentId,
      meta.rootId,
      meta.sessionType,
      meta.title,
      meta.avatarUrl,
      meta.description,
      meta.modelId,
      meta.agentId,
      meta.groupId,
      buildDataJson(meta),
      meta.workspacePath,
      meta.workspaceKey ??
        (meta.workspacePath ? normalizeWorkspaceKey(meta.workspacePath) : null),
      meta.botId,
      meta.platform,
      meta.externalId,
      meta.archived ? 1 : 0,
      meta.pinned ? 1 : 0,
      meta.closedAt,
      meta.closeReason,
      meta.createdAt,
      meta.updatedAt,
      meta.lastActiveAt,
    );
  }

  /** 删除目录（Windows 上句柄可能短暂占用，重试） */
  private async removeDirWithRetry(dir: string): Promise<void> {
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
