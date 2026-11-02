/**
 * SQLite 会话元数据库的 schema、迁移与行映射（`<sessions根>/_meta.db`）
 *
 * 这一层只关心「SQLite 物理形态」：建表、迁移、列 ↔ 领域行转换。
 * 传输无关的端口定义在 `common/store/ports/types.ts`，驱动实现在同目录的
 * `sqlite-session-meta.driver.ts`。把 schema 单独抽出来，是为了让迁移脚本与
 * 测试可以直接开库断言 schema，而不必实例化 Nest provider。
 */
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

import { normalizeWorkspaceKey } from '../../../utils/workspace-key.util';
import type {
  ProjectGroupRow,
  SessionGroupRow,
  SessionRow,
} from '../../ports/types';

export const META_DB_FILE = '_meta.db';
/** 当前 schema 版本；结构调整 +1 并在 migrate() 追加一步 */
export const SESSION_META_DB_VERSION = 7;
/**
 * 目录分组一次性注册标记（库内键）。删库即视为未注册，下次启动自动重扫历史
 * `workspace_key`；已改名的分组不会被覆盖（INSERT OR IGNORE）。
 */
export const PROJECT_GROUPS_BOOTSTRAPPED_KEY = 'project_groups_bootstrapped_at';
/** 侧栏目录模式下的虚拟「通用」桶 id（无实体行；跨前后端协议常量） */
export const GENERAL_PROJECT_GROUP_ID = '__general__';

const SORT_SQL: Record<string, string> = {
  // 确定性 id tiebreak：同查询同顺序
  lastActiveDesc: 'last_active_at DESC, id ASC',
  updatedDesc: 'updated_at DESC, id ASC',
  createdAsc: 'created_at ASC, id ASC',
};

export const META_COLUMNS =
  'id, parent_id, root_id, session_type, title, avatar_url, description, ' +
  'model_id, agent_id, group_id, data, workspace_path, workspace_key, bot_id, platform, ' +
  'external_id, archived, pinned, closed_at, close_reason, created_at, updated_at, last_active_at';

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
 * 与 sessions 同库便于删除会话时级联清理（JOIN 已由端口层禁止，见 usage.port.ts）。
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

// ============ 行 ↔ 领域对象 ============

/** 会话行 → SQLite 绑定值（顺序与 META_COLUMNS 一致） */
export function metaToBindings(meta: SessionRow): unknown[] {
  return [
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
  ];
}

export function toISO(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 普通对象判定（非 null/数组）——settings/data 字段归一用 */
export function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * data 列 JSON 合成：settings 是 data 下的受管键（以 meta.settings 为准），
 * data 其余键自由透传（未来扩展免 schema 变更）。
 */
export function buildDataJson(meta: SessionRow): string | null {
  const hasData = isPlainObject(meta.data);
  const hasSettings = meta.settings != null;
  if (!hasData && !hasSettings) return null;
  const obj: Record<string, any> = { ...(hasData ? meta.data : {}) };
  obj.settings = meta.settings ?? null;
  return JSON.stringify(obj);
}

/** 分组 data 列 JSON 合成（文件形态可省略 data → 归一 null，better-sqlite3 拒绝 undefined 绑定） */
export function groupDataJson(g: SessionGroupRow): string | null {
  return isPlainObject(g.data) ? JSON.stringify(g.data) : null;
}

export function parseJsonObject(text: unknown): Record<string, any> | null {
  if (typeof text !== 'string' || !text) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** SQLite 行 → 会话领域行（camelCase + ISO 字符串） */
export function rowToMeta(r: any): SessionRow {
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
      (typeof r.workspace_path === 'string' && r.workspace_path
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

export function escapeLike(needle: string): string {
  return needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function projectGroupFromRow(r: any): ProjectGroupRow {
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

export function sessionGroupFromRow(r: any): SessionGroupRow {
  return {
    id: r.id,
    name: r.name,
    sortOrder: r.sort_order,
    icon: r.icon ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    data: parseJsonObject(r.data),
  };
}

/**
 * 解析孤儿事件日志：取首个 `session/init` 的标题/时间，跳过纯空壳
 * （仅 session/init、无任何真实往来消息的目录是历史遗留产物）。
 *
 * 这是**个人版文件后端**的启动自愈辅助，不属于端口契约。
 */
export function inspectOrphanLogContent(content: string): {
  title: string;
  createdAt: string;
} | null {
  const lines = content.split('\n').filter((l) => l.trim());
  let title = '';
  let createdAt: string | null = null;
  let hasRealMessage = false;

  for (const line of lines) {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt?.type === 'session/init') {
      if (!title && typeof evt.data?.title === 'string') {
        title = evt.data.title;
      }
      if (!createdAt && typeof evt.time === 'number') {
        createdAt = new Date(evt.time).toISOString();
      }
    } else if (typeof evt?.type === 'string') {
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
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  migrateMetaDbSchema(db);
  return db;
}

export function migrateMetaDbSchema(db: Database.Database): void {
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0;
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
      (db.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has('workspace_key')) {
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
    for (const table of ['session_groups', 'project_groups']) {
      const cols = new Set(
        (db.pragma(`table_info(${table})`) as { name: string }[]).map(
          (c) => c.name,
        ),
      );
      if (!cols.has('icon')) {
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
      (db.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has('pinned')) {
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
      (db.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name),
    );
    if (!sessionCols.has('data')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN data TEXT`);
    }
    if (sessionCols.has('settings')) {
      db.exec(
        `UPDATE sessions SET data = json_object('settings', json(settings))
         WHERE settings IS NOT NULL AND json_valid(settings)`,
      );
      db.exec(`ALTER TABLE sessions DROP COLUMN settings`);
    }
    const groupCols = new Set(
      (db.pragma('table_info(session_groups)') as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!groupCols.has('data')) {
      db.exec(`ALTER TABLE session_groups ADD COLUMN data TEXT`);
    }
  });
  tx();
}

/** 写入/覆盖一行会话元数据（转换、meta 修复与运行时写入共用同一口径） */
export function upsertMetaRow(db: Database.Database, meta: SessionRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions (${META_COLUMNS}) VALUES ` +
      `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...(metaToBindings(meta) as any[]));
}

/** 读一行（不存在返回 null）——meta 骨架判定与存在性检查用 */
export function readMetaRow(db: Database.Database, id: string): SessionRow | null {
  const row = db.prepare(`SELECT ${META_COLUMNS} FROM sessions WHERE id = ?`).get(id);
  return row ? rowToMeta(row) : null;
}

/** 全量替换分组表（一次性转换用；运行时 CRUD 走端口） */
export function replaceAllGroups(
  db: Database.Database,
  groups: SessionGroupRow[],
): void {
  const tx = db.transaction((list: SessionGroupRow[]) => {
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
  rows: SessionRow[],
  groups: SessionGroupRow[],
): void {
  const tx = db.transaction(() => {
    for (const meta of rows) upsertMetaRow(db, meta);
    backfillRootIds(db);
    replaceAllGroups(db, groups);
  });
  tx();
}

/** 排序键 → SQL 片段（驱动内部用） */
export function sortSql(sort: string): string {
  return SORT_SQL[sort] ?? SORT_SQL.lastActiveDesc;
}
