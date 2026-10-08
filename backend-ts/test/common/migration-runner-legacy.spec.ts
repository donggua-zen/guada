import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { MigrationRunner } from "../../src/common/database/migration-runner.service";
import { addSessionClosedFieldsMigration } from "../../src/common/database/migrations/0002_add_session_closed_fields";
import { allMigrations } from "../../src/common/database/migrations";

/**
 * 旧版安装升级（场景 2）回归测试
 *
 * 回归背景：旧实现把 0002–0005 标记为「已应用」却不执行，而老库缺 closed_at 等列，
 * 冻结主库的 Prisma 全列 SELECT 直接报 `no such column`，连锁导致会话不导出、
 * 消息不迁移——用户看到"历史全没了"。
 *
 * 现在要求：schema 先对齐到 baseline（补表/补列），再真正执行全部迁移，且可重复执行。
 */
describe("MigrationRunner 旧版安装升级（场景 2）", () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  /** 造一个 0.5.2 及更早形态的库：列不全 + 仍带 character/model 外键 */
  function makeLegacyDb(): void {
    db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE "user" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "password_hash" TEXT,
        "role" TEXT NOT NULL DEFAULT 'primary',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );
      CREATE TABLE "session_group" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );
      CREATE TABLE "model" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );
      CREATE TABLE "character" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "avatar_url" TEXT,
        "model_id" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );
      CREATE TABLE "knowledge_base" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "embedding_model_id" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );

      -- 旧 session：没有 archived / closed_at / close_reason，且带 character 与 model 外键
      CREATE TABLE "session" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT,
        "user_id" TEXT NOT NULL,
        "avatar_url" TEXT,
        "description" TEXT,
        "model_id" TEXT,
        "character_id" TEXT,
        "group_id" TEXT,
        "settings" JSONB,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL,
        "last_active_at" DATETIME,
        "session_type" TEXT DEFAULT 'web',
        "bot_id" TEXT,
        "platform" TEXT,
        "external_id" TEXT,
        "workspace_path" TEXT,
        "parent_id" TEXT,
        CONSTRAINT "session_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "session_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "session_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "session_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "session_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE TABLE "message" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "session_id" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "parent_id" TEXT,
        "meta_data" JSONB,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );
      CREATE TABLE "message_content" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "message_id" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "content" TEXT,
        "reasoning_content" TEXT,
        "meta_data" JSONB,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );

      -- 旧 file：附件挂在消息上（message_id），没有 content_id
      CREATE TABLE "file" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "file_name" TEXT NOT NULL,
        "display_name" TEXT NOT NULL,
        "file_size" INTEGER NOT NULL,
        "file_type" TEXT NOT NULL,
        "file_extension" TEXT NOT NULL,
        "content" TEXT,
        "url" TEXT,
        "preview_url" TEXT,
        "content_hash" TEXT NOT NULL,
        "upload_user_id" TEXT,
        "session_id" TEXT,
        "message_id" TEXT,
        "is_public" BOOLEAN NOT NULL DEFAULT false,
        "file_metadata" JSONB,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL
      );

      -- 旧 mcp_server：user_id NOT NULL 且带外键（0005 要移除）
      CREATE TABLE "mcp_server" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "url" TEXT,
        "type" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL,
        CONSTRAINT "mcp_server_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );

      INSERT INTO "user" (id, username, password_hash, role, updated_at)
        VALUES ('u1', 'alice', 'hash-原值', 'primary', '2026-01-01T00:00:00.000Z');
      INSERT INTO "model" (id, name, updated_at) VALUES ('model-1', '老模型', '2026-01-01T00:00:00.000Z');
      INSERT INTO "character" (id, name, updated_at) VALUES ('char-1', '老角色', '2026-01-01T00:00:00.000Z');
      INSERT INTO "knowledge_base" (id, name, embedding_model_id, updated_at)
        VALUES ('kb-1', '老知识库', 'model-1', '2026-01-01T00:00:00.000Z');
      INSERT INTO "session" (id, title, user_id, model_id, character_id, updated_at, created_at)
        VALUES ('s1', '升级前就存在的会话', 'u1', 'model-1', 'char-1',
                '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      INSERT INTO "message" (id, session_id, role, updated_at) VALUES ('m1', 's1', 'user', '2026-01-02T00:00:01.000Z');
      INSERT INTO "message_content" (id, message_id, role, content, updated_at)
        VALUES ('mc1', 'm1', 'user', '你好', '2026-01-02T00:00:01.000Z');
      INSERT INTO "file" (id, file_name, display_name, file_size, file_type, file_extension,
                          content_hash, session_id, message_id, updated_at)
        VALUES ('f1', 'a.png', 'a.png', 10, 'image', 'png', 'h1', 's1', 'm1', '2026-01-02T00:00:02.000Z');
      INSERT INTO "mcp_server" (id, name, user_id, updated_at)
        VALUES ('mcp1', '老 MCP', 'u1', '2026-01-01T00:00:00.000Z');
    `);
  }

  function makeRunner(): MigrationRunner {
    const configService = {
      get: (key: string) => (key === "DATABASE_URL" ? `file:${dbPath}` : undefined),
    };
    return new MigrationRunner({} as any, configService as any);
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-legacy-"));
    dbPath = path.join(dir, "ai_chat.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    makeLegacyDb();
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("升级后：迁移全部执行并记账、结构对齐、老数据保留", async () => {
    expect(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_app_migrations'").get()),
    ).toBeUndefined();

    await makeRunner().run();

    // 1) 全部迁移被真正执行并记账（旧实现只写记录不执行）
    const applied = db
      .prepare("SELECT id FROM _app_migrations ORDER BY id")
      .all() as Array<{ id: number }>;
    expect(applied.map((r) => r.id)).toEqual(allMigrations.map((m) => m.id).sort((a, b) => a - b));

    // 2) 老库缺失的列被补齐（否则冻结主库全列 SELECT 直接报错）
    const sessionCols = new Set(
      (db.prepare('PRAGMA table_info("session")').all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    for (const col of ["archived", "closed_at", "close_reason"]) {
      expect(sessionCols.has(col)).toBe(true);
    }

    // 3) 老数据原样保留（会话、消息、内容、附件、账户密码）
    const sessionRow = db
      .prepare('SELECT title, user_id, character_id FROM "session" WHERE id = ?')
      .get("s1") as { title: string; user_id: string; character_id: string };
    expect(sessionRow.title).toBe("升级前就存在的会话");
    expect(sessionRow.user_id).toBe("u1");
    expect(sessionRow.character_id).toBe("char-1");
    expect(
      (db.prepare('SELECT COUNT(*) c FROM "message" WHERE id = ?').get("m1") as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare('SELECT password_hash FROM "user" WHERE id = ?').get("u1") as {
        password_hash: string;
      }).password_hash,
    ).toBe("hash-原值");
    // 单账户维度：mcp_server 的 user_id 列被 0005 移除
    const mcpCols = (db.prepare('PRAGMA table_info("mcp_server")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(mcpCols).not.toContain("user_id");

    // 4) session 对 character/model 的外键已解除（引用改写/文件侧 id 才不会撞 FOREIGN KEY）
    expect(() =>
      db
        .prepare(
          `INSERT INTO "session" (id, user_id, character_id, model_id, created_at, updated_at)
           VALUES ('s2', 'u1', 'agents-dir-id', 'provider:model', ?, ?)`,
        )
        .run("2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z"),
    ).not.toThrow();

    // 5) 老附件关联从 message_id 回填到 content_id，且 message_id 列已被 0005 丢弃
    const fileRow = db
      .prepare('SELECT content_id FROM "file" WHERE id = ?')
      .get("f1") as { content_id: string | null };
    expect(fileRow.content_id).toBe("mc1");
    const fileCols = (db.prepare('PRAGMA table_info("file")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(fileCols).toContain("content_id");
    expect(fileCols).not.toContain("message_id");
    expect(fileCols).not.toContain("upload_user_id");

    // 6) 非空且无默认值的补列（knowledge_base.user_id）降级为可空并回填库内账户，
    //    否则 0003 复制 NULL 会撞新表的 NOT NULL 约束
    const kbRow = db
      .prepare('SELECT user_id FROM "knowledge_base" WHERE id = ?')
      .get("kb-1") as { user_id: string | null };
    expect(kbRow.user_id).toBe("u1");
  });

  it("迁移前自动备份（本路径也会写数据了）", () => {
    const backups = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("ai_chat.db.bak."));
    expect(backups.length).toBeGreaterThan(0);
  });

  it("再次启动不重复执行（无 pending，不抛错）", async () => {
    await makeRunner().run();
    const applied = db
      .prepare("SELECT id FROM _app_migrations ORDER BY id")
      .all() as Array<{ id: number }>;
    expect(applied).toHaveLength(allMigrations.length);
  });

  it("0002 可重复执行（列已存在时跳过，不报 duplicate column）", async () => {
    await expect(addSessionClosedFieldsMigration.up(db, {} as any)).resolves.toBeUndefined();
    await expect(addSessionClosedFieldsMigration.up(db, {} as any)).resolves.toBeUndefined();
  });
});
