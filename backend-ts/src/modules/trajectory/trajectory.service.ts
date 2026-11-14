/**
 * 轨迹投影服务（对齐 dsh trajectory-snapshot-builder 的配对思路，REST 拉式）
 *
 * 单遍重放（复用 replayer fold 产出共享时间线）+ 一次 step 括号扫描：
 * - 时间线 = foldEvents 的 MessageNode[]（与 getHistory()/前端 streamProjector 同源）
 * - step 配对 = 按事件顺序：step/start 开卡，遇到 step/end 收卡（requestId 一致性由
 *   写入侧保证，投影只按顺序配对并防御「新 start 未收上一卡」的孤儿括号）——
 *   对齐 dsh trajectory 按 (turn, step) 配对 request/header 与 assistant 请求的思路
 * - IN 区 = 上一 step/end 之后到本 step/start 之间的 surface 消息切片 + transient/fullInput
 * - OUT 区 = [stepStart, stepEnd] 区间内 assistant 块 + tool/result（区间切片，零复制）
 *
 * log-only 纪律的重放镜像：step 事件不进时间线；旧日志（无 step 事件）→
 * steps: [] + available: false，不伪造（对齐「不伪造」的空态语义）。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import {
  foldEvents,
  createInitialState,
  userMessageFromData,
  assistantMessageFromData,
  toolResultFromData,
} from '../../common/persistence/replayer';
import type { BaseEvent, Envelope } from '../../common/persistence/types';
import type {
  AssistantMessageData,
  StepEndData,
  StepStartData,
  ToolResultData,
  UserMessageData,
} from '../../common/persistence/types';
import type { TokenUsage } from '../../common/types/conversation.types';
import type {
  TrajectoryEnvelopeSnapshot,
  TrajectoryEventView,
  TrajectoryStepStatus,
  TrajectoryStepView,
  TrajectoryView,
} from './trajectory.types';

/** step 卡配对的中间态 */
interface OpenStepCard {
  startEvent: BaseEvent;
  data: StepStartData;
  /**
   * 括号内 assistant/message 携带的 usage（Token 收敛：主循环 step/end 不写 usage，
   * 投影端从 OUT 区 assistant 消息合成——事实单载体在 assistant/message 上，对齐 dsh）。
   */
  assistantUsage?: TokenUsage;
}

@Injectable()
export class TrajectoryService {
  private readonly logger = new Logger(TrajectoryService.name);

  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
  ) {}

  /** 确保会话有持久化存储（与新会话/未加载路径兼容） */
  async getTrajectory(sessionId: string, limit = 200): Promise<TrajectoryView> {
    await this.messageStore.ensureSession(sessionId);
    const events = await this.messageStore.getAllEvents(sessionId);

    // 共享时间线：复用既有 fold 管线（compaction 遮蔽 / turn/delete / prune 语义一致）
    const timeline = foldEvents(events, createInitialState()).messages;

    // step 括号扫描 + envelope 追踪（单遍）
    const envelope: Envelope | null = null;
    let lastEnvelope: Envelope | null = null;
    /** 全部 envelope 快照（SYSTEM 变更历史；通常 1~3 条，变更才写） */
    const envelopes: TrajectoryEnvelopeSnapshot[] = [];
    let hasStepEvents = false;
    const cards: TrajectoryStepView[] = [];
    let open: OpenStepCard | null = null;
    /** 上一张已收卡的事件 seq（IN 区下界来源） */
    let prevEndSeq = 0;
    /**
     * 审计事件流（日志全量，一事件一行）：surface 消息节点按原始事件归一化，
     * turn/delete 只做标记不回溯删除——轨迹是审计视图，已删除轮次必须可见。
     */
    const eventsView: TrajectoryEventView[] = [];
    /** 审计侧回合归属（与重放器同构：turn/start 开、turn/delete 清） */
    let auditTurnId: string | null = null;

    for (const event of events) {
      switch (event.type) {
        case 'turn/start': {
          const data = event.data as { turnId?: string } | undefined;
          if (data?.turnId) auditTurnId = data.turnId;
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            data: event.data as unknown as Record<string, unknown>,
          });
          break;
        }
        case 'turn/delete': {
          const data = event.data as { turnId?: string } | undefined;
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            data: event.data as unknown as Record<string, unknown>,
          });
          if (auditTurnId === data?.turnId) auditTurnId = null;
          break;
        }
        case 'user/message': {
          const node = userMessageFromData(
            event.data as unknown as UserMessageData,
            event.time,
          );
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            node: { ...node, seq: event.seq, turnId: auditTurnId ?? '' },
          });
          break;
        }
        case 'assistant/message': {
          const data = event.data as unknown as AssistantMessageData;
          const node = assistantMessageFromData(data, event.time);
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            node: { ...node, seq: event.seq, turnId: auditTurnId ?? '' },
          });
          // OUT 区 usage 合成来源：括号内的 assistant 消息携带 metadata.usage
          // （Token 收敛后主循环 step/end 不写 usage——事实单载体在 assistant/message 上）
          if (open) {
            const meta = data?.metadata as { usage?: unknown } | undefined;
            const usage = meta?.usage as TokenUsage | undefined;
            if (usage && typeof usage.promptTokens === 'number') {
              open.assistantUsage = usage;
            }
          }
          break;
        }
        case 'tool/result': {
          const node = toolResultFromData(
            event.data as unknown as ToolResultData,
            event.time,
          );
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            node: { ...node, seq: event.seq, turnId: auditTurnId ?? '' },
          });
          break;
        }
        case 'envelope': {
          lastEnvelope = event.data as unknown as Envelope;
          envelopes.push({ ...lastEnvelope, seq: event.seq, time: event.time });
          // 载荷走 envelopes 数组，事件行只记位置事实
          eventsView.push({ seq: event.seq, time: event.time, type: event.type });
          break;
        }
        case 'step/start': {
          hasStepEvents = true;
          // 防御：上一个卡未收（写入侧兜底失败时的孤儿括号）→ 以 unclosed 收卡
          if (open) {
            cards.push(this.closeCard(open, null, events, prevEndSeq, timeline.length));
            prevEndSeq = events[events.length - 1]?.seq ?? prevEndSeq;
            open = null;
          }
          open = {
            startEvent: event,
            data: event.data as unknown as StepStartData,
          };
          // 审计：请求侧载荷（transient/fullInput）原样随事件行携带（不限步、不缺页）
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            data: event.data as unknown as Record<string, unknown>,
          });
          break;
        }
        case 'step/end': {
          hasStepEvents = true;
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            data: event.data as unknown as Record<string, unknown>,
          });
          if (!open) break; // 孤儿 end（无 start）——理论不可达，忽略
          cards.push(this.closeCard(open, event, events, prevEndSeq, timeline.length));
          prevEndSeq = event.seq;
          open = null;
          break;
        }
        default: {
          eventsView.push({
            seq: event.seq,
            time: event.time,
            type: event.type,
            data: event.data as unknown as Record<string, unknown>,
          });
          break;
        }
      }
    }
    // 尾部孤儿卡（会话中断/进程退出）：unclosed，OUT 区到日志末尾
    if (open) {
      cards.push(this.closeCard(open, null, events, prevEndSeq, timeline.length));
    }

    // limit：保留最近 N 个 step（时间线保持全量——共享时间线一份）
    const totalSteps = cards.length;
    const limited = limit > 0 && cards.length > limit ? cards.slice(-limit) : cards;

    if (!hasStepEvents) {
      this.logger.debug(`trajectory for ${sessionId}: no step events (pre-feature session)`);
    }

    return {
      envelope: lastEnvelope ?? envelope,
      envelopes,
      timeline,
      steps: limited,
      events: eventsView,
      available: hasStepEvents,
      totalSteps,
    };
  }

  /** 展开 step 卡：IN/OUT 区间切片 + 元数据（私有纯函数） */
  private closeCard(
    open: OpenStepCard,
    endEvent: BaseEvent | null,
    _events: BaseEvent[],
    prevEndSeq: number,
    _timelineLen: number,
  ): TrajectoryStepView {
    const start = open.startEvent;
    const end = endEvent?.data
      ? (endEvent.data as unknown as StepEndData)
      : undefined;
    const status: TrajectoryStepStatus = end
      ? end.error
        ? 'error'
        : 'complete'
      : 'unclosed';

    return {
      turnId: open.data.turnId ?? null,
      step: open.data.step,
      source: open.data.source,
      ...(open.data.model === undefined ? {} : { model: open.data.model }),
      ...(open.data.provider === undefined ? {} : { provider: open.data.provider }),
      requestId: open.data.requestId,
      status,
      startedAt: start.time,
      completedAt: endEvent ? endEvent.time : null,
      durationMs: end ? end.durationMs : null,
      // usage 三级来源：step/end.usage（辅助调用显式携带）→ 括号内 assistant 消息的
      // metadata.usage（主循环合成路径）→ 缺省（空消息/失败路径，provider 未报告）
      ...(end?.usage !== undefined
        ? { usage: end.usage }
        : open.assistantUsage !== undefined
          ? { usage: open.assistantUsage }
          : {}),
      ...(end?.finishReason === undefined ? {} : { finishReason: end.finishReason }),
      ...(end?.attemptIndex === undefined ? {} : { attemptIndex: end.attemptIndex }),
      ...(end?.error === undefined ? {} : { error: end.error }),
      ...(end?.mediaOverlay === undefined ? {} : { mediaOverlay: end.mediaOverlay }),
      startSeq: start.seq,
      endSeq: endEvent ? endEvent.seq : null,
      input: {
        // IN 区：上一张卡收口之后到本卡 start 之前的 surface 消息区间
        fromSeq: prevEndSeq + 1,
        toSeq: Math.max(prevEndSeq, start.seq - 1),
        ...(open.data.transient === undefined ? {} : { transient: open.data.transient }),
        ...(open.data.fullInput === undefined ? {} : { fullInput: open.data.fullInput }),
      },
      output: {
        fromSeq: start.seq,
        // unclosed 卡：OUT 区开到日志末尾（由前端按可用事件渲染）
        toSeq: endEvent ? endEvent.seq : Number.MAX_SAFE_INTEGER,
        ...(end?.assistantMessageId === undefined
          ? {}
          : { assistantMessageId: end.assistantMessageId }),
      },
    };
  }
}
