/**
 * 会话历史重同步（事件 + 跨组件共享的"待重拉"标记）。
 *
 * 使用场景：SSE 重连 / 回前台 / 服务端权威判定回合已结束后，本地历史可能缺尾部
 * （终态帧只在完成那一刻对在线连接广播一次，stopStream 随即删除缓冲）。
 * 标记会话历史失效并派发事件，让已挂载的 ChatPanel 立即按服务端最新事件页强制重拉；
 * 未挂载时 loaded=false 也会让下次打开绕过缓存门禁。
 */
export const SESSION_RESYNC_EVENT = "guada:session-resync";

export interface SessionResyncDetail {
  sessionId: string;
}

/** 历史已失效、等待/正在重拉的会话（ChatPage/useSessionEvents 写入，ChatPanel 加载成功后清除） */
const staleSessionHistory = new Set<string>();

/** 最小 store 依赖（避免 utils 反向依赖 pinia store；真实 store 结构兼容） */
interface StaleHistoryStore {
  getSessionState(sessionId: string): { loaded?: boolean };
}

export function emitSessionResync(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SessionResyncDetail>(SESSION_RESYNC_EVENT, {
      detail: { sessionId },
    }),
  );
}

/**
 * 标记会话历史失效并派发强制重拉。
 *
 * 总是派发（不因已标记而跳过）：这是"现在重拉一次"的强制信号，重拉失败需要下次
 * 触发点（回前台/重连）继续重试；去重由调用方按场景决定。
 */
export function markSessionHistoryStale(
  store: StaleHistoryStore,
  sessionId: string,
): void {
  staleSessionHistory.add(sessionId);
  store.getSessionState(sessionId).loaded = false;
  emitSessionResync(sessionId);
}

export function isSessionHistoryStale(sessionId: string): boolean {
  return staleSessionHistory.has(sessionId);
}

export function clearSessionHistoryStale(sessionId: string): void {
  staleSessionHistory.delete(sessionId);
}
