import Database from "better-sqlite3";
import * as fs from "fs";
import { resolve } from "path";

/**
 * 旧库 schema 对齐（仅用于「有业务表但无迁移记录」的旧版安装）
 *
 * 背景：迁移运行器的场景 2 过去把全部迁移标记为已执行而不执行，前提是「旧版 schema
 * 已包含这些结构变更」。该前提对老库不成立——例如 0002 新增的 session.closed_at 在
 * 0.5.2 及更早的库里并不存在，而冻结主库的 Prisma schema 会全列 SELECT，读表即
 * `no such column: closed_at`，连锁导致会话元数据不导出、消息不迁移（用户看到"历史没了"）。
 *
 * 做法：以 `0001_baseline.sql`（始终代表最新完整快照）为唯一真源，在内存库执行后读
 * PRAGMA 得到目标结构，对旧库做**纯增量**对齐：
 *   - 缺表 → 用基线的 CREATE TABLE + 该表索引补齐（空表，无数据风险）
 *   - 缺列 → ALTER TABLE ADD COLUMN（类型/默认值取自基线）
 * 只加不减：已有的列、已有的数据一律不动，因此可反复执行（幂等）。
 *
 * 对齐后 0002–0005 的硬编码列清单必然全部存在（各迁移的 INSERT 列 ⊆ 基线列），
 * 于是「执行迁移」这条路对老库也能走通。
 */

export interface ReconcileReport {
  addedTables: string[];
  addedColumns: string[];
  /** 基线要求非空但存量行无法满足（无默认值 / 非常量默认值）→ 降级为可空并回填占位值 */
  softenedColumns: string[];
}

/** 基线里的 sqlite_master 行 */
interface SqliteMasterRow {
  name: string;
  type: string;
  tbl_name: string;
  sql: string | null;
}

/** PRAGMA table_info 行 */
interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function baselineSqlPath(): string {
  return resolve(__dirname, "migrations/0001_baseline.sql");
}

/** 打开基线内存库（每次调用独立，避免长生命周期状态） */
function openBaseline(): Database.Database {
  const mem = new Database(":memory:");
  mem.exec(fs.readFileSync(baselineSqlPath(), "utf-8"));
  return mem;
}

function listTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

/** 默认值是非常量表达式（CURRENT_TIMESTAMP 等）——SQLite 禁止 ADD COLUMN 时使用 */
function isNonConstantDefault(dflt: string | null): boolean {
  if (dflt === null) return false;
  return /CURRENT_(TIME|DATE|TIMESTAMP)/i.test(dflt) || dflt.includes("(");
}

/** NOT NULL 且无默认值：存量行没有值可填，只能降级为可空 */
function cannotSatisfyNotNull(col: ColumnInfo): boolean {
  return col.notnull === 1 && (col.dflt_value === null || isNonConstantDefault(col.dflt_value));
}

function columnDefinition(col: ColumnInfo, soften: boolean): string {
  const type = col.type && col.type.length > 0 ? col.type : "TEXT";
  let sql = `"${col.name}" ${type}`;
  if (col.notnull === 1 && !soften) sql += " NOT NULL";
  if (col.dflt_value !== null && !isNonConstantDefault(col.dflt_value)) {
    sql += ` DEFAULT ${col.dflt_value}`;
  }
  return sql;
}

/** 降级列的回填值：用户维度列沿用库内既有账户（单账户模型），其余为 null 表示按类型取占位值 */
function userBackfillValue(columnName: string, hasUserTable: boolean): string | null {
  if (/(^|_)user_id$/.test(columnName) && hasUserTable) {
    return `(SELECT "id" FROM "user" LIMIT 1)`;
  }
  return null;
}

function typePlaceholder(col: ColumnInfo): string {
  const t = (col.type || "TEXT").toUpperCase();
  if (
    t.includes("INT") ||
    t.includes("REAL") ||
    t.includes("NUM") ||
    t.includes("FLOA") ||
    t.includes("DOUB") ||
    t.includes("DEC") ||
    t.includes("BOOL")
  ) {
    return "0";
  }
  return "''";
}

/**
 * 把旧库结构对齐到基线（只加表/加列）。
 *
 * @param db 旧库连接（调用方负责生命周期）
 * @param log 记录每一步增量；不传则静默
 */
export function reconcileLegacySchema(
  db: Database.Database,
  log?: (message: string) => void,
): ReconcileReport {
  const report: ReconcileReport = {
    addedTables: [],
    addedColumns: [],
    softenedColumns: [],
  };
  const say = (m: string) => log?.(m);

  const mem = openBaseline();
  const foreignKeysWasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  try {
    // 补表/建表时不需要外键校验（基线含指向尚未补齐表的引用）
    db.pragma("foreign_keys = OFF");

    const targetTables = listTables(mem);
    const existingTables = new Set(listTables(db));

    for (const table of targetTables) {
      const memMaster = mem
        .prepare("SELECT name, type, tbl_name, sql FROM sqlite_master WHERE name = ?")
        .get(table) as SqliteMasterRow | undefined;

      if (!existingTables.has(table)) {
        // 缺表：直接按基线建（空表，不存在数据覆盖问题）
        if (memMaster?.sql) {
          db.exec(memMaster.sql);
          for (const idx of mem
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL",
            )
            .all(table) as Array<{ sql: string }>) {
            db.exec(idx.sql);
          }
          report.addedTables.push(table);
          say(`旧库补表：${table}`);
        }
        continue;
      }

      const targetCols = mem.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[];
      const existingCols = new Set(
        (db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[]).map((c) => c.name),
      );
      const hasUserTable = existingTables.has("user") || targetTables.includes("user");

      for (const col of targetCols) {
        if (existingCols.has(col.name)) continue;

        const mustSoften = cannotSatisfyNotNull(col);
        try {
          // 先按基线定义添加；非空且存量行无法满足时降级为可空（并回填占位值）
          db.exec(
            `ALTER TABLE "${table}" ADD COLUMN ${columnDefinition(col, mustSoften)}`,
          );
          report.addedColumns.push(`${table}.${col.name}`);
          if (mustSoften) {
            const fill = userBackfillValue(col.name, hasUserTable) ?? typePlaceholder(col);
            db.exec(
              `UPDATE "${table}" SET "${col.name}" = ${fill} WHERE "${col.name}" IS NULL`,
            );
            report.softenedColumns.push(`${table}.${col.name}`);
            say(`旧库补列（降级可空并回填占位值）：${table}.${col.name}`);
          } else {
            say(`旧库补列：${table}.${col.name}`);
          }
        } catch (err) {
          // 单列失败不阻断其余列/后续迁移，交给迁移与启动日志暴露
          report.softenedColumns.push(`${table}.${col.name}`);
          say(`旧库补列失败（跳过）：${table}.${col.name} — ${String(err)}`);
        }
      }
    }

    backfillLegacyFileContentLink(db, say);
  } finally {
    if (foreignKeysWasOn) db.pragma("foreign_keys = ON");
    mem.close();
  }

  return report;
}

/**
 * 旧附件链路回填：`file.message_id` → `file.content_id`
 *
 * 0.4.8 及更早把附件挂在消息上（message_id），之后改为挂在消息内容上（content_id）。
 * 对齐 schema 只会新增空的 content_id，随后 0005 重建 file 表会丢弃 message_id——
 * 不回填的话这些附件在消息迁移（按 content 读取）里永久失联。
 *
 * 归属规则取自真机老数据形态（38/38 个附件都挂在"只有一个 user 内容"的消息上）：
 * 优先该消息的 user 内容，其次最早的内容；一条消息多内容时才可能落到非 user 内容。
 */
function backfillLegacyFileContentLink(
  db: Database.Database,
  say: (message: string) => void,
): void {
  const fileCols = new Set(
    (db.prepare(`PRAGMA table_info("file")`).all() as ColumnInfo[]).map((c) => c.name),
  );
  if (!fileCols.has("message_id") || !fileCols.has("content_id")) return;
  const contentCols = new Set(
    (db.prepare(`PRAGMA table_info("message_content")`).all() as ColumnInfo[]).map(
      (c) => c.name,
    ),
  );
  const hasRole = contentCols.has("role");
  if (!contentCols.has("message_id")) return;

  try {
    const result = db
      .prepare(
        `UPDATE "file" SET content_id = (
           SELECT mc.id FROM message_content mc
           WHERE mc.message_id = "file".message_id
           ORDER BY ${hasRole ? "CASE WHEN mc.role = 'user' THEN 0 ELSE 1 END," : ""} mc.created_at
           LIMIT 1
         )
         WHERE ("file".content_id IS NULL OR "file".content_id = '')
           AND "file".message_id IS NOT NULL AND "file".message_id <> ''`,
      )
      .run();
    if (result.changes > 0) {
      say(`旧附件回填：${result.changes} 个文件从 message_id 关联到 content_id`);
    }
  } catch (err) {
    say(`旧附件回填失败（跳过，不影响结构迁移）：${String(err)}`);
  }
}
