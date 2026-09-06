/**
 * 会话事件页服务（前端自折叠的加载源）
 *
 * 前端不再拉取"折叠好的三层 Turn[]"，而是拉取**事件页**——本服务把 JSONL 日志尾部
 * N 个回合的**领域事件原样**返回（seq 序），前端用同一折叠器折叠出 turn 树。
 *
 * 页语义（对齐 DSH 事件流：存储事件即领域事件，消费方自行折叠）：
 * - 页 = [页首回合的 turn/start .. beforeSeq] 的**连续事件区间**，页边界按回合括号对齐（不切括号）
 * - 反向扫描配对：从 beforeSeq 向前数 N 个有效回合（被删回合括号作废、多扫），页首 = 第 N 个有效回合起点
 * - 返回原始领域事件（turn/start、user/message、assistant/message、tool/result、turn/finish、
 *   turn/delete、compaction/summary、command/* 等）——被删回合/被压缩消息由前端经
 *   turn/delete / compaction/summary 自行消解，本服务零转码、零过滤、零重建
 */
import { Injectable, Inject } from "@nestjs/common";
import {
  PERSISTENCE_BACKEND_TOKEN,
  PersistenceBackend,
  BaseEvent,
} from "../../common/persistence/types";

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
  constructor(
    @Inject(PERSISTENCE_BACKEND_TOKEN) private readonly backend: PersistenceBackend,
  ) {}

  /**
   * 获取尾部事件页（领域事件原样返回）。
   * @param sessionId 会话 id
   * @param opts.beforeSeq 页尾上限（含）；缺省 = 当前最后 seq（初始加载）
   * @param opts.turns 本页包含的有效回合数
   */
  async getEventPage(
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

    // 被删回合集合（turn/delete 目标）：页定位按有效回合计数（被删括号作废多扫）；
    // 被删回合的 turn/delete 事件落在区间内时一并下发，由前端消解
    const deleted = new Set<string>();
    for (const e of events) {
      if (e.type === "turn/delete") deleted.add((e.data as { turnId: string }).turnId);
    }

    // 反向扫描配对：从 endIdx 向前数 N 个有效回合，页首 = 第 N 个有效回合的 turn/start
    let pageStartIdx = 0;
    let valid = 0;
    const counted = new Set<string>();
    for (let i = endIdx; i >= 0 && valid < turns; i--) {
      if (events[i].type !== "turn/start") continue;
      const tid = (events[i].data as { turnId: string }).turnId;
      if (counted.has(tid)) continue;
      counted.add(tid);
      if (!deleted.has(tid)) valid++;
      if (valid === turns) {
        pageStartIdx = i;
        break;
      }
    }
    // 不足 N 个有效回合 → 页首 = 日志起点（全量页）
    if (valid < turns) pageStartIdx = 0;

    // 领域事件原样返回（seq 序；前端折叠器自行消费/消解删除与压缩，零转码）
    const pageEvents = events.slice(pageStartIdx, endIdx + 1);

    const firstSeq = pageEvents[0]?.seq ?? -1;
    const lastSeq = pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1;
    return {
      events: pageEvents,
      endSeq: lastSeq,
      nextBeforeSeq: pageStartIdx > 0 ? firstSeq - 1 : null,
      hasMore: pageStartIdx > 0,
    };
  }

  /**
   * 从 JSONL 事件日志聚合压缩历史（替代已移除的 session_context_state DB 线）。
   *
   * 扫描规则：
   * - 摘要括号（compaction/start → summary → end）→ summarized（有摘要文本）/ discarded（空摘要）
   * - 孤立 compaction/end（无 start，纯裁剪路径锚点）→ pruned_only 条目
   * - before/after：end.beforeTokens 实测优先；旧事件无此字段时回退"上一占用锚点"
   *   （turn/finish.usedTokens 或上一 compaction/end.usedTokens）近似
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
      if (e.type === "turn/finish") {
        const used = (e.data as { usedTokens?: number })?.usedTokens;
        if (typeof used === "number") lastAnchorTokens = used;
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
