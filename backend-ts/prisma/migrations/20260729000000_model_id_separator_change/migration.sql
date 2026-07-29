-- 迁移：将模型 ID 中的 / 分隔符替换为 __
-- 影响表：model (PK), session, character, knowledge_base, bot_instance
-- 原格式: {provider}/{modelName}  (如 openai/gpt-4)
-- 新格式: {provider}__{modelName} (如 openai__gpt-4)
-- 仅更新包含 / 的记录，cuid() 生成的 ID 不受影响

PRAGMA foreign_keys = OFF;

-- 1. 更新外键引用（先更新引用方，再更新被引用方）
UPDATE "session"          SET "model_id"             = REPLACE("model_id", '/', '__')             WHERE "model_id" LIKE '%/%';
UPDATE "character"        SET "model_id"             = REPLACE("model_id", '/', '__')             WHERE "model_id" LIKE '%/%';
UPDATE "knowledge_base"   SET "embedding_model_id"  = REPLACE("embedding_model_id", '/', '__')   WHERE "embedding_model_id" LIKE '%/%';
UPDATE "bot_instance"     SET "default_model_id"     = REPLACE("default_model_id", '/', '__')     WHERE "default_model_id" LIKE '%/%';

-- 2. 更新主键
UPDATE "model"             SET "id"                   = REPLACE("id", '/', '__')                   WHERE "id" LIKE '%/%';

PRAGMA foreign_keys = ON;
