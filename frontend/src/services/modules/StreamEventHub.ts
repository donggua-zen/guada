/**
 * StreamEventHub:流式事件路由中心(合并为单 SSE 后的前端核心)
 *
 * 模型:每个会话一个"邮箱"(mailbox)+ 若干订阅者。
 * - route(event):事件永远进邮箱(滚动窗口,上限,不丢),有订阅者则同时实时推
 * - subscribe(sessionId, lastSeq, onEvent):一次性返回"邮箱里 prevSeq >= lastSeq 的增量"
 *   + 注册实时推送。lastSeq 来自 loadSession(JSONL 重放游标),与广播事件的 prevSeq 同一把序,
 *   因此"历史之后发生的增量"被精确切出,不需要按消息 id 去重 / 不需要 buffering 状态机。
 *
 * 关键不变量(先入库后发事件):广播事件的 prevSeq = 该会话最后一条已入库事件的 seq。
 * 因 chunk 不入库,lastSeq 永远不会落在 chunk 区间中间 → 区间内 chunk 要么全补(prevSeq >= lastSeq)
 * 要么全不补(prevSeq < lastSeq),顺序由邮箱数组顺序保证。
 *
 * 入口幂等(route 内):后端 publish 为每条事件盖戳 streamSeq(每会话单调)+ streamBootId
 * (进程标识)。SSE 重连时连接补发会重放整个 eventBuffer,已路由过的事件
 * (streamSeq <= 游标)在此直接丢弃——邮箱、订阅者、全局常驻消费方共享同一份去重,
 * 防止 delta 重复追加导致文本翻倍。bootId 变化(后端重启,序号归零)则接受并重置游标。
 */

/**
 * 会话流式事件 = 传输层判别联合（本地定义，与后端同构）
 * 来源:src/types/stream(与后端 event-chunk.types.ts 逐字段同构,将来整体迁入共享包)。
 * 事件类型字面量(turn_start/text_delta/finish 等)与后端规范强制一致,协议改动双端同时报错。
 */
import type { WireStreamEvent } from "@/types/stream";

export type HubStreamEvent = WireStreamEvent;

/** 会话流式订阅者 */
interface SessionSubscriber {
  id: string;
  onEvent: (chunk: HubStreamEvent) => void;
}

/** 会话流式状态 */
interface SessionStreamState {
  /** 邮箱:该会话最近到达的事件(滚动窗口,未打开也保留) */
  mailbox: HubStreamEvent[];
  /** 订阅者 */
  subscribers: SessionSubscriber[];
}

export class StreamEventHub {
  private readonly sessions = new Map<string, SessionStreamState>();
  /** 全局订阅者:常驻消费所有会话的流式事件(接收链路独立的基础) */
  private globalSubscribers: SessionSubscriber[] = [];
  /** 每会话邮箱上限:防止未打开会话的流式事件无限累积 */
  private readonly MAX_BUFFERED = 2000;
  /** 每会话幂等游标(后端盖戳的 streamSeq/streamBootId;重连补发去重依据) */
  private readonly streamCursor = new Map<
    string,
    { bootId?: string; lastSeq: number }
  >();

  private ensure(sessionId: string): SessionStreamState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        mailbox: [],
        subscribers: [],
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  /**
   * 路由一条流式事件(由 SessionEventsService 在收到 stream/* method 时调用)
   *
   * 入口幂等:带 streamSeq 的事件,若序号 <= 游标(同 bootId)则判定为
   * 连接补发的重放/重复投递,直接丢弃;bootId 变化(后端重启)接受并重置游标;
   * 无 streamSeq 的事件放行(fail-open)。
   * 通过校验后:事件进邮箱(无订阅者也保留,供打开会话时订阅取增量);有订阅者则实时推。
   */
  route(event: HubStreamEvent): void {
    const sessionId = event.sessionId;
    if (!sessionId) return;

    const seq = event.streamSeq;
    if (typeof seq === "number") {
      const cursor = this.streamCursor.get(sessionId);
      if (cursor && cursor.bootId === event.streamBootId && seq <= cursor.lastSeq) {
        return;
      }
      this.streamCursor.set(sessionId, {
        bootId: event.streamBootId,
        lastSeq: seq,
      });
    }

    const state = this.ensure(sessionId);

    state.mailbox.push(event);
    if (state.mailbox.length > this.MAX_BUFFERED) {
      state.mailbox.shift();
    }

    for (const sub of state.subscribers) {
      try {
        sub.onEvent(event);
      } catch (error) {
        console.error("[StreamEventHub] 订阅者处理事件失败:", error);
      }
    }

    // 全局订阅者:常驻接收所有会话事件(接收链路独立——事件到达即写缓存/暂存)
    for (const sub of this.globalSubscribers) {
      try {
        sub.onEvent(event);
      } catch (error) {
        console.error("[StreamEventHub] 全局订阅者处理事件失败:", error);
      }
    }
  }

  /**
   * 全局订阅(接收链路常驻入口):收到任意会话的流式事件都回调。
   * 用于唯一 receiver 常驻消费所有会话事件(按 sessionId 路由处理),与发送无关。
   *
   * @returns unsubscribe 取消订阅
   */
  subscribeAll(onEvent: (chunk: HubStreamEvent) => void): () => void {
    const sub: SessionSubscriber = {
      id: crypto.randomUUID(),
      onEvent,
    };
    this.globalSubscribers.push(sub);
    return () => {
      const idx = this.globalSubscribers.findIndex((s) => s.id === sub.id);
      if (idx !== -1) this.globalSubscribers.splice(idx, 1);
    };
  }

  /**
   * 订阅某会话的流式事件(打开会话时一次调用)
   *
   * @param sessionId 会话 ID
   * @param lastSeq 历史快照最后一条已入库事件的 seq(loadSession 返回;null 表示无历史,取全部)
   * @param onEvent 实时事件回调(订阅建立之后的流式事件)
   * @returns initialEvents(邮箱中 prevSeq >= lastSeq 的增量)+ unsubscribe
   */
  subscribe(
    sessionId: string,
    lastSeq: number | null,
    onEvent: (chunk: HubStreamEvent) => void,
  ): { initialEvents: HubStreamEvent[]; unsubscribe: () => void } {
    const state = this.ensure(sessionId);

    // 增量 = 邮箱里 prevSeq >= lastSeq 的事件(先入库后发契约下,lastSeq 之前的事件必已在快照中)
    const initialEvents = state.mailbox.filter((event) => {
      const seq = event.prevSeq;
      if (seq === undefined || seq === null) return false;
      return lastSeq === null || seq >= lastSeq;
    });

    const sub: SessionSubscriber = {
      id: crypto.randomUUID(),
      onEvent,
    };
    state.subscribers.push(sub);

    return {
      initialEvents,
      unsubscribe: () => {
        const idx = state.subscribers.findIndex((s) => s.id === sub.id);
        if (idx !== -1) state.subscribers.splice(idx, 1);
      },
    };
  }

  /** 清理会话状态(会话关闭/删除时) */
  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.streamCursor.delete(sessionId);
  }
}

/** 全局单例(与 SessionEventsService 配对使用) */
export const streamEventHub = new StreamEventHub();
