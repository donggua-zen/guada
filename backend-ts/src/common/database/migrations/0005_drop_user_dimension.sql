-- 0005: 移除 userId 数据维度（单账户模型）
--
-- 背景：账户体系已收敛为「全局单一账户」，权威来源是 <SETTINGS_DIR>/account.json，
-- 数据不再按用户隔离。DB 中仍带 NOT NULL user_id 的活跃表会阻塞写入，必须去掉：
--   mcp_server.user_id   NOT NULL + FK → 不删则任何插入都要编造一个用户 id
--   file.upload_user_id  只写不读的历史字段
--
-- SQLite 不支持就地删除外键，沿用 0003/0004 的表重建流程：
--   建新表 → 拷数据 → 删旧表 → 改名 → 重建索引
--
-- 注意点（顺序不能动）：
-- 1. 被引用的表必须先关外键；PRAGMA 在事务内无效，所以写在 BEGIN 之前。
-- 2. legacy_alter_table=ON 关掉「改名时同步重写其它表引用」的新行为，
--    否则 DROP 之后 schema 重解析会报 "no such table: main.user"。
-- 3. 索引随旧表 DROP 一起消失，需显式重建（主键/唯一索引由 DDL 自动生成）。
-- 4. file 表带 content_id → message_content 的外键，重建时按原样保留该约束。
-- 5. user / user_setting 表**不动**：作为回滚快照保留（账户已迁至 account.json），
--    上线前统一删除。

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

BEGIN;

-- ── mcp_server：移除 user_id 与对 user 的外键 ──────────────────────────────
CREATE TABLE "mcp_server_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "type" TEXT,
    "description" TEXT,
    "headers" JSONB,
    "command" TEXT,
    "args" JSONB,
    "env" JSONB,
    "cwd" TEXT,
    "tools" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

INSERT INTO "mcp_server_new" (
    "id", "name", "url", "type", "description", "headers", "command", "args",
    "env", "cwd", "tools", "enabled", "created_at", "updated_at"
)
SELECT
    "id", "name", "url", "type", "description", "headers", "command", "args",
    "env", "cwd", "tools", "enabled", "created_at", "updated_at"
FROM "mcp_server";

DROP TABLE "mcp_server";
ALTER TABLE "mcp_server_new" RENAME TO "mcp_server";

-- ── file：移除 upload_user_id ─────────────────────────────────────────────
CREATE TABLE "file_new" (
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
    "session_id" TEXT,
    "content_id" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "file_metadata" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "file_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "message_content" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "file_new" (
    "id", "file_name", "display_name", "file_size", "file_type", "file_extension",
    "content", "url", "preview_url", "content_hash", "session_id", "content_id",
    "is_public", "file_metadata", "created_at", "updated_at"
)
SELECT
    "id", "file_name", "display_name", "file_size", "file_type", "file_extension",
    "content", "url", "preview_url", "content_hash", "session_id", "content_id",
    "is_public", "file_metadata", "created_at", "updated_at"
FROM "file";

DROP TABLE "file";
ALTER TABLE "file_new" RENAME TO "file";

CREATE INDEX "file_content_hash_idx" ON "file"("content_hash");
CREATE INDEX "file_session_id_idx" ON "file"("session_id");
CREATE INDEX "file_content_id_idx" ON "file"("content_id");

COMMIT;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
