/**
 * 会话状态重同步事件（SSE 重连后，本地认为仍在流式但服务端已结束时派发）。
 * ChatPanel 监听后强制重载当前会话历史，避免"息屏期间回合跑完、界面卡在流式中"。
 */
export const SESSION_RESYNC_EVENT = "guada:session-resync";

export interface SessionResyncDetail {
  sessionId: string;
}

export function emitSessionResync(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SessionResyncDetail>(SESSION_RESYNC_EVENT, {
      detail: { sessionId },
    }),
  );
}
