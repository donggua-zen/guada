-- 0004: 解除 session 对 character 表的外键引用
--
-- 背景：角色/智能体定义的权威来源已改为 agents/<id>/AGENT.md，id 是目录名
-- （由 name 派生的 slug，可为中文），这些 id 在 character 表里不存在。session
-- 表却仍带物理外键 session_character_id_fkey，写入文件侧 id 会直接报
-- FOREIGN KEY constraint failed（与 0003 解除 model 外键同一动因）。
--
-- SQLite 不支持就地删除外键，沿用 0003 的表重建流程：
--   建新表 → 拷数据 → 删旧表 → 改名 → 重建索引
--
-- 注意点（顺序不能动）：
-- 1. session 被 message / memory / session_context_state 以及自身 parent_id 引用，
--    必须先关外键；PRAGMA 在事务内无效，所以写在 BEGIN 之前。
-- 2. legacy_alter_table=ON 关掉「改名时同步重写其它表引用」的新行为。
-- 3. 索引随旧表 DROP 一起消失，需显式重建。
-- 4. character / character_group 表保留（只读兜底与回滚用），仅 session 去外键。

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

BEGIN;

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

COMMIT;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
