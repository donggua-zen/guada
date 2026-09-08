-- 0002: 子代理冻结标记（sub_agent_closed 语义修复）
-- closed_at 非空 = 子代理已结束（仅供回放，不再硬删子会话）；
-- close_reason 记录结束原因（completed / error / closed）。
-- 历史已删除的子会话不受影响，无需数据回填。

ALTER TABLE "session" ADD COLUMN "closed_at" DATETIME;
ALTER TABLE "session" ADD COLUMN "close_reason" TEXT;
