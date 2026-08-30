/**
 * StreamReceiver:全局唯一流式事件接收器
 *
 * 目标架构(与 DSH 对照):发送是发送、接收是接收——接收必须唯一。
 * 所有流式事件(自己发起的响应 / 其他窗口的流 / 刷新后订阅)统一经
 * 全局 SSE → StreamEventHub 到达,由本 receiver 唯一消费并分发。
 *
 * 三条铁律(正本:docs/接收唯一receiver方案.md):
 * 1. 唯一入口:streamEventHub.subscribe 只在 receiver 内部出现一次;
 *    useStreamResponse 等业务层不直接碰 streamEventHub,统一经本 receiver。
 * 2. 会话级:setActiveSession 设置当前会话,切换时注销上一会话的订阅,
 *    非当前会话的事件(activeSessionId 不匹配)丢弃。
 * 3. 时序:setHistoryBaseline(sid, lastSeq) 在 loadSession 拉历史后调用,
 *    receiver 对该会话才处理 prevSeq >= lastSeq 的增量——历史拉取完成前不处理。
 */

import { streamEventHub, type HubStreamEvent } from "./StreamEventHub";

interface ReceiverSession {
  lastSeq: number | null;
  unsubscribe: () => void;
  onEvent: (chunk: HubStreamEvent) => void;
}

class StreamReceiver {
  /** 当前会话 id(会话级过滤依据;切换时注销上一会话) */
  private activeSessionId: string | null = null;

  /** 各会话历史基线游标(setHistoryBaseline 记录;时序:基线就绪才处理该会话增量) */
  private readonly lastSeqBySession = new Map<string, number | null>();

  /** 各会话的订阅(一个会话一个;重复订阅/切换会话时注销旧的) */
  private readonly sessions = new Map<string, ReceiverSession>();

  /**
   * 设置当前会话(会话级铁律②)。
   * 切换会话时注销上一会话的订阅;旧会话仍在订阅中的事件(activeSessionId 不匹配)丢弃。
   */
  setActiveSession(sessionId: string | null): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      this.unsubscribe(this.activeSessionId);
    }
    this.activeSessionId = sessionId;
  }

  /**
   * 设置历史基线(时序铁律③)。
   * 在 loadSession(HTTP 拉历史)之后调用,记录 lastSeq;receiver 对该会话
   * 才处理 prevSeq >= lastSeq 的增量(历史未拉取前不处理,邮箱先缓存)。
   */
  setHistoryBaseline(sessionId: string, lastSeq: number): void {
    this.lastSeqBySession.set(sessionId, lastSeq);
  }

  /**
   * 订阅某会话的流式事件(唯一消费点,内部调 streamEventHub.subscribe)。
   *
   * 必须在 loadSession(历史拉取,得 lastSeq)之后调用——lastSeq 是增量基线,
   * 返回"邮箱里 prevSeq >= lastSeq 的增量",之后实时事件按 activeSessionId 过滤回调。
   *
   * @returns initialEvents 邮箱中 prevSeq >= lastSeq 的增量
   */
  subscribe(
    sessionId: string,
    lastSeq: number | null,
    onEvent: (chunk: HubStreamEvent) => void,
  ): HubStreamEvent[] {
    // 同一会话重复订阅:先注销旧的,保证一个会话只有一个订阅
    this.unsubscribe(sessionId);

    const { initialEvents, unsubscribe } = streamEventHub.subscribe(
      sessionId,
      lastSeq,
      (chunk) => {
        // 会话级过滤:非当前会话的事件丢弃(即使订阅还在,切换会话后不再处理)
        if (this.activeSessionId !== sessionId) return;
        onEvent(chunk);
      },
    );

    this.sessions.set(sessionId, { lastSeq, unsubscribe, onEvent });
    return initialEvents;
  }

  /** 注销某会话的订阅(会话切换/流结束/清理时) */
  unsubscribe(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.unsubscribe();
      this.sessions.delete(sessionId);
    }
  }

  /** 全局常驻订阅(接收链路独立入口):消费所有会话的流式事件,按 sessionId 路由处理。 */
  subscribeAll(onEvent: (chunk: HubStreamEvent) => void): () => void {
    return streamEventHub.subscribeAll(onEvent);
  }

  /** 注销全部订阅(登出/整体清理) */
  clear(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.unsubscribe(sessionId);
    }
    this.activeSessionId = null;
    this.lastSeqBySession.clear();
  }

  /** 当前会话 id(调试/断言用) */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }
}

/** 全局单例(与 StreamEventHub 配对:一个 hub、一个 receiver) */
export const streamReceiver = new StreamReceiver();
