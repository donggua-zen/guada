/**
 * StreamEventHub:流式事件路由中心(合并为单 SSE 后的前端核心)
 *
 * 模型:每个会话一个"邮箱"(mailbox,滚动窗口)+ 全局常驻订阅者。
 * - route(event):先按传输位置 (baseSeq, chunkSeq) 幂等校验,再进邮箱;全局订阅者同步收到
 * - subscribeAll(onEvent):唯一的生产消费入口(useSessionEvents 常驻消费)
 * - getTailAfterLastCheckpoint(sessionId):强制重拉时取"最后一个落盘边界之后的在飞尾部"
 * - noteCatchupPositions():连接补发开始前登记各流起点,判定补发是否覆盖本地游标
 *
 * 两个 seq 概念（务必区分）:
 * - `prevSeq`(线上字段名) = **传输区间基座** baseSeq。后端 publish 为每条帧盖戳
 *   (prevSeq, chunkSeq) + streamBootId(进程标识)。prevSeq 是落库区间，chunkSeq 是区间内
 *   第 n 个帧(prevSeq 前进时归零)，按会话连续、跨回合不重置。因为 chunk 不入库，
 *   prevSeq 不会落在 chunk 区间中间——历史页读取与尾部重放都依赖它。
 *   注意 prevSeq 被后端单调钳制(抵御并发 publish 乱序)，**不代表真实日志尾**。
 * - `logSeq` = 发布时刻未钳制的真实落库 seq，**已应用水位**只认它(见 useSessionEvents)。
 *
 * 去重:SSE 重连补发会重放整个 eventBuffer;同 bootId 下位置 <= 游标的帧在此直接丢弃,
 * 防止 delta 重复追加导致文本翻倍。bootId 变化(后端重启)则接受并重置游标。
 * 缺任一位置字段的帧 fail-open(不去重),兼容旧后端/异常帧。
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
  /** 每会话幂等游标(后端盖戳的传输位置 baseSeq/chunkSeq + streamBootId;重连补发去重依据) */
  private readonly streamCursor = new Map<
    string,
    { bootId?: string; prevSeq: number; chunkSeq: number }
  >();
  /**
   * 补发不覆盖本地游标的会话（可能丢了落库事件）。
   *
   * 由 connected 帧的 streamPositions 判定：补发起点 baseSeq 越过本地游标的 baseSeq，
   * 说明中间跨过了落库区间。标记后冻结水位推进，恢复走整页重拉；整页重拉成功后清除。
   */
  private readonly gapSessions = new Set<string>();

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
   * 入口幂等:带传输位置 (prevSeq, chunkSeq) 的事件,若同 bootId 下位置 <= 游标则判定为
   * 连接补发的重放/重复投递,直接丢弃;bootId 变化(后端重启)接受并重置游标;
   * 缺任一位置字段的事件放行(fail-open)。
   * 通过校验后:事件进邮箱,并同步推给全局常驻订阅者。
   */
  route(event: HubStreamEvent): void {
    const sessionId = event.sessionId;
    if (!sessionId) return;

    const baseSeq = event.prevSeq;
    const ord = event.chunkSeq;
    if (
      typeof baseSeq === "number" &&
      Number.isFinite(baseSeq) &&
      typeof ord === "number" &&
      Number.isFinite(ord)
    ) {
      const cursor = this.streamCursor.get(sessionId);
      if (cursor && cursor.bootId === event.streamBootId) {
        const duplicate =
          baseSeq < cursor.prevSeq ||
          (baseSeq === cursor.prevSeq && ord <= cursor.chunkSeq);
        if (duplicate) return;
      }
      this.streamCursor.set(sessionId, {
        bootId: event.streamBootId,
        prevSeq: baseSeq,
        chunkSeq: ord,
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

  /** 邮箱当前条数（仅诊断/测试；未缓存会话 = 0，不创建缓存） */
  getMailboxSize(sessionId: string): number {
    return this.sessions.get(sessionId)?.mailbox.length ?? 0;
  }

  /** 当前去重游标（仅诊断/测试；无缓存返回 undefined）。字段名沿用线上 prevSeq。 */
  getCursor(
    sessionId: string,
  ): { bootId?: string; baseSeq: number; chunkSeq: number } | undefined {
    const cursor = this.streamCursor.get(sessionId);
    return cursor
      ? { bootId: cursor.bootId, baseSeq: cursor.prevSeq, chunkSeq: cursor.chunkSeq }
      : undefined;
  }

  /**
   * 登记一次连接补发的各流起点位置（来自 connected 帧的 streamPositions）。
   *
   * 判定规则：只有"补发起点跨过了本地游标的落库区间"(start.baseSeq > cursor.baseSeq)
   * 才标记缺口——中间可能有本地从未收到的落库事件。
   * 同一 baseSeq 内 chunkSeq 跳跃不标记：cleanupIntermediateEvents 会删掉已完成的 delta
   * （由 block_end 携带完整块替代），属合法空洞。
   * 本地无游标（从未收到该会话的 live 帧）时不判定：内容由事件页/增量补拉负责。
   */
  noteCatchupPositions(
    positions: ReadonlyArray<{
      sessionId: string;
      prevSeq: number;
      chunkSeq: number;
    }>,
  ): void {
    for (const pos of positions) {
      const cursor = this.streamCursor.get(pos.sessionId);
      if (!cursor) continue;
      if (pos.prevSeq > cursor.prevSeq) {
        this.gapSessions.add(pos.sessionId);
      }
    }
  }

  /** 是否有待处理的补发缺口（缺口未清前不推进已应用水位） */
  hasPendingGap(sessionId: string): boolean {
    return this.gapSessions.has(sessionId);
  }

  /** 清除缺口标记（整页重拉成功后调用） */
  clearStreamGap(sessionId: string): void {
    this.gapSessions.delete(sessionId);
  }

  /** 清理会话状态（会话删除时）：释放邮箱、幂等游标与缺口标记 */
  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.streamCursor.delete(sessionId);
    this.gapSessions.delete(sessionId);
  }
}

/** 全局单例(与 SessionEventsService 配对使用) */
export const streamEventHub = new StreamEventHub();
