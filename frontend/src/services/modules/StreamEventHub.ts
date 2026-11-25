/**
 * StreamEventHub:流式事件路由与重放去重中心(合并为单 SSE 后的前端核心)
 *
 * 模型:只做"入口幂等 + 全局扇出",**不持有事件邮箱**。
 * - route(event):先按传输位置 (baseSeq, chunkSeq) 幂等校验,通过后同步推给全局订阅者
 * - subscribeAll(onEvent):唯一的生产消费入口(useSessionEvents 常驻消费)
 * - noteCatchupPositions():连接补发开始前登记各流起点,判定补发是否覆盖本地游标
 *
 * 为什么没有邮箱:历史读取的往返竞态已上移到服务端——`POST /events/open` 触发后,
 * 快照与读页期间产生的帧走同一条 SSE 连接按序下发（见 SessionEventsService 的
 * pendingSnapshot），客户端不需要自己缓冲事件。
 *
 * 两个 seq 概念（务必区分）:
 * - `baseSeq`(线上字段名 prevSeq) = **传输区间基座**。后端 publish 为每条帧盖戳
 *   (baseSeq, chunkSeq) + streamBootId(进程标识)。按会话连续、跨回合不重置。
 *   注意 baseSeq 被后端单调钳制(抵御并发 publish 乱序)，**不代表真实日志尾**。
 * - `logSeq` = 发布时刻未钳制的真实落库 seq，用于快照尾部覆盖判断；
 *   历史确认水位只由权威事件页/连续增量批次推进，收到 live 帧不代表此前日志已完整应用。
 *
 * 去重:内容与全局通知分别维护游标，避免未 watch 期间的通知越过内容缺口。
 * SSE 重连补发会重放整个 eventBuffer;同通道、同 bootId 下位置 <= 游标的帧在此丢弃,
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

const GLOBAL_NOTIFICATION_TYPES: ReadonlySet<WireStreamEvent["type"]> = new Set([
  "ask_requested",
  "ask_resolved",
  "workflow_event",
  "compression_error",
]);

/** 会话流式订阅者 */
interface SessionSubscriber {
  id: string;
  onEvent: (chunk: HubStreamEvent) => void;
}

export class StreamEventHub {
  /** 全局订阅者:常驻消费所有会话的流式事件(接收链路独立的基础) */
  private globalSubscribers: SessionSubscriber[] = [];
  /** 内容帧游标；不受未 watch 时仍能收到的全局通知影响。 */
  private readonly streamCursor = new Map<
    string,
    { bootId?: string; baseSeq: number; chunkSeq: number }
  >();
  /** 与后端 ALWAYS_BROADCAST_STREAM_TYPES 对齐，独立去重避免通知跨过内容缺口。 */
  private readonly notificationCursor = new Map<
    string,
    { bootId?: string; baseSeq: number; chunkSeq: number }
  >();
  /**
   * 补发不覆盖本地游标的会话（可能丢了落库事件）。
   *
   * 由 connected 帧的 streamPositions 判定：补发起点 baseSeq 越过本地游标的 baseSeq，
   * 说明中间跨过了落库区间。标记后冻结水位推进，恢复走整页重拉；整页重拉成功后清除。
   */
  private readonly gapSessions = new Set<string>();

  /**
   * 路由一条流式事件(由 SessionEventsService 在收到 stream/* method 时调用)
   *
   * 入口幂等:带传输位置 (baseSeq, chunkSeq) 的事件,若同 bootId 下位置 <= 游标则判定为
   * 连接补发的重放/重复投递,直接丢弃;bootId 变化(后端重启)接受并重置游标;
   * 缺任一位置字段的事件放行(fail-open)。
   * 通过校验后同步推给全局常驻订阅者。
   */
  route(event: HubStreamEvent): void {
    const sessionId = event.sessionId;
    if (!sessionId) return;

    const baseSeq = event.baseSeq;
    const ord = event.chunkSeq;
    if (
      typeof baseSeq === "number" &&
      Number.isFinite(baseSeq) &&
      typeof ord === "number" &&
      Number.isFinite(ord)
    ) {
      const cursors = GLOBAL_NOTIFICATION_TYPES.has(event.type)
        ? this.notificationCursor
        : this.streamCursor;
      const cursor = cursors.get(sessionId);
      if (cursor && cursor.bootId === event.streamBootId) {
        const duplicate =
          baseSeq < cursor.baseSeq ||
          (baseSeq === cursor.baseSeq && ord <= cursor.chunkSeq);
        if (duplicate) return;
      }
      cursors.set(sessionId, {
        bootId: event.streamBootId,
        baseSeq: baseSeq,
        chunkSeq: ord,
      });
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

  /** 当前去重游标（仅诊断/测试；无缓存返回 undefined）。字段名沿用线上 baseSeq。 */
  getCursor(
    sessionId: string,
  ): { bootId?: string; baseSeq: number; chunkSeq: number } | undefined {
    const cursor = this.streamCursor.get(sessionId);
    return cursor
      ? { bootId: cursor.bootId, baseSeq: cursor.baseSeq, chunkSeq: cursor.chunkSeq }
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
      baseSeq: number;
      chunkSeq: number;
    }>,
  ): void {
    for (const pos of positions) {
      const cursor = this.streamCursor.get(pos.sessionId);
      if (!cursor) continue;
      if (pos.baseSeq > cursor.baseSeq) {
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

  /** 清理会话状态（会话删除/清空/日志换代时）：释放幂等游标与缺口标记 */
  cleanup(sessionId: string): void {
    this.streamCursor.delete(sessionId);
    this.notificationCursor.delete(sessionId);
    this.gapSessions.delete(sessionId);
  }
}

/** 全局单例(与 SessionEventsService 配对使用) */
export const streamEventHub = new StreamEventHub();
