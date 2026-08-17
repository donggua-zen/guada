/**
 * 搜索索引同步 Worker（独立进程）
 *
 * 由主进程 SearchSyncService 以子进程方式启动，负责搜索索引的构建与增量维护，
 * 避免占用主进程 CPU / 阻塞启动流程。
 *
 * 用法：node sync-worker.ts --mode=fullbackfill|incremental
 * （dev 下经 ts-node 运行，生产构建后为 dist/common/search/sync-worker.js）
 *
 * 设计要点：
 * - 低优先级：小批次（200）+ 批间 sleep，让出 CPU，避免长时间占满
 * - 跨进程锁：与主进程共享 sync_meta 中的 sync_running 锁，多实例并发时只允许一个写入
 * - 断点续传：全量回填每批记录 full_backfill_offset，中断后可从断点继续
 * - 过滤规则与主进程一致：m.role/mc.role IN user|assistant + 非空 + 非归档（排除 tool 输出）
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Jieba } = require("@node-rs/jieba");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const requireMain = require.main === module;
import * as path from "path";
import * as fs from "fs";

// ── 参数与常量 ──
const modeArg =
  (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=incremental").split("=")[1];
const MODE: "fullbackfill" | "incremental" =
  modeArg === "fullbackfill" ? "fullbackfill" : "incremental";

const BATCH_SIZE = 200; // 小批次，降低单次锁占用与 CPU 峰值
const BATCH_SLEEP_MS = 80; // 批间休眠，让出事件循环/CPU
const SYNC_LOCK_TTL_MS = 10 * 60 * 1000; // 同步锁 TTL（与主进程一致）
const META_LAST_SYNC = "last_synced_at";
const META_OFFSET = "full_backfill_offset";
const META_LOCK = "sync_running";

// ── 路径解析（与 SearchIndexService / PrismaService 保持一致）──
function resolvePaths(): { mainDbPath: string; searchDbPath: string } {
  const cwd = process.cwd();
  const dataDir =
    process.env.USERDATA_DIR || process.env.DATA_DIR || path.join(cwd, "data");

  let searchDbPath: string;
  const configured = process.env.SEARCH_INDEX_PATH;
  if (configured) {
    searchDbPath = path.isAbsolute(configured)
      ? configured
      : path.join(cwd, configured);
  } else {
    searchDbPath = path.join(dataDir, "search_index.db");
  }

  let mainDbPath: string;
  const dbUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
  mainDbPath = dbUrl.replace(/^file:/, "");
  if (!path.isAbsolute(mainDbPath)) {
    mainDbPath = path.join(cwd, mainDbPath);
  }

  return { mainDbPath, searchDbPath };
}

// ── 打开连接 ──
function openConnections(paths: {
  mainDbPath: string;
  searchDbPath: string;
}): { mainDb: any; searchDb: any } {
  const dir = path.dirname(paths.searchDbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const mainDb = new Database(paths.mainDbPath, {
    readonly: true,
    timeout: 30000,
  });
  const searchDb = new Database(paths.searchDbPath, { timeout: 30000 });
  searchDb.pragma("journal_mode = WAL");
  searchDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
      message_id UNINDEXED, session_id UNINDEXED, role UNINDEXED,
      content, content_raw, created_at UNINDEXED, tokenize='unicode61'
    );
  `);
  searchDb.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return { mainDb, searchDb };
}

// ── jieba 分词（与主进程 tokenizeForIndex 一致）──
let jieba: any = null;
try {
  jieba = new Jieba();
} catch (e: any) {
  console.log(`[worker] 中文分词器初始化失败: ${e.message}`);
}
function tokenizeForIndex(text: string): string {
  const trimmed = String(text).trim();
  if (!trimmed) return "";
  if (jieba && /[\u4e00-\u9fa5]/.test(trimmed)) {
    return jieba
      .cut(trimmed, true)
      .filter((t: string) => t.trim() && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(t))
      .join(" ");
  }
  return trimmed;
}

// ── 跨进程锁（与主进程 SearchIndexService.tryAcquireSyncLock 一致）──
function tryAcquireLock(searchDb: any): boolean {
  const now = Date.now();
  try {
    const getMeta = searchDb.prepare(
      `SELECT value FROM sync_meta WHERE key = ?`,
    );
    const setMeta = searchDb.prepare(
      `INSERT INTO sync_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const acquired = searchDb.transaction(() => {
      const existing = getMeta.get(META_LOCK) as { value: string } | undefined;
      if (existing) {
        const startedAt = Number(existing.value);
        if (Number.isFinite(startedAt) && now - startedAt < SYNC_LOCK_TTL_MS) {
          return false;
        }
      }
      setMeta.run(META_LOCK, String(now));
      return true;
    })();
    return acquired ?? false;
  } catch (e: any) {
    console.log(`[worker] 获取同步锁失败: ${e.message}`);
    return false;
  }
}
function releaseLock(searchDb: any): void {
  try {
    searchDb.prepare(`DELETE FROM sync_meta WHERE key = ?`).run(META_LOCK);
  } catch (e) {
    /* ignore */
  }
}

// ── 查询消息内容（与主进程 fetchMessageContents 完全一致）──
const FETCH_SQL = `
  SELECT mc.id, mc.message_id, m.session_id, m.role, mc.content, mc.created_at, mc.updated_at
  FROM message_content mc
  INNER JOIN message m ON mc.message_id = m.id
  INNER JOIN session s ON m.session_id = s.id
  WHERE mc.content IS NOT NULL
    AND trim(mc.content) != ''
    AND m.role IN ('user', 'assistant')
    AND mc.role IN ('user', 'assistant')
    AND s.archived = 0
  ORDER BY mc.created_at ASC
  LIMIT ? OFFSET ?`;
const FETCH_SQL_SINCE = `
  SELECT mc.id, mc.message_id, m.session_id, m.role, mc.content, mc.created_at, mc.updated_at
  FROM message_content mc
  INNER JOIN message m ON mc.message_id = m.id
  INNER JOIN session s ON m.session_id = s.id
  WHERE mc.updated_at > ?
    AND mc.content IS NOT NULL
    AND trim(mc.content) != ''
    AND m.role IN ('user', 'assistant')
    AND mc.role IN ('user', 'assistant')
    AND s.archived = 0
  ORDER BY mc.updated_at ASC
  LIMIT ? OFFSET ?`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 写入索引（DELETE + INSERT，jieba 分词）──
function upsertBatch(
  searchDb: any,
  entries: Array<{
    messageId: string;
    sessionId: string;
    role: string;
    content: string;
    createdAt: string;
  }>,
): void {
  const del = searchDb.prepare(`DELETE FROM message_fts WHERE message_id = ?`);
  const ins = searchDb.prepare(
    `INSERT INTO message_fts (message_id, session_id, role, content, content_raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = searchDb.transaction((items: typeof entries) => {
    for (const it of items) {
      del.run(it.messageId);
      ins.run(
        it.messageId,
        it.sessionId,
        it.role,
        tokenizeForIndex(it.content),
        String(it.content),
        it.createdAt,
      );
    }
  });
  tx(entries);
}

// ── 全量回填（断点续传 + 分批 sleep）──
async function fullBackfill(
  mainDb: any,
  searchDb: any,
  getMeta: (k: string) => string | null,
  setMeta: (k: string, v: string) => void,
): Promise<void> {
  let offset = Number(getMeta(META_OFFSET) || 0);
  let totalIndexed = 0;
  const startedAt = Date.now();
  console.log(`[worker] 开始全量回填搜索索引（断点 offset=${offset}）...`);

  while (true) {
    const rows = mainDb.prepare(FETCH_SQL).all(BATCH_SIZE, offset);
    if (rows.length === 0) break;

    const entries = rows
      .filter((r: any) => r.content && String(r.content).trim())
      .map((r: any) => ({
        messageId: String(r.id),
        sessionId: String(r.session_id),
        role: String(r.role),
        content: String(r.content),
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      }));

    if (entries.length > 0) {
      upsertBatch(searchDb, entries);
      totalIndexed += entries.length;
    }

    offset += rows.length;
    setMeta(META_OFFSET, String(offset)); // 断点续传进度
    await sleep(BATCH_SLEEP_MS); // 低优先级：批间让出 CPU
  }

  setMeta(META_LAST_SYNC, new Date().toISOString());
  setMeta(META_OFFSET, "0");
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[worker] 全量回填完成: ${totalIndexed} 条（offset=${offset}，耗时 ${elapsed}s）`,
  );
}

// ── 增量同步 + 清理 ──
async function incrementalSync(
  mainDb: any,
  searchDb: any,
  getMeta: (k: string) => string | null,
  setMeta: (k: string, v: string) => void,
): Promise<void> {
  const lastSyncedAt = getMeta(META_LAST_SYNC);
  if (!lastSyncedAt) {
    console.log("[worker] 无同步游标，本次执行全量回填");
    await fullBackfill(mainDb, searchDb, getMeta, setMeta);
    return;
  }

  let offset = 0;
  let totalSynced = 0;
  while (true) {
    const rows = mainDb
      .prepare(FETCH_SQL_SINCE)
      .all(lastSyncedAt, BATCH_SIZE, offset);
    if (rows.length === 0) break;

    const entries = rows
      .filter((r: any) => r.content && String(r.content).trim())
      .map((r: any) => ({
        messageId: String(r.id),
        sessionId: String(r.session_id),
        role: String(r.role),
        content: String(r.content),
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      }));

    if (entries.length > 0) {
      upsertBatch(searchDb, entries);
      totalSynced += entries.length;
    }

    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_SLEEP_MS);
  }

  setMeta(META_LAST_SYNC, new Date().toISOString());

  // 孤儿清理（主库已删除的消息）
  const indexedIds = searchDb
    .prepare(`SELECT message_id FROM message_fts`)
    .all()
    .map((r: any) => String(r.message_id));
  let orphanCount = 0;
  const idBatch = 1000;
  for (let i = 0; i < indexedIds.length; i += idBatch) {
    const batch = indexedIds.slice(i, i + idBatch);
    const ph = batch.map(() => "?").join(",");
    const existing = mainDb
      .prepare(`SELECT id FROM message_content WHERE id IN (${ph})`)
      .all(...batch);
    const existingIds = new Set(existing.map((e: any) => String(e.id)));
    for (const id of batch) {
      if (!existingIds.has(id)) {
        searchDb.prepare(`DELETE FROM message_fts WHERE message_id = ?`).run(id);
        orphanCount++;
      }
    }
  }
  if (orphanCount > 0) console.log(`[worker] 清理孤儿索引: ${orphanCount} 条`);

  // 归档会话清理
  let archivedCount = 0;
  for (let i = 0; i < indexedIds.length; i += idBatch) {
    const batch = indexedIds.slice(i, i + idBatch);
    const ph = batch.map(() => "?").join(",");
    const archived = mainDb
      .prepare(
        `SELECT mc.id FROM message_content mc
         INNER JOIN message m ON mc.message_id = m.id
         INNER JOIN session s ON m.session_id = s.id
         WHERE mc.id IN (${ph}) AND s.archived = 1`,
      )
      .all(...batch);
    const archivedIds = new Set(archived.map((r: any) => String(r.id)));
    for (const id of batch) {
      if (archivedIds.has(id)) {
        searchDb.prepare(`DELETE FROM message_fts WHERE message_id = ?`).run(id);
        archivedCount++;
      }
    }
  }
  if (archivedCount > 0)
    console.log(`[worker] 清理归档会话索引: ${archivedCount} 条`);

  console.log(`[worker] 增量同步完成: ${totalSynced} 条`);
}

// ── 主入口 ──
async function main(): Promise<void> {
  const paths = resolvePaths();
  console.log(
    `[worker] 模式=${MODE} 主库=${paths.mainDbPath} 索引库=${paths.searchDbPath}`,
  );

  const { mainDb, searchDb } = openConnections(paths);
  const getMeta = (k: string): string | null => {
    const row = searchDb
      .prepare(`SELECT value FROM sync_meta WHERE key = ?`)
      .get(k) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const setMeta = (k: string, v: string): void => {
    searchDb
      .prepare(
        `INSERT INTO sync_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(k, v);
  };

  if (!tryAcquireLock(searchDb)) {
    console.log("[worker] 其他进程正在同步，本次跳过");
    mainDb.close();
    searchDb.close();
    process.exit(0);
  }

  try {
    if (MODE === "fullbackfill") {
      await fullBackfill(mainDb, searchDb, getMeta, setMeta);
    } else {
      await incrementalSync(mainDb, searchDb, getMeta, setMeta);
    }
  } catch (e: any) {
    console.log(`[worker] 同步失败: ${e.message}`);
    if (e.stack) console.log(e.stack.split("\n").slice(0, 5).join("\n"));
    process.exitCode = 1;
  } finally {
    releaseLock(searchDb);
    mainDb.close();
    searchDb.close();
  }
}

// 仅作为主入口直接运行时执行（被 require 时不触发，避免误启动 worker）
if (requireMain) {
  main();
}