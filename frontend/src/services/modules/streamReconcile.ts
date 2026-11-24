/**
 * 流停止后的统一状态校准（status 探测 / 会话详情快照共用）。
 *
 * 背景：终态帧（stream_status_changed: completed/error）只在完成那一刻对在线连接
 * 广播一次，stopStream 随即删除补发缓冲 → 后台/断线期间跑完的回合收不到任何终态信号。
 * 服务端权威判定"已停止"时，必须一次性把瞬态收敛干净，并让历史失效触发强制重拉
 * （带内快照含事件页与在飞尾部 = 整页刷新等价）。
 */
import { isSessionHistoryStale, markSessionHistoryStale } from "@/utils/sessionResync";
import { resetTurnTransientState } from "./streamProjector";
import type { StreamStatus } from "@/types/session";
import type { Turn } from "@/types/message";

export interface StreamReconcileStore {
  sessionIsStreaming(sessionId: string): boolean;
  streamEpoch(sessionId: string): number;
  syncStreamingState(sessionId: string, isStreaming: boolean): void;
  setStreamStatus(sessionId: string, status: StreamStatus): void;
  applyStreamSnapshot(sessionId: string, isStreaming: boolean, closeReason?: string | null): void;
  getSessionState(sessionId: string): { loaded?: boolean };
  getTurns(sessionId: string): Turn[] | undefined;
  clearSessionPendingAsks(sessionId: string): void;
}

function resolveStoppedStatus(closeReason?: string | null): "completed" | "error" {
  return closeReason && closeReason !== "completed" ? "error" : "completed";
}

/**
 * 服务端确认流已停止 → 收敛全部本地瞬态并失效历史（触发一次强制重拉）。
 *
 * 幂等：重复调用只会重复写同样的终态；历史重拉信号在"已待重拉"时不重复派发
 * （加载成功会清除标记，失败保留标记供下次触发点重试）。
 */
export function reconcileStoppedStream(
  store: StreamReconcileStore,
  sessionId: string,
  closeReason?: string | null,
): void {
  store.syncStreamingState(sessionId, false);
  store.setStreamStatus(sessionId, resolveStoppedStatus(closeReason));
  for (const turn of store.getTurns(sessionId) ?? []) {
    resetTurnTransientState(turn);
  }
  store.clearSessionPendingAsks(sessionId);
  if (!isSessionHistoryStale(sessionId)) {
    markSessionHistoryStale(store, sessionId);
  }
}

/**
 * 会话详情快照的流状态写入（含"后台期间回合结束"的判定）。
 *
 * @param epochAtRequest 请求发出时该会话的回合代数；undefined = 当时本地未在流式
 */
export function applySessionSnapshotStreamState(
  store: StreamReconcileStore,
  session: { id: string; isStreaming?: boolean; closeReason?: string | null },
  epochAtRequest?: number,
): void {
  const sessionId = session.id;

  if (session.isStreaming === true) {
    store.applyStreamSnapshot(sessionId, true, session.closeReason);
    return;
  }

  if (epochAtRequest === undefined) {
    // 请求发出时本地未在流式：仅当此刻也没有新回合在跑时才写 false
    // （RTT 内另一窗口/队列开了新回合时，快照的终态已过期）
    if (!store.sessionIsStreaming(sessionId)) {
      store.applyStreamSnapshot(sessionId, false, session.closeReason);
    }
    return;
  }

  // 探测期间又开了新回合 → 响应过期，不覆盖
  if (store.streamEpoch(sessionId) !== epochAtRequest) return;

  // 本地 running（请求发出时）→ 服务端 not-running：后台期间回合结束
  reconcileStoppedStream(store, sessionId, session.closeReason);
}
