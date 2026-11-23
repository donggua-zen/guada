/**
 * Turn 锚点索引 —— 生产模块（写路径由 JsonlBackend 唯一写者维护）
 *
 * 设计：索引本身是 append-only 的迷你日志，与事件 JSONL 同分卷：
 * - 每卷事件 `seg-%04d.jsonl` 对应索引卷 `seg-%04d.idx`
 * - 索引只记 turn 锚点行：`{seq, 段内字节偏移, kind(s|f|d), turnId}`
 *   - s=turn/start（定位/计数用）、d=turn/delete（按 turnId 排除）、
 *     f=turn/finish（冗余记录，备未来升级；计数不使用）
 * - 读取：加载会话级索引（各卷，1000 轮约 80-160KB）→ 排除 delete 目标后
 *   反向数 N 个 turn/start → 一次 seek 到锚点字节偏移 → 读页区间 → 宽松校验
 *   → 返回。读放大 = 索引体积 + 页实际字节（无 2MB 块窗口）。
 *
 * 计数语义（用户定稿）：按 turn/start 计轮次——未闭合轮次也计入（前端显示即算数，
 * 稳态下修复会补 turn/finish）；turn/delete 目标排除。稳态日志下与"闭合配对"
 * 语义等价（唯一差异是进行中回合，新语义将其计入）。
 *
 * 宽松校验（容忍 append-only 竞态）：
 * - 区间首事件 seq === 锚点 seq（偏移漂移/截断 → 失配 → 重建该卷）
 * - 实读区间内从尾数 N 个有效 start 的页首 seq 应 === 锚点 seq；
 *   实际**更多**（索引落后/并发写入）→ 规整（裁到实际页首），只读诊断计数
 *   （laggedStarts），**不补写索引**；
 *   实际**更少**（数据短于索引）→ 重建该卷
 * - 索引不存在（读时）或校验失败 → 重建对应卷（只重扫该卷 ≤20MB，不重建全日志）
 *
 * 读端纯只读：
 * - 并发读-写交错造成的"落后"是瞬时的——写路径每次 append 事件后本就追加索引行，
 *   写完成即补齐；读端规整已保证结果正确，多读的字节随下一次写入自然恢复。
 * - 读端补写索引会引入多写者（重复行/seq 乱序），不予采用。
 * - 唯一的持久落后（写索引失败/崩溃窗口）修复点在**写入方**（单写者，安全）：
 *   下次写时检测"索引卷末行 seq < 事件段 endSeq"→ 从缺口 seq 起扫描补写索引行
 *   （接入设计项）；或索引校验失败走单卷重建（内容确定性派生，多读者并发重建
 *   结果相同，无害）。
 *
 * 依据（探索确认）：事件写入唯一入口 writeEvents；seg.bytes + 逐行 byteLength
 * 偏移精确；turn/delete 是唯一整轮删除；前端只用 nextBeforeSeq!=null/hasMore/endSeq
 * （nextBeforeSeq 仍返回真实事件 seq-1，前端零改）。
 *
 * 接入前置（真实接入时执行，本实验不改业务）：
 * 1. ensureActiveSegment 字节数用 fs.stat().size（已修复）
 * 2. seg=null 回退分支显式告警（已修复）
 * 3. deleteTurn 冷加载守卫（已修复）
 * 4. writeEvents：先 append 事件、后 append 索引行（唯一写者维护索引；含"索引末行
 *    seq < 段 endSeq"缺口自愈）；splitSegment/truncate/deleteSession 同步索引卷
 *    （归档/裁剪/随目录删除）
 */

import { Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import type { BaseEvent, Manifest } from './types';
import { resolveSessionsBasePath } from '../utils/session-path.util';

export interface AnchorRow {
  seq: number;
  /** 段内行首字节偏移 */
  off: number;
  kind: 's' | 'f' | 'd';
  turnId?: string;
}

export interface TurnAnchorStats {
  /** 读事件区间累计字节 */
  bytesReadEvents: number;
  /** 读索引文件累计字节 */
  bytesReadIndex: number;
  /** 已加载索引行数 */
  indexRows: number;
  /** 单卷重建次数 */
  rebuilds: number;
  /** 只读诊断：规整时发现"实际比索引落后"的轮次数（读端不补写索引） */
  laggedStarts: number;
  /** 重建扫描字节 */
  rebuildScannedBytes: number;
}

export interface TurnAnchorPage {
  events: BaseEvent[];
  endSeq: number;
  nextBeforeSeq: number | null;
  hasMore: boolean;
}

class AnchorIndexStaleError extends Error {}

interface LoadedSegment {
  segIdx: number;
  file: string;
  rows: AnchorRow[];
}

interface RowPos {
  segIdx: number;
  row: AnchorRow;
}

function cmpPos(a: RowPos, b: RowPos): number {
  return a.segIdx - b.segIdx || a.row.off - b.row.off;
}

function clampTurns(turns: number): number {
  return Math.min(Math.max(1, turns), 100);
}

/** 按字节区间读取（seek 读，不读整文件） */
async function readRange(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export class TurnAnchorIndex {
  private readonly logger = new Logger(TurnAnchorIndex.name);
  readonly stats: TurnAnchorStats = {
    bytesReadEvents: 0,
    bytesReadIndex: 0,
    indexRows: 0,
    rebuilds: 0,
    laggedStarts: 0,
    rebuildScannedBytes: 0,
  };

  constructor(private readonly basePath: string = resolveSessionsBasePath()) {}

  // ─── 写路径 API（由 JsonlBackend 唯一写者在事件 append 后调用） ───

  /**
   * 追加一批锚点行到指定事件卷的索引卷（CSV）。
   * - 索引卷不存在时先写 header（即使本批无锚点行也确保卷存在，
   *   避免新分卷的首次读取触发整卷重建）
   * - 调用方保证单写者（每会话写互斥）与"先事件、后索引"顺序
   */
  async appendBatchRows(sessionId: string, segFile: string, rows: AnchorRow[]): Promise<void> {
    const idxPath = this.getIndexPath(sessionId, segFile);
    if (!existsSync(idxPath)) {
      await fs.writeFile(idxPath, '#1\n', 'utf-8');
    }
    if (rows.length === 0) return;
    await fs.appendFile(idxPath, this.serializeRows(rows), 'utf-8');
    this.stats.indexRows += rows.length;
  }

  /**
   * 作废索引（删除文件，读时缺失 → 单卷重建兜底）。
   * @param segFile 缺省 = 全部卷（如会话重写）；指定则只失效该卷（如 truncate）
   */
  async invalidate(sessionId: string, segFile?: string): Promise<void> {
    if (segFile) {
      await fs.rm(this.getIndexPath(sessionId, segFile), { force: true });
      return;
    }
    const dir = this.getSessionDir(sessionId);
    if (!existsSync(dir)) return;
    const files = await fs.readdir(dir);
    await Promise.all(
      files.filter((f) => f.endsWith('.idx')).map((f) => fs.rm(path.join(dir, f), { force: true })),
    );
  }

  // ─── 读页主入口 ───

  /** 确保会话各卷索引就位（缺失/坏的卷重建；已存在则复用） */
  async ensureAllIndexes(sessionId: string): Promise<void> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest) return;
    for (const seg of manifest.segments) {
      if (!existsSync(this.getSegmentPath(sessionId, seg.file))) continue;
      await this.loadOrRebuild(sessionId, seg.file, seg.file === manifest.segments[manifest.segments.length - 1].file);
    }
  }

  async readPage(
    sessionId: string,
    opts: { beforeSeq?: number; turns: number },
  ): Promise<TurnAnchorPage> {
    const turns = clampTurns(opts.turns);
    const t0 = performance.now();
    const rebuiltBefore = this.stats.rebuilds;
    const laggedBefore = this.stats.laggedStarts;
    try {
      const page = await this.pageViaAnchors(sessionId, opts, turns, 0);
      const ms = performance.now() - t0;
      const rebuilt = this.stats.rebuilds - rebuiltBefore;
      const lagged = this.stats.laggedStarts - laggedBefore;
      // debug：每次读页一行汇总（默认级别不可见，排查时可开启）
      this.logger.debug(
        `[anchor] read page sid=${sessionId} turns=${turns} beforeSeq=${opts.beforeSeq ?? 'end'} ` +
          `firstSeq=${page.events[0]?.seq ?? '-'} events=${page.events.length} ` +
          `ms=${ms.toFixed(1)} rebuilt=${rebuilt} lagged=${lagged} hasMore=${page.hasMore}`,
      );
      if (ms > 200) {
        this.logger.warn(
          `[anchor] slow page read sid=${sessionId} ms=${ms.toFixed(0)} events=${page.events.length} rebuilt=${rebuilt} lagged=${lagged}`,
        );
      }
      return page;
    } catch (e) {
      const ms = performance.now() - t0;
      // 失效信号（消费方回退全量）与意外异常都值得记录
      this.logger.warn(
        `[anchor] read page failed sid=${sessionId} ms=${ms.toFixed(0)} ` +
          `err=${e instanceof Error ? e.message : e}`,
      );
      throw e;
    }
  }

  /**
   * 前向增量读（`seq > afterSeq`）：断点续传用，只读缺失尾部。
   *
   * 读放大控制（相对全量扫描）：
   * - 段级定位：manifest 的 `startSeq/endSeq` 已按 seq 递增，据此找到**含 afterSeq+1
   *   的段**，更早的段完全不读（不碰其字节、不解析）；
   * - 锚点收窄：该段 `.idx` 里取 `seq <= afterSeq` 的最后一个锚点行作为保守起点
   *   （无锚点 → 段首），把段内前导部分也跳过；
   * - 从起点按字节区间读到日志末尾，过滤 `seq > afterSeq`，按 limit 截断。
   *
   * 段内没有逐事件偏移索引（`.idx` 只存 turn 锚点），因此最坏多读"一个回合"的字节。
   * 索引缺失/损坏时抛错，由调用方（SessionReplayService）回退全量过滤。
   */
  async readTail(
    sessionId: string,
    opts: { afterSeq: number; limit: number },
  ): Promise<{ events: BaseEvent[]; endSeq: number; hasMoreAfter: boolean }> {
    const limit = Math.min(Math.max(1, opts.limit), 2000);
    const afterSeq = Number.isFinite(opts.afterSeq) ? opts.afterSeq : -1;
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest || manifest.segments.length === 0) {
      return { events: [], endSeq: afterSeq, hasMoreAfter: false };
    }

    // 1) 段级定位：第一个可能含 seq > afterSeq 的段。
    //    归档段有确定的 endSeq；最后一段（active）endSeq 为 null = 尾部无限延伸。
    const segments = manifest.segments;
    const lastSegFile = segments[segments.length - 1].file;
    let targetIdx = segments.length - 1;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      if (isLast) {
        targetIdx = i;
        break;
      }
      if (seg.endSeq !== null && seg.endSeq > afterSeq) {
        targetIdx = i;
        break;
      }
    }

    // 2) 只为 target 段及之后加载索引（更早段不读）
    const loaded: LoadedSegment[] = [];
    for (let i = targetIdx; i < segments.length; i += 1) {
      const seg = segments[i];
      const segPath = this.getSegmentPath(sessionId, seg.file);
      if (!existsSync(segPath)) continue;
      const isLastSeg = i === segments.length - 1;
      loaded.push({
        segIdx: i,
        file: seg.file,
        rows: await this.loadOrRebuild(sessionId, seg.file, isLastSeg),
      });
    }
    if (loaded.length === 0) {
      return { events: [], endSeq: afterSeq, hasMoreAfter: false };
    }

    // 3) 锚点收窄：target 段内最后一个 seq <= afterSeq 的锚点行（含 f/d 行——
    //    它们同样是"该 seq 已落盘"的定位点，比只认 start 更贴近真实缺口）。
    const target = loaded[0];
    let startPos: RowPos | null = { segIdx: target.segIdx, row: { seq: 0, off: 0, kind: 's' } };
    for (const row of target.rows) {
      if (row.seq <= afterSeq) {
        startPos = { segIdx: target.segIdx, row };
      } else {
        break; // rows 按 seq 升序（写入/重建均按文件序）
      }
    }

    // 4) 读到日志末尾并过滤
    const raw = await this.readEventRange(sessionId, loaded, startPos, null, lastSegFile);
    const after = raw.events.filter((e) => e.seq > afterSeq);
    const page = after.slice(0, limit);
    return {
      events: page,
      endSeq: page.length > 0 ? page[page.length - 1].seq : afterSeq,
      hasMoreAfter: after.length > limit,
    };
  }

  private async pageViaAnchors(
    sessionId: string,
    opts: { beforeSeq?: number; turns: number },
    turns: number,
    attempt: number,
  ): Promise<TurnAnchorPage> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest || manifest.segments.length === 0) {
      return { events: [], endSeq: -1, nextBeforeSeq: null, hasMore: false };
    }
    const lastSegFile = manifest.segments[manifest.segments.length - 1].file;

    // 1) 加载各卷索引（缺失/坏 → 重建该卷）
    const loaded: LoadedSegment[] = [];
    for (let i = 0; i < manifest.segments.length; i += 1) {
      const seg = manifest.segments[i];
      const segPath = this.getSegmentPath(sessionId, seg.file);
      if (!existsSync(segPath)) continue;
      const isLastSeg = i === manifest.segments.length - 1;
      loaded.push({ segIdx: i, file: seg.file, rows: await this.loadOrRebuild(sessionId, seg.file, isLastSeg) });
    }
    const allRows = loaded.flatMap((s) => s.rows);
    this.stats.indexRows = allRows.length;
    const starts = loaded.flatMap((s) => s.rows.filter((r) => r.kind === 's').map((row) => ({ segIdx: s.segIdx, row })));
    if (starts.length === 0) {
      // 无任何回合（如仅 session/init）：游标提供 → 空页（与全量 findIndex 未命中一致）；
      // 否则与全量实现一致返回全部事件（全量页）
      if (opts.beforeSeq !== undefined) {
        return { events: [], endSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
      }
      const rawAll = await this.readEventRange(sessionId, loaded, null, null, lastSegFile);
      if (rawAll.events.length === 0) {
        return { events: [], endSeq: -1, nextBeforeSeq: null, hasMore: false };
      }
      return {
        events: rawAll.events,
        endSeq: rawAll.events[rawAll.events.length - 1].seq,
        nextBeforeSeq: null,
        hasMore: false,
      };
    }

    // 2) 会话级 delete 集合（turn/delete 可跨卷、位置与目标无关）
    const deleted = new Set<string>();
    for (const r of allRows) {
      if (r.kind === 'd' && r.turnId) deleted.add(r.turnId);
    }
    const validStarts = starts.filter((p) => !(p.row.turnId && deleted.has(p.row.turnId)));

    // 3) 页尾：beforeSeq → 索引中第一个 seq > beforeSeq 的 turn/start 作为页尾开区间。
    //    找不到 = 游标非法/越界 —— 但如果游标恰指向"索引落后未收录的新 start"
    //    （并发写入首屏后立刻翻页），重建末卷索引后可恢复；仍无 → 空页
    let endPos: RowPos | null = null; // null = 日志末尾
    if (opts.beforeSeq !== undefined) {
      const nextStart = starts.find((p) => p.row.seq > opts.beforeSeq!);
      if (!nextStart) {
        if (attempt < 1) {
          await this.rebuildSegmentByIdx(sessionId, manifest, manifest.segments.length - 1);
          return this.pageViaAnchors(sessionId, opts, turns, attempt + 1);
        }
        return { events: [], endSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
      }
      endPos = nextStart;
    }

    // 4) 页首：页尾之前（严格小于 endPos）的有效 start，从尾向前数 N 个。
    //    **不足 N 个（或没有）→ 页首=日志起点**（全量页语义，含 session/init 等前导事件）
    const before = endPos ? validStarts.filter((p) => cmpPos(p, endPos!) < 0) : validStarts;
    if (before.length < turns) {
      const rawAll = await this.readEventRange(sessionId, loaded, null, endPos, lastSegFile);
      const pageEvents = rawAll.events;
      if (pageEvents.length === 0) {
        return { events: [], endSeq: opts.beforeSeq ?? -1, nextBeforeSeq: null, hasMore: false };
      }
      return {
        events: pageEvents,
        endSeq: pageEvents[pageEvents.length - 1].seq,
        nextBeforeSeq: null,
        hasMore: false,
      };
    }
    const anchor = before[before.length - turns];
    const anchorSeq = anchor.row.seq;

    // 5) 读区间 + 宽松校验 + 规整/追平
    const raw = await this.readEventRange(sessionId, loaded, anchor, endPos, lastSegFile);

    // 5a) 偏移校验：区间首事件应恰为锚点 start
    if (raw.events.length === 0 || raw.events[0].seq !== anchorSeq) {
      if (attempt >= 1) {
        // 重建后仍失配（非索引问题）→ 走兜底由调用方处理
        throw new AnchorIndexStaleError(
          `锚点偏移校验失败且重建后仍失配: ${anchor.segIdx}/${anchorSeq}`,
        );
      }
      // 偏移漂移/截断 → 重建锚点所在卷后重试
      await this.rebuildSegmentByIdx(sessionId, manifest, anchor.segIdx);
      return this.pageViaAnchors(sessionId, opts, turns, attempt + 1);
    }

    // 5b) 数量校验：区间内从尾向前数 N 个有效 start
    const actualValidIdx: number[] = [];
    for (let i = 0; i < raw.events.length; i += 1) {
      const e = raw.events[i];
      if (e.type !== 'turn/start') continue;
      const tid = (e.data as { turnId?: string } | undefined)?.turnId;
      if (tid && deleted.has(tid)) continue;
      actualValidIdx.push(i);
    }
    const actualAnchorIdx = actualValidIdx.length <= turns ? 0 : actualValidIdx[actualValidIdx.length - turns];
    const actualAnchorSeq =
      actualValidIdx.length === 0
        ? raw.events[0].seq
        : raw.events[actualValidIdx.length <= turns ? actualValidIdx[0] : actualAnchorIdx].seq;

    if (actualAnchorSeq < anchorSeq) {
      if (attempt >= 1) {
        throw new AnchorIndexStaleError(`区间内有效 start 少于索引（${actualAnchorSeq} < ${anchorSeq}）`);
      }
      // 数据短于索引（截断/索引超前）→ 重建该卷重试
      await this.rebuildSegmentByIdx(sessionId, manifest, anchor.segIdx);
      return this.pageViaAnchors(sessionId, opts, turns, attempt + 1);
    }

    // 规整：实际页首可能晚于索引锚点（索引落后/并发写入多出 turn）→ 裁到实际页首。
    // 读端**纯只读**：不补写索引文件——并发交错造成的落后是瞬时的（写路径每次
    // append 事件后本就追加索引行，写完成即补齐）；持久落后（写索引失败）的修复点
    // 在写入方（单写者自愈，见模块头注释）。这里只做只读诊断统计。
    let pageEvents = raw.events;
    let pageFirstIdx = 0;
    if (actualAnchorSeq > anchorSeq) {
      const lagged = actualValidIdx.filter((i) => i < actualAnchorIdx).length;
      this.stats.laggedStarts += lagged;
      this.logger.debug(
        `[anchor] index lagging sid=${sessionId} laggedStarts=${lagged} anchor=${anchorSeq} actual=${actualAnchorSeq}`,
      );
      pageFirstIdx = actualAnchorIdx;
      pageEvents = raw.events.slice(actualAnchorIdx);
    }

    // 6) 返回页
    const firstSeq = pageEvents[0]?.seq ?? -1;
    const lastSeq = pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1;
    const hasMore = firstSeq > 0 || pageFirstIdx > 0;
    return {
      events: pageEvents,
      endSeq: lastSeq,
      nextBeforeSeq: firstSeq > 0 ? firstSeq - 1 : null,
      hasMore,
    };
  }

  /**
   * 读事件区间 [startPos, endPos)（endPos=null → 日志末尾）。
   * startPos=null → 从日志起点读（全量页用）。
   * 跨卷按段序拼接；torn 尾（无换行残余/坏行）截断保留已解析部分。
   */
  private async readEventRange(
    sessionId: string,
    loaded: LoadedSegment[],
    startPos: RowPos | null,
    endPos: RowPos | null,
    lastSegFile: string,
  ): Promise<{ events: BaseEvent[]; linePos: { segIdx: number; off: number }[]; endSeq: number }> {
    const events: BaseEvent[] = [];
    const linePos: { segIdx: number; off: number }[] = [];
    const firstSegIdx = startPos ? startPos.segIdx : loaded[0]?.segIdx ?? 0;
    for (const seg of loaded) {
      if (seg.segIdx < firstSegIdx) continue;
      const segPath = this.getSegmentPath(sessionId, seg.file);
      if (!existsSync(segPath)) continue;
      const size = (await fs.stat(segPath)).size;
      // 按锚点字节区间 seek 读取（不读整卷——读放大 = 页实际字节）
      const from = startPos && seg.segIdx === startPos.segIdx ? startPos.row.off : 0;
      const to = endPos && seg.segIdx === endPos.segIdx ? endPos.row.off : size;
      if (to > from) {
        const buf = await readRange(segPath, from, to - from);
        this.stats.bytesReadEvents += buf.length;
        let pos = 0;
        while (pos < buf.length) {
          const nl = buf.indexOf(0x0a, pos);
          if (nl === -1) break; // torn 尾
          if (nl > pos) {
            try {
              const ev = JSON.parse(buf.subarray(pos, nl).toString('utf-8')) as BaseEvent;
              events.push(ev);
              linePos.push({ segIdx: seg.segIdx, off: from + pos });
            } catch {
              if (seg.file !== lastSegFile) {
                // 归档段坏行 = 已提交区损坏 → 失效信号（消费方回退全量 fail-fast）
                throw new AnchorIndexStaleError(`归档段坏行 ${seg.file}`);
              }
              break; // 最后段 torn 尾 → 截断
            }
          }
          pos = nl + 1;
        }
      }
      if (endPos && seg.segIdx >= endPos.segIdx) break;
    }
    return { events, linePos, endSeq: events.length > 0 ? events[events.length - 1].seq : -1 };
  }

  // ─── 索引卷加载/重建/序列化 ───

  private async loadOrRebuild(
    sessionId: string,
    segFile: string,
    isLastSegment: boolean,
  ): Promise<AnchorRow[]> {
    const idxPath = this.getIndexPath(sessionId, segFile);
    if (existsSync(idxPath)) {
      try {
        const raw = await fs.readFile(idxPath, 'utf-8');
        this.stats.bytesReadIndex += Buffer.byteLength(raw, 'utf-8');
        // header 完整性校验：无 '#1' 首行 = 坏索引（不能当"空索引"处理）
        if (!raw.startsWith('#')) {
          throw new Error('bad index header');
        }
        return this.parseRows(raw);
      } catch {
        /* 坏索引 → 重建 */
      }
    }
    return this.rebuildSegmentFile(sessionId, segFile, isLastSegment);
  }

  private async rebuildSegmentByIdx(
    sessionId: string,
    manifest: Manifest,
    segIdx: number,
  ): Promise<void> {
    const seg = manifest.segments[segIdx];
    if (!seg) return;
    await this.rebuildSegmentFile(sessionId, seg.file, segIdx === manifest.segments.length - 1);
  }

  /** 重建单卷索引（扫描事件卷提取锚点行，原子覆盖写） */
  /**
   * 重建单卷索引。归档段坏行 = 已提交区损坏 → 抛失效信号（消费方回退全量，
   * 由全量 assertScanClean 抛 CorruptSessionLogError，与块索引实现同语义）；
   * 最后段的 torn 尾 = 可修复尾部 → 截断处理。
   */
  private async rebuildSegmentFile(
    sessionId: string,
    segFile: string,
    isLastSegment: boolean,
  ): Promise<AnchorRow[]> {
    const scannedBefore = this.stats.rebuildScannedBytes;
    const segPath = this.getSegmentPath(sessionId, segFile);
    const rows: AnchorRow[] = [];
    if (existsSync(segPath)) {
      const buf = await fs.readFile(segPath);
      this.stats.rebuildScannedBytes += buf.length;
      let pos = 0;
      while (pos < buf.length) {
        const nl = buf.indexOf(0x0a, pos);
        if (nl === -1) break; // torn 残余
        if (nl > pos) {
          try {
            const ev = JSON.parse(buf.subarray(pos, nl).toString('utf-8')) as BaseEvent;
            const kind = ev.type === 'turn/start' ? 's' : ev.type === 'turn/finish' ? 'f' : ev.type === 'turn/delete' ? 'd' : null;
            if (kind && typeof ev.seq === 'number') {
              const tid = (ev.data as { turnId?: string } | undefined)?.turnId;
              rows.push({ seq: ev.seq, off: pos, kind, turnId: tid });
            }
          } catch {
            if (!isLastSegment) {
              throw new AnchorIndexStaleError(`归档段坏行 ${segFile}`);
            }
            break; // 最后段 torn 尾 → 截断
          }
        }
        pos = nl + 1;
      }
    }
    this.stats.rebuilds += 1;
    await this.writeIndexAtomic(sessionId, segFile, rows);
    this.logger.log(
      `[anchor] rebuilt segment index sid=${sessionId} seg=${segFile} rows=${rows.length} ` +
        `scanned=${((this.stats.rebuildScannedBytes - scannedBefore) / 1048576).toFixed(1)}MB`,
    );
    return rows;
  }

  private async writeIndexAtomic(sessionId: string, segFile: string, rows: AnchorRow[]): Promise<void> {
    const idxPath = this.getIndexPath(sessionId, segFile);
    const tmpPath = `${idxPath}.tmp`;
    await fs.writeFile(tmpPath, '#1\n' + this.serializeRows(rows), 'utf-8');
    await fs.rename(tmpPath, idxPath);
  }

  private serializeRows(rows: AnchorRow[]): string {
    if (rows.length === 0) return '';
    // CSV: kind,seq,off,turnId（固定格式，实验数据：46B/轮，解析最快）
    return rows.map((r) => `${r.kind},${r.seq},${r.off},${r.turnId ?? ''}\n`).join('');
  }

  private parseRows(raw: string): AnchorRow[] {
    const lines = raw.split('\n');
    const rows: AnchorRow[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length === 0) continue;
      if (i === 0 && (line.startsWith('{"v"') || line.startsWith('#'))) continue; // header
      try {
        const parts = line.split(',');
        if (parts.length < 3) continue;
        const [kind, seq, off, turnId] = parts;
        if (kind !== 's' && kind !== 'f' && kind !== 'd') continue;
        rows.push({
          kind,
          seq: Number(seq),
          off: Number(off),
          turnId: turnId || undefined,
        });
      } catch {
        // 单行坏 → 跳过（宽松：数量校验兜底）
        continue;
      }
    }
    return rows;
  }

  // ─── 路径工具（与 JsonlBackend 同构：sessions/<id>/ 平铺） ───

  private getSessionDir(sessionId: string): string {
    return path.join(this.basePath, sessionId);
  }

  private getSegmentPath(sessionId: string, file: string): string {
    return path.join(this.getSessionDir(sessionId), file);
  }

  private getIndexPath(sessionId: string, segFile: string): string {
    // seg-0000.jsonl → seg-0000.idx
    return path.join(this.getSessionDir(sessionId), segFile.replace(/\.jsonl$/, '.idx'));
  }

  private async readManifest(sessionId: string): Promise<Manifest> {
    const content = await fs.readFile(path.join(this.getSessionDir(sessionId), 'manifest.json'), 'utf-8');
    return JSON.parse(content) as Manifest;
  }
}
