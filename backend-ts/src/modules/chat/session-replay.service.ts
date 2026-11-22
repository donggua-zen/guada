/**
 * 会话事件页服务（前端自折叠的加载源）
 *
 * 前端不再拉取"折叠好的三层 Turn[]"，而是拉取**事件页**——本服务把 JSONL 日志尾部
 * N 个回合的**领域事件原样**返回（seq 序），前端用同一折叠器折叠出 turn 树。
 *
 * 页语义（存储事件即领域事件，消费方自行折叠）：
 * - 页 = [页首回合的 turn/start .. beforeSeq] 的**连续事件区间**，页边界按回合括号对齐（不切括号）
 * - 反向扫描配对：从 beforeSeq 向前数 N 个有效回合（被删回合括号作废、多扫），页首 = 第 N 个有效回合起点
 * - 返回原始领域事件（turn/start、user/message、assistant/message、tool/result、turn/finish、
 *   turn/delete、compaction/summary、command/* 等）——被删回合/被压缩消息由前端经
 *   turn/delete / compaction/summary 自行消解，本服务零转码、零过滤、零重建
 */
import { Injectable, Inject, Logger } from "@nestjs/common";
import { MESSAGE_EVENT_LOG } from "../../common/persistence/event-log.port";
import type { MessageEventLog } from "../../common/persistence/event-log.port";
import type { BaseEvent } from "../../common/persistence/types";
import { CorruptSessionLogError } from "../../common/persistence/errors";

export interface EventPageResult {
  /** 领域事件原样（seq 序，前端折叠器消费） */
  events: BaseEvent[];
  /** 页尾事件 seq（= beforeSeq 或当前最后 seq）——前端 setHistoryBaseline 用 */
  endSeq: number;
  /** 下一页游标（页首事件 seq - 1）；无更早事件为 null */
  nextBeforeSeq: number | null;
  /** 是否还有更早内容（页首之前仍有事件） */
  hasMore: boolean;
}

/** 页容量上限（防超大拉取） */
const MAX_PAGE_TURNS = 100;

/**
 * 反向配对计数（页定位核心）：从 fromIdx 向前扫，turn/start 遇到其右侧已见的
 * turn/finish → 闭合轮次（按 turnId 去重）。turn/delete 不参与；进行中回合
 * （无 finish）不计入。与块流快路径、全量兜底路径共用，保证两路径页语义一致。
 */
function pairCountBackward(
  events: BaseEvent[],
  fromIdx: number,
  turns: number,
): { enough: boolean; pageStartIdx: number } {
  const open = new Set<string>(); // 已见 finish、等待 start 的回合
  const counted = new Set<string>();
  let valid = 0;
  for (let i = fromIdx; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === "turn/finish") {
      const tid = (e.data as { turnId?: string } | undefined)?.turnId;
      if (tid) open.add(tid);
      continue;
    }
    if (e.type === "turn/start") {
      const tid = (e.data as { turnId?: string } | undefined)?.turnId;
      if (tid && open.has(tid) && !counted.has(tid)) {
        counted.add(tid);
        valid += 1;
        if (valid === turns) return { enough: true, pageStartIdx: i };
      }
    }
  }
  return { enough: false, pageStartIdx: 0 };
}

/** 压缩历史条目（从 JSONL compaction 事件聚合，替代已移除的 session_context_state 表） */
export interface CompactionHistoryItem {
  /** 摘要括号 = summaryMessageId；纯裁剪 = `prune_<seq>` */
  id: string;
  createdAt: string;
  /** 摘要文本；纯裁剪为 null */
  summaryContent: string | null;
  shadowedCount: number;
  cleaningStrategy: "summarized" | "discarded" | "pruned_only";
  compressionStats: {
    /** 优先取事件携带的实测 beforeTokens；旧事件回退"上一占用锚点"近似 */
    beforeTokenCount?: number;
    afterTokenCount?: number;
  };
}

@Injectable()
export class SessionReplayService {
  private readonly logger = new Logger(SessionReplayService.name);

  constructor(
    @Inject(MESSAGE_EVENT_LOG) private readonly backend: MessageEventLog,
  ) {}

  /**
   * 获取尾部事件页（领域事件原样返回）。
   *
   * 读路径分层（接入块索引）：
   * - 快路径：消费 EventLogPageIndex.readChunksBackward 倒序块流，块内反向扫、
   *   简单 turn 配对（start 遇到右侧已见 finish → 闭合轮次）凑够 N 轮 → 页首=
   *   该 start；turn/delete 不参与计数、原样下发（前端投影消解）；进行中回合
   *   （无 finish）不计轮次，事件保留在页尾。
   * - 兜底：端口无 index 能力（非 JSONL 驱动）或块流抛非损坏异常（索引失效/
   *   fs 错误等）→ 落 getAllEvents 全量组装（权威路径）；损坏
   *   （CorruptSessionLogError）保持原语义直接上抛。
   *
   * @param sessionId 会话 id
   * @param opts.beforeSeq 页尾上限（含）；缺省 = 当前最后 seq（初始加载）
   * @param opts.turns 本页包含的配对闭合轮次数（钳制 [1,100]）
   */
  async getEventPage(
    sessionId: string,
    opts: { beforeSeq?: number; turns: number },
  ): Promise<EventPageResult> {
    const pageIndex = this.backend.index;
    if (pageIndex) {
      try {
        return await this.assemblePageViaChunks(sessionId, pageIndex, opts);
      } catch (e) {
        // 真实损坏（全量校验语义）保持 fail-fast；其它异常（索引失效残留/fs 错误）回退全量
        if (e instanceof CorruptSessionLogError) throw e;
        this.logger.warn(
          `[session-replay] 块索引读失败，回退全量扫描: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return this.getEventPageViaAllEvents(sessionId, opts);
  }

  /**
   * 快路径：消费倒序块流 + 配对凑页。
   * 页尾锚（beforeSeq/末尾 seq）固定，头部逐块前插不受影响；每块到达后检查
   * 「配对凑够 或 已覆盖日志起点」即停。
   */
  private async assemblePageViaChunks(
    sessionId: string,
    pageIndex: NonNullable<MessageEventLog["index"]>,
    opts: { beforeSeq?: number; turns: number },
  ): Promise<EventPageResult> {
    const turns = Math.min(Math.max(1, opts.turns), MAX_PAGE_TURNS);
    const acc: BaseEvent[] = []; // 从右向左增长的连续事件区间（seq 升序）
    let endSeqVal: number | null = opts.beforeSeq ?? null; // 页尾锚固定

    for await (const chunkEvents of pageIndex.readChunksBackward(sessionId, {
      fromSeq: opts.beforeSeq,
    })) {
      acc.unshift(...chunkEvents);
      if (endSeqVal === null && acc.length > 0) endSeqVal = acc[acc.length - 1].seq;
      const endIdx = acc.findIndex((e) => e.seq === endSeqVal);
      if (endIdx >= 0) {
        const coveredToStart = acc[0].seq === 0;
        const { enough } = pairCountBackward(acc, endIdx, turns);
        if (enough || coveredToStart) break;
      }
    }

    if (acc.length === 0) {
      return { events: [], endSeq: -1, nextBeforeSeq: null, hasMore: false };
    }
    const endIdx = acc.findIndex((e) => e.seq === endSeqVal);
    if (endIdx < 0) {
      // 游标超日志尾（翻页越界）→ 空页，与全量路径同语义
      return { events: [], endSeq: opts.beforeSeq ?? -1, nextBeforeSeq: null, hasMore: false };
    }
    const { enough, pageStartIdx } = pairCountBackward(acc, endIdx, turns);
    const start = enough ? pageStartIdx : 0;
    const pageEvents = acc.slice(start, endIdx + 1);
    // 覆盖判断：块流提前 break（凑够）时 acc[0] 未必是日志起点 → seq===0 才算覆盖
    const coveredToStart = acc[0].seq === 0;
    const hasMore = enough ? start > 0 || !coveredToStart : false;
    const nextBeforeSeq = start > 0 || hasMore ? pageEvents[0].seq - 1 : null;
    return {
      events: pageEvents,
      endSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
      nextBeforeSeq,
      hasMore,
    };
  }

  /** 兜底路径：getAllEvents 全量 + 同款配对组装（权威实现，页语义与快路径一致） */
  private async getEventPageViaAllEvents(
    sessionId: string,
    opts: { beforeSeq?: number; turns: number },
  ): Promise<EventPageResult> {
    const turns = Math.min(Math.max(1, opts.turns), MAX_PAGE_TURNS);
    const events = await this.backend.getAllEvents(sessionId);
    if (events.length === 0) {
      return { events: [], endSeq: -1, nextBeforeSeq: null, hasMore: false };
    }

    // 页尾：beforeSeq 缺省 = 最后事件；否则 = seq <= beforeSeq 的最后一个
    let endIdx = events.length - 1;
    if (opts.beforeSeq !== undefined) {
      endIdx = events.findIndex((e) => e.seq === opts.beforeSeq);
      if (endIdx === -1) {
        // beforeSeq 无对应事件（如已无更早内容）→ 空页
        return { events: [], endSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
      }
    }

    // 反向配对计数：从 endIdx 向前数 N 个闭合回合（start 与右侧 finish 配对），
    // 页首 = 第 N 个闭合回合的 turn/start。turn/delete 不参与计数（原样下发，
    // 由前端投影消解）；不足 N 个闭合回合 → 页首 = 日志起点（全量页）。
    const { enough, pageStartIdx } = pairCountBackward(events, endIdx, turns);
    const start = enough ? pageStartIdx : 0;

    // 领域事件原样返回（seq 序；前端折叠器自行消费/消解删除与压缩，零转码）
    const pageEvents = events.slice(start, endIdx + 1);
    const firstSeq = pageEvents[0]?.seq ?? -1;
    const lastSeq = pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1;
    const hasMore = enough ? start > 0 : false; // 全量数组恒覆盖起点
    return {
      events: pageEvents,
      endSeq: lastSeq,
      nextBeforeSeq: start > 0 ? firstSeq - 1 : null,
      hasMore,
    };
  }

  /**
   * 从 JSONL 事件日志聚合压缩历史（替代已移除的 session_context_state DB 线）。
   *
   * 扫描规则：
   * - 摘要括号（compaction/start → summary → end）→ summarized（有摘要文本）/ discarded（空摘要）
   * - 孤立 compaction/end（无 start，旧纯裁剪路径锚点）→ pruned_only 条目
   * - 带 heuristicTokens 的 context/stats（新纯裁剪路径锚点）→ pruned_only 条目
 * - before/after：end.beforeTokens 实测优先；旧事件无此字段时回退"上一占用锚点"
 *   （context/stats.usedTokens 或上一 compaction/end.usedTokens）近似
   * - 未闭合括号（进行中的压缩）不产出条目
   *
   * @param limit 返回最近 N 条（缺省全量）；total 恒为全部条目数
   */
  async getCompactionHistory(
    sessionId: string,
    limit?: number,
  ): Promise<{ items: CompactionHistoryItem[]; total: number }> {
    const events = await this.backend.getAllEvents(sessionId);
    const items: CompactionHistoryItem[] = [];
    // 上一占用锚点（before 回退口径）
    let lastAnchorTokens: number | undefined;
    // 当前打开的摘要括号（未收口不产出）
    let openBracket: {
      summary?: string;
      summaryMessageId?: string;
      shadowedCount?: number;
    } | null = null;

    for (const e of events) {
      // 占用锚点：小轮次 context/stats（异常终止也有）——Token 收敛后是唯一的
      // 占用快照载体（turn/finish 不再携带 token 字段）。
      // 带 heuristicTokens 的 anchor-stats 是"裁剪后修正占用"的锚点，同时产出一条 pruned_only 历史。
      if (e.type === "context/stats") {
        const d = e.data as {
          usedTokens?: number;
          beforeTokens?: number;
          heuristicTokens?: number;
        };
        const previousAnchorTokens = lastAnchorTokens;
        if (typeof d.usedTokens === "number") lastAnchorTokens = d.usedTokens;
        if (
          typeof d.usedTokens === "number" &&
          typeof d.heuristicTokens === "number"
        ) {
          items.push({
            id: `prune_${e.seq}`,
            createdAt: new Date(e.time).toISOString(),
            summaryContent: null,
            shadowedCount: 0,
            cleaningStrategy: "pruned_only",
            compressionStats: {
              beforeTokenCount:
                typeof d.beforeTokens === "number"
                  ? d.beforeTokens
                  : previousAnchorTokens,
              afterTokenCount: d.usedTokens,
            },
          });
        }
        continue;
      }
      if (e.type === "compaction/start") {
        openBracket = {};
        continue;
      }
      if (e.type === "compaction/summary") {
        if (openBracket) {
          const d = e.data as {
            summary?: string;
            summaryMessageId?: string;
            shadowedCount?: number;
          };
          openBracket.summary = d.summary;
          openBracket.summaryMessageId = d.summaryMessageId;
          openBracket.shadowedCount = d.shadowedCount ?? 0;
        }
        continue;
      }
      if (e.type !== "compaction/end") continue;

      const d = e.data as {
        usedTokens?: number;
        beforeTokens?: number;
      };
      const afterTokenCount =
        typeof d.usedTokens === "number" ? d.usedTokens : lastAnchorTokens;
      if (openBracket) {
        const summary = openBracket.summary ?? "";
        items.push({
          id: openBracket.summaryMessageId || `compaction_${e.seq}`,
          createdAt: new Date(e.time).toISOString(),
          summaryContent: summary || null,
          shadowedCount: openBracket.shadowedCount ?? 0,
          cleaningStrategy: summary ? "summarized" : "discarded",
          compressionStats: {
            beforeTokenCount:
              typeof d.beforeTokens === "number" ? d.beforeTokens : lastAnchorTokens,
            afterTokenCount,
          },
        });
        openBracket = null;
      } else {
        // 孤立 end = 纯裁剪路径（无摘要、无遮蔽）
        items.push({
          id: `prune_${e.seq}`,
          createdAt: new Date(e.time).toISOString(),
          summaryContent: null,
          shadowedCount: 0,
          cleaningStrategy: "pruned_only",
          compressionStats: {
            beforeTokenCount:
              typeof d.beforeTokens === "number" ? d.beforeTokens : lastAnchorTokens,
            afterTokenCount,
          },
        });
      }
      if (typeof d.usedTokens === "number") lastAnchorTokens = d.usedTokens;
    }

    const ordered = items.reverse();
    return {
      items: limit !== undefined ? ordered.slice(0, limit) : ordered,
      total: ordered.length,
    };
  }
}
