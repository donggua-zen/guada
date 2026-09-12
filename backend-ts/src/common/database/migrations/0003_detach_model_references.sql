-- 0003: 解除 session / character / knowledge_base 对 model 表的外键引用
--
-- 背景：模型与供应商配置的权威来源已是 providers/*.yaml，模型 id 形如
-- `{实例id}:{模型名}`，这些 id 在 model 表里不存在。三张表却仍带物理外键
-- （20260509_remove_model_fk_constraints 是仅注释的空操作，FK 一直在），
-- 因此写入文件 id 会直接报 FOREIGN KEY constraint failed。
--
-- SQLite 不支持就地删除外键，按官方推荐流程重建三张表：
--   建新表 → 拷数据 → 删旧表 → 改名 → 重建索引
--
-- 注意点（顺序不能动）：
-- 1. session 被 message / memory / session_context_state 以及自身 parent_id 引用，
--    必须先关外键；PRAGMA 在事务内无效，所以写在 BEGIN 之前。
-- 2. legacy_alter_table=ON 关掉「改名时同步重写其它表引用」的新行为，
--    否则 DROP 之后 schema 重解析会报 "error in table message ... no such table: main.session"。
--    子表引用保持指向 "session"，改名完成后自然重新生效。
-- 3. 索引随旧表 DROP 一起消失，需显式重建（主键/唯一索引由 DDL 自动生成）。
-- 4. knowledge_base.embedding_model_id 维持 NOT NULL：知识库无向量模型无意义，
--    只解除外键，不改可空性。

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

BEGIN;

-- ── session ──────────────────────────────────────────────────────────────
CREATE TABLE "session_new" (
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
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "bot_id" TEXT,
    "platform" TEXT,
    "external_id" TEXT,
    "workspace_path" TEXT,
    "parent_id" TEXT,
    "closed_at" DATETIME,
    "close_reason" TEXT,
    CONSTRAINT "session_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "session_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "session_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "session_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "session_new" (
    "id", "title", "user_id", "avatar_url", "description", "model_id", "character_id",
    "group_id", "settings", "created_at", "updated_at", "last_active_at", "session_type",
    "archived", "bot_id", "platform", "external_id", "workspace_path", "parent_id",
    "closed_at", "close_reason"
)
SELECT
    "id", "title", "user_id", "avatar_url", "description", "model_id", "character_id",
    "group_id", "settings", "created_at", "updated_at", "last_active_at", "session_type",
    "archived", "bot_id", "platform", "external_id", "workspace_path", "parent_id",
    "closed_at", "close_reason"
FROM "session";

DROP TABLE "session";
ALTER TABLE "session_new" RENAME TO "session";

CREATE INDEX "session_user_id_idx" ON "session"("user_id");
CREATE INDEX "session_session_type_idx" ON "session"("session_type");
CREATE INDEX "session_bot_id_idx" ON "session"("bot_id");
CREATE INDEX "session_platform_idx" ON "session"("platform");
CREATE INDEX "session_external_id_idx" ON "session"("external_id");
CREATE INDEX "session_bot_id_external_id_idx" ON "session"("bot_id", "external_id");
CREATE INDEX "session_group_id_idx" ON "session"("group_id");
CREATE INDEX "session_parent_id_idx" ON "session"("parent_id");

-- ── character ────────────────────────────────────────────────────────────
CREATE TABLE "character_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "model_id" TEXT,
    "group_id" TEXT,
    "settings" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "character_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "character_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "character_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "character_new" (
    "id", "user_id", "title", "description", "avatar_url", "is_public",
    "model_id", "group_id", "settings", "created_at", "updated_at"
)
SELECT
    "id", "user_id", "title", "description", "avatar_url", "is_public",
    "model_id", "group_id", "settings", "created_at", "updated_at"
FROM "character";

DROP TABLE "character";
ALTER TABLE "character_new" RENAME TO "character";

-- ── knowledge_base ───────────────────────────────────────────────────────
CREATE TABLE "knowledge_base_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "embedding_model_id" TEXT NOT NULL,
    "chunk_max_size" INTEGER NOT NULL DEFAULT 1000,
    "chunk_overlap_size" INTEGER NOT NULL DEFAULT 100,
    "chunk_min_size" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "metadata_config" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "knowledge_base_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "knowledge_base_new" (
    "id", "name", "description", "user_id", "embedding_model_id", "chunk_max_size",
    "chunk_overlap_size", "chunk_min_size", "is_active", "is_public", "metadata_config",
    "created_at", "updated_at"
)
SELECT
    "id", "name", "description", "user_id", "embedding_model_id", "chunk_max_size",
    "chunk_overlap_size", "chunk_min_size", "is_active", "is_public", "metadata_config",
    "created_at", "updated_at"
FROM "knowledge_base";

DROP TABLE "knowledge_base";
ALTER TABLE "knowledge_base_new" RENAME TO "knowledge_base";

COMMIT;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
