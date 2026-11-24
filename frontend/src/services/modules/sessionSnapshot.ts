/**
 * 带内历史快照的客户端应用。
 *
 * 服务端在一条 SSE 连接上先下发 `session_snapshot`（事件页 + 在飞尾部），
 * 再排空读页期间积压的帧——因此客户端只需"fold 快照 + 应用尾部"，
 * 不需要再用邮箱/stash 兜住读页竞态。
 *
 * 这里把应用逻辑抽成纯函数，便于单测（ChatPanel 没有组件级测试）。
 */
import {
  applyInFlightChunks,
  foldEvents,
  type ProjectorChunk,
  type ProjectorSessionState,
  type ProjectorSessionStore,
} from "./streamProjector";

/** 后端 session_snapshot 帧的 payload */
export interface SessionSnapshotPayload {
  requestId: string;
  sessionId: string;
  /** 事件页（领域事件，seq 序） */
  events: ProjectorChunk[];
  /** 页尾 seq；-1 表示读页失败（payload.error 有值） */
  endSeq: number;
  nextBeforeSeq: number | null;
  hasMore: boolean;
  /** 请求时刻截取的在飞尾部（未落盘的 delta 等） */
  tail: ProjectorChunk[];
  /** 后端进程标识（诊断用） */
  bootId: string;
  error?: string;
}

interface SnapshotSessionState extends ProjectorSessionState {
  pageCursor?: number | null;
  turnsHasMore?: boolean;
}

export interface SessionSnapshotStore extends ProjectorSessionStore {
  getSessionState(sessionId: string): SnapshotSessionState;
  resetAppliedSeq(sessionId: string, seq?: number): void;
}

/**
 * 应用一次历史快照：事件页替换 → fold 重建 → 尾部重放 → 水位/分页写入。
 *
 * 返回实际重放的尾部帧数（供诊断/trace）。
 */
export function applySessionSnapshot(
  store: SessionSnapshotStore,
  sessionId: string,
  snapshot: SessionSnapshotPayload,
): { appliedTail: number } {
  const state = store.getSessionState(sessionId);
  state.eventLog = [...snapshot.events];
  foldEvents(store, sessionId, state.eventLog, "snapshot");

  const appliedTail = applyInFlightChunks(
    store,
    sessionId,
    snapshot.tail,
    snapshot.endSeq,
  );

  state.pageCursor = snapshot.nextBeforeSeq;
  state.turnsHasMore = snapshot.hasMore;
  state.loaded = true;
  // 整页重建是唯一有资格下调水位的路径（日志回绕后旧高水位必须能复位）
  store.resetAppliedSeq(sessionId, snapshot.endSeq);

  return { appliedTail };
}
