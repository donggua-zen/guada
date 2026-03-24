-- ============================================
-- Usage 记录功能验证 SQL 脚本
-- ============================================
-- 该脚本用于手动查询和验证 tokens 消耗数据是否正确保存
-- 
-- 使用方法：
-- 1. 连接到 SQLite 数据库（data/app.db）
-- 2. 运行以下查询
-- ============================================

-- 1. 查看最近 10 条 MessageContent 记录的 meta_data
SELECT 
    id,
    message_id,
    turns_id,
    substr(content, 1, 50) as content_preview,
    json_extract(meta_data, '$.model_name') as model_name,
    json_extract(meta_data, '$.usage.prompt_tokens') as prompt_tokens,
    json_extract(meta_data, '$.usage.completion_tokens') as completion_tokens,
    json_extract(meta_data, '$.usage.total_tokens') as total_tokens,
    json_extract(meta_data, '$.thinking_duration_ms') as thinking_duration_ms,
    json_extract(meta_data, '$.finish_reason') as finish_reason,
    created_at
FROM message_content
ORDER BY created_at DESC
LIMIT 10;

-- 2. 统计包含 usage 信息的记录数量
SELECT 
    COUNT(*) as total_records,
    COUNT(json_extract(meta_data, '$.usage')) as records_with_usage,
    ROUND(COUNT(json_extract(meta_data, '$.usage')) * 100.0 / COUNT(*), 2) as percentage_with_usage
FROM message_content
WHERE meta_data IS NOT NULL;

-- 3. 查看每条记录的完整 meta_data（JSON 格式）
SELECT 
    id,
    meta_data,
    created_at
FROM message_content
WHERE json_extract(meta_data, '$.usage') IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;

-- 4. 按模型分组统计 tokens 消耗
SELECT 
    json_extract(meta_data, '$.model_name') as model_name,
    COUNT(*) as message_count,
    SUM(json_extract(meta_data, '$.usage.prompt_tokens')) as total_prompt_tokens,
    SUM(json_extract(meta_data, '$.usage.completion_tokens')) as total_completion_tokens,
    SUM(json_extract(meta_data, '$.usage.total_tokens')) as grand_total_tokens,
    AVG(json_extract(meta_data, '$.usage.total_tokens')) as avg_tokens_per_message
FROM message_content
WHERE json_extract(meta_data, '$.usage') IS NOT NULL
GROUP BY json_extract(meta_data, '$.model_name')
ORDER BY grand_total_tokens DESC;

-- 5. 查找特定会话的所有消息及其 tokens 消耗
-- 将 'YOUR_SESSION_ID' 替换为实际的 session_id
-- SELECT 
--     m.id as message_id,
--     m.role,
--     mc.id as content_id,
--     substr(mc.content, 1, 50) as content_preview,
--     json_extract(mc.meta_data, '$.usage.total_tokens') as total_tokens,
--     mc.created_at
-- FROM message m
-- JOIN message_content mc ON m.id = mc.message_id
-- WHERE m.session_id = 'YOUR_SESSION_ID'
--   AND json_extract(mc.meta_data, '$.usage') IS NOT NULL
-- ORDER BY mc.created_at ASC;

-- 6. 查看最新的包含 usage 的记录详情
SELECT 
    '=== 最新 Usage 记录详情 ===' as info;

SELECT 
    id,
    json_extract(meta_data, '$.model_name') as model_name,
    json_extract(meta_data, '$.usage.prompt_tokens') as prompt_tokens,
    json_extract(meta_data, '$.usage.completion_tokens') as completion_tokens,
    json_extract(meta_data, '$.usage.total_tokens') as total_tokens,
    json_extract(meta_data, '$.thinking_duration_ms') as thinking_duration_ms,
    substr(content, 1, 100) as content_preview,
    created_at
FROM message_content
WHERE json_extract(meta_data, '$.usage') IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;
