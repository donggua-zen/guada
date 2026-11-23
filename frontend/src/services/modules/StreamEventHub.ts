/**
 * StreamEventHub:流式事件路由中心(合并为单 SSE 后的前端核心)
 *
 * 模型:每个会话一个"邮箱"(mailbox,滚动窗口)+ 全局常驻订阅者。
 * - route(event):先按 streamSeq 幂等校验,再进邮箱;全局订阅者同步收到
 * - subscribeAll(onEvent):唯一的生产消费入口(useSessionEvents 常驻消费)
 * - getTailAfterLastCheckpoint(sessionId):强制重拉时取"最后一个落盘边界之后的在飞尾部"
 *
 * 关键不变量(先入库后发事件):广播事件的 prevSeq = 该会话最后一条已入库事件的 seq。
 * 因 chunk 不入库,prevSeq 不会落在 chunk 区间中间——历史页读取与尾部重放都依赖它。
 *
 * 入口幂等(route 内):后端 publish 为每条事件盖戳 streamSeq(每会话单调)+ streamBootId
 * (进程标识)。SSE 重连时连接补发会重放整个 eventBuffer,已路由过的事件
 * (streamSeq <= 游标)在此直接丢弃——邮箱与全局常驻消费方共享同一份去重,
 * 防止 delta 重复追加导致文本翻倍。bootId 变化(后端重启,序号归零)则接受并重置游标。
 */

/**
 * 会话流式事件 = 传输层判别联合（本地定义，与后端同构）
 * 来源:src/types/stream(与后端 event-chunk.types.ts 逐字段同构,将来整体迁入共享包)。
 * 事件类型字面量(turn_start/text_delta/finish 等)与后端规范强制一致,协议改动双端同时报错。
 */
import type { WireStreamEvent } from "@/types/stream";
import { generateUuid } from "@/utils/uuid";

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
   * 通过校验后:事件进邮箱,并同步推给全局常驻订阅者。
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
      id: generateUuid(),
      onEvent,
    };
    this.globalSubscribers.push(sub);
    return () => {
      const idx = this.globalSubscribers.findIndex((s) => s.id === sub.id);
      if (idx !== -1) this.globalSubscribers.splice(idx, 1);
    };
  }

  /**
   * 强制重拉用的"在飞尾部"：邮箱里最后一个 checkpoint（finish/turn_end）之后的所有 chunk。
   *
   * checkpoint 语义与暂存机制一致：finish/turn_end 表示该段内容已落盘（事件页包含），
   * 之后的 chunk 是尚未落盘的在飞增量（delta 不入 eventLog，fold 会抹掉）——强制重拉后
   * 需要按序重放回来，才等价于"整页刷新"（刷新靠 stash 达到同一效果）。
   *
   * 找不到 checkpoint（邮箱已滚出 / 该会话从未收过流）返回空：放弃尾部，
   * 与刷新路径共用同一 2000 条上限。只读：不改去重游标、不清邮箱。
   */
  getTailAfterLastCheckpoint(sessionId: string): HubStreamEvent[] {
    const state = this.sessions.get(sessionId);
    if (!state || state.mailbox.length === 0) return [];
    for (let i = state.mailbox.length - 1; i >= 0; i -= 1) {
      const type = state.mailbox[i].type;
      if (type === "finish" || type === "turn_end") {
        return state.mailbox.slice(i + 1);
      }
    }
    return [];
  }

  /** 邮箱当前条数（诊断/测试；未缓存会话 = 0，不创建缓存） */
  getMailboxSize(sessionId: string): number {
    return this.sessions.get(sessionId)?.mailbox.length ?? 0;
  }

  /** 清理会话状态（会话删除时）：释放邮箱与幂等游标 */
  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.streamCursor.delete(sessionId);
  }
}

/** 全局单例(与 SessionEventsService 配对使用) */
export const streamEventHub = new StreamEventHub();
