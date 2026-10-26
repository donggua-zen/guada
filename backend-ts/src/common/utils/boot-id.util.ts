/**
 * 进程启动标识（boot id）——单一真相
 *
 * 语义：同一次后端进程内恒定，重启即变（形如 `m3k9fa-8f3kd2`）。
 *
 * 凡是"序号只在进程内单调、重启后归零"的游标/版本号，都必须带它下发给前端，
 * 前端据此识别"序号已重置"，否则会把新进程的低序号当成过期数据丢弃：
 * - 会话流事件去重：streamSeq + streamBootId（见 chat/session-stream.manager.ts）
 * - 后台作业快照：revision + bootId（见 jobs/job-registry.service.ts）
 *
 * 不要各模块各写一份 `Date.now()+random`：两份启动标识虽同进程同值语义，
 * 但一旦有人改动其中一处（例如加前缀），两套协议就会对不上。
 */
export const APP_BOOT_ID = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;
