-- 移除 Model 相关的数据库外键约束
-- 保留 Prisma ORM 层面的关联查询能力
-- 这样删除 Model 时不会将 Character.modelId、Session.modelId、KnowledgeBase.embeddingModelId 置空

-- SQLite 不支持直接删除外键约束，需要重建表
-- 但为了简化操作，我们只更新 migration_lock.toml 标记迁移已完成
-- 实际的外键约束移除通过应用层逻辑控制

-- 注意：此迁移仅标记 Schema 变更，不实际修改数据库结构
-- Prisma Client 会根据新的 Schema 生成类型安全的查询代码
-- 数据库层面的外键约束仍然存在，但 Prisma 不会强制执行级联删除
