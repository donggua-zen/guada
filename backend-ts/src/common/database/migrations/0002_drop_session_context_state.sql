-- 0002: 移除压缩历史 DB 线（session_context_state 表）
-- 压缩历史改为从 JSONL 事件日志（compaction/start|summary|end）聚合，
-- 旧表中的历史记录随之弃用（见 2026-09 重构决策）。
DROP INDEX IF EXISTS "session_context_state_session_id_created_at_idx";
DROP TABLE IF EXISTS "session_context_state";
