/**
 * 块流读侧协议 —— 实验算法模拟(纯内存,未接入业务流)
 *
 * 验证的完整流程(读侧分层):
 *
 *   前端  请求页(turns=30, beforeSeq?) → foldEvents 全量重建投影(非增量,现状即如此)
 *         投影消解 delete 后可见轮次不足 → 补拉(beforeSeq=最早可见轮 start-1)
 *         补拉页前插 eventLog → 再次全量重建投影 → 循环到可见轮次足够/翻完
 *   上层  消费底层倒序块流,块内反向扫,简单 turn 配对(start 遇到右侧已见 finish
 *         → 闭合轮次)凑够 N 轮 → 页首=该 start;delete 完全不管(原样下发);
 *         活跃回合(无 finish)不计轮次,事件自然留在页尾
 *   底层  倒序按块产出事件批,与轮次无关;索引只记 (seq范围 ↔ 字节范围)+指纹;
 *         补拉定位:seq 连续 ⇒ 块内偏移 = seq - startSeq(O(1)),直接读所在块;
 *         seq 在链首之前 → 向前扩块;seq 在链尾之后 → 右侧续扫
 *
 * 对拍主验收:分块组装页 == 理想全量组装页(同款配对语义),逐字段一致 ——
 * 分块读取不改变页语义。turn 语义简化为 start/finish/msg/delete 四类(物理边界
 * — torn 行/半截行/多分卷 — 已由 block-index.spec / jsonl-backend 覆盖)。
 *
 * 接入业务流时的分层重构方向(评审后执行):
 * - jsonl-block-index 拆出纯倒序流接口 readChunksBackward(去掉 countValidTurns/
 *   deleted 过滤 —— 轮次语义上移到页组装层)
 * - SessionReplayService.getEventPage 改为消费倒序流的配对组装
 * - 前端 loadMessages 增加投影后可见轮次不足的补拉循环(重建投影)
 */

import { describe, it, expect } from '@jest/globals';
// ─────────────────────────── 模拟事件与日志 ───────────────────────────

type SimEventType = 'start' | 'msg' | 'finish' | 'delete';

interface SimEvent {
  seq: number;
  type: SimEventType;
  turnId?: string; // delete 事件携带被删目标;其余携带所属回合
  bytes: number;   // 模拟 JSON 行字节长度
}

/** 内存日志:seq 连续追加,append 后已写内容不可变(append-only,与真实 JSONL 一致) */
class SimLog {
  readonly events: SimEvent[] = [];
  private nextSeq = 0;

  append(type: SimEventType, turnId: string | undefined, bytes: number): SimEvent {
    const e: SimEvent = { seq: this.nextSeq, type, turnId, bytes };
    this.nextSeq += 1;
    this.events.push(e);
    return e;
  }
}

// ─────────────────────── 模拟底层:倒序块流读取器 ───────────────────────

/** 索引块:seq 范围 + 内容指纹(篡改失效);真实层另有字节窗口与 hash */
interface SimChunk {
  startSeq: number;
  endSeq: number; // 含
  fingerprint: string;
}

interface SimChunkData {
  chunk: SimChunk;
  events: SimEvent[]; // 块内事件(seq 升序)
}

class SimIndexStaleError extends Error {}

interface SimReaderStats {
  bytesRead: number;
  chunkHits: number;
  windowScans: number;
}

/**
 * 倒序块流读取器:与轮次无关,只负责"事件的倒序流式读取"。
 * 索引随读随记(模拟中即实例状态,对应真实层的持久化 events.index.json);
 * 补拉经 locate 直接定位(seq → 所在块 + 块内偏移)。
 */
class SimBackwardReader {
  private chunksData: SimChunkData[] = []; // 按 startSeq 升序
  private rightExhausted = false;
  readonly stats: SimReaderStats = { bytesRead: 0, chunkHits: 0, windowScans: 0 };

  constructor(
    private readonly log: SimLog,
    private readonly chunkBytes: number,
  ) {}

  /** 篡改模拟:改写某 seq 事件的"内容字节" → 覆盖它的块指纹失配 */
  tamper(seq: number): void {
    this.log.events[seq].bytes += 1;
  }

  /** seq 定位(补拉核心):seq 连续 ⇒ 块内偏移 = seq - startSeq */
  locate(seq: number):
    | { kind: 'in-chain'; data: SimChunkData; offsetInChunk: number }
    | { kind: 'before-chain' | 'beyond-chain' | 'empty' } {
    if (this.chunksData.length === 0) return { kind: 'empty' };
    const head = this.chunksData[0].chunk;
    const tail = this.chunksData[this.chunksData.length - 1].chunk;
    if (seq < head.startSeq) return { kind: 'before-chain' };
    if (seq > tail.endSeq) return { kind: 'beyond-chain' };
    const data = this.chunksData.find((c) => c.chunk.startSeq <= seq && seq <= c.chunk.endSeq);
    if (!data) throw new Error(`链式衔接断裂:seq ${seq} 不在任何块内`);
    return { kind: 'in-chain', data, offsetInChunk: seq - data.chunk.startSeq };
  }

  /**
   * 倒序块流:从 fromSeq(缺省=日志末尾)所在的块开始,向左逐块产出事件批
   * (块内 seq 升序,批序从新到旧),直到日志起点。上层 for-await 不停读,
   * 何时停由消费方(配对凑够/流尽)决定。
   */
  async *chunksBackward(fromSeq?: number): AsyncGenerator<SimChunkData> {
    if (this.chunksData.length === 0) {
      const seed = this.seedChunkFromTail();
      if (!seed) return; // 空日志
      this.pushChunkRight(seed);
    }
    this.rightExhausted = false; // 每次调用重新探测:日志可能在两次调用之间追加
    // 右扩:覆盖请求右界(fromSeq 或日志末尾——活跃段追加场景)
    for (;;) {
      const tail = this.chunksData[this.chunksData.length - 1];
      if (fromSeq !== undefined && tail.chunk.endSeq >= fromSeq) break;
      if (fromSeq === undefined) {
        if (this.rightExhausted) break;
        if (tail.chunk.endSeq >= this.log.events.length - 1) break; // 已覆盖日志尾
      }
      if (!this.extendRightOnce(tail)) {
        this.rightExhausted = true;
        if (fromSeq !== undefined) break; // 右侧已尽仍未见游标 → 空页路径
      }
    }
    // 起始块:fromSeq 所在块(索引内定位);链首之前 → 从链首开始向左找
    let cur = this.chunksData.length - 1;
    if (fromSeq !== undefined) {
      const idx = this.chunksData.findIndex(
        (c) => c.chunk.startSeq <= fromSeq && fromSeq <= c.chunk.endSeq,
      );
      if (idx !== -1) cur = idx;
      else if (fromSeq < this.chunksData[0].chunk.startSeq) cur = 0;
    }
    yield this.readData(cur);
    // 向左逐块产出:先链内左邻块(索引已有),耗尽后再扩新块 —— 跳过链内块
    // 会让 acc 出现缺口(页内丢事件)
    for (;;) {
      if (cur > 0) {
        cur -= 1;
        yield this.readData(cur);
        continue;
      }
      if (this.chunksData[0].chunk.startSeq === 0) return; // 覆盖日志起点
      const more = this.extendLeftOnce(this.chunksData[0]);
      if (!more) return;
      this.pushChunkLeft(more);
      cur = 0; // 新块插到链头,已读游标随之归零
      yield this.readData(0);
    }
  }

  /** 尾部种子:取最后一个 chunkBytes 窗口作为链尾块(免全量,真实层同款) */
  private seedChunkFromTail(): SimChunkData | null {
    const total = this.log.events.length;
    if (total === 0) return null;
    return this.scanWindowBackward(total - 1);
  }

  /** 从 endSeq 向左取一个 chunkBytes 窗口(事件粒度;半截行处理已由真实层覆盖) */
  private scanWindowBackward(endSeq: number): SimChunkData | null {
    if (endSeq < 0) return null;
    const events: SimEvent[] = [];
    let bytes = 0;
    let s = endSeq;
    while (s >= 0) {
      const e = this.log.events[s];
      if (bytes + e.bytes > this.chunkBytes && events.length > 0) break;
      events.unshift(e);
      bytes += e.bytes;
      s -= 1;
    }
    if (events.length === 0) return null;
    this.stats.bytesRead += bytes;
    this.stats.windowScans += 1;
    return this.makeChunk(events);
  }

  /** 链尾向右续扫一个窗口(活跃段追加场景) */
  private extendRightOnce(tail: SimChunkData): boolean {
    const nextSeq = tail.chunk.endSeq + 1;
    if (nextSeq > this.log.events.length - 1) return false;
    const data = this.scanWindowForward(nextSeq);
    if (!data) return false;
    // 链式衔接校验
    if (data.chunk.startSeq !== tail.chunk.endSeq + 1) {
      throw new SimIndexStaleError('右续块与链尾 seq 不衔接');
    }
    this.chunksData.push(data);
    return true;
  }

  private scanWindowForward(startSeq: number): SimChunkData | null {
    if (startSeq > this.log.events.length - 1) return null;
    const events: SimEvent[] = [];
    let bytes = 0;
    let s = startSeq;
    while (s <= this.log.events.length - 1) {
      const e = this.log.events[s];
      if (bytes + e.bytes > this.chunkBytes && events.length > 0) break;
      events.push(e);
      bytes += e.bytes;
      s += 1;
    }
    if (events.length === 0) return null;
    this.stats.bytesRead += bytes;
    this.stats.windowScans += 1;
    return this.makeChunk(events);
  }

  /** 链首向左扩一个窗口 */
  private extendLeftOnce(head: SimChunkData): SimChunkData | null {
    const prevEnd = head.chunk.startSeq - 1;
    if (prevEnd < 0) return null;
    const data = this.scanWindowBackward(prevEnd);
    if (!data) return null;
    if (data.chunk.endSeq + 1 !== head.chunk.startSeq) {
      throw new SimIndexStaleError('左扩块与链首 seq 不衔接');
    }
    return data;
  }

  private makeChunk(events: SimEvent[]): SimChunkData {
    const fingerprint = `${events[0].seq}:${events[events.length - 1].seq}:${events
      .map((e) => e.bytes)
      .join(',')}`;
    return {
      chunk: { startSeq: events[0].seq, endSeq: events[events.length - 1].seq, fingerprint },
      events,
    };
  }

  private pushChunkRight(data: SimChunkData) {
    this.chunksData.push(data);
  }

  private pushChunkLeft(data: SimChunkData) {
    this.chunksData.unshift(data);
  }

  /**
   * 读块(模拟命中):真实层 = 读字节范围 + sha256 校验;模拟 = 指纹比对当前日志。
   * 篡改过的块 → 失效信号(消费方回退"理想全量")。
   */
  private readData(idx: number): SimChunkData {
    const data = this.chunksData[idx];
    const live = this.log.events.slice(data.chunk.startSeq, data.chunk.endSeq + 1);
    if (live.length !== data.chunk.endSeq - data.chunk.startSeq + 1) {
      throw new SimIndexStaleError('块行数失配');
    }
    const liveFp = `${live[0].seq}:${live[live.length - 1].seq}:${live.map((e) => e.bytes).join(',')}`;
    if (liveFp !== data.chunk.fingerprint) {
      throw new SimIndexStaleError(`块指纹失配 [${data.chunk.startSeq}..${data.chunk.endSeq}]`);
    }
    this.stats.chunkHits += 1;
    this.stats.bytesRead += live.reduce((s, e) => s + e.bytes, 0);
    return data;
  }
}

// ────────────── 模拟上层:配对凑页(delete 透传,与轮次无关的底层) ──────────────

export interface SimPage {
  events: SimEvent[];
  endSeq: number;
  nextBeforeSeq: number | null;
  hasMore: boolean;
}

/** 反向配对计数:start 遇到右侧已见 finish → 闭合轮次(去重);delete 不参与 */
function pairCountBackward(
  events: SimEvent[],
  fromIdx: number,
  turns: number,
): { enough: boolean; pageStartIdx: number } {
  const open = new Set<string>(); // 已见 finish、等待 start 的 turnId
  const counted = new Set<string>();
  let valid = 0;
  for (let i = fromIdx; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === 'finish') {
      if (e.turnId) open.add(e.turnId);
      continue;
    }
    if (e.type === 'start') {
      if (e.turnId && open.has(e.turnId) && !counted.has(e.turnId)) {
        counted.add(e.turnId);
        valid += 1;
        if (valid === turns) return { enough: true, pageStartIdx: i };
      }
    }
  }
  return { enough: false, pageStartIdx: 0 };
}

/** 收集倒序块流直到配对凑够 N 轮或覆盖日志起点;返回连续区间与页尾位置 */
async function collectChunks(
  reader: SimBackwardReader,
  opts: { beforeSeq?: number; turns: number },
): Promise<{ acc: SimEvent[]; endIdx: number; coveredToStart: boolean }> {
  const turns = Math.min(Math.max(1, opts.turns), 100);
  const acc: SimEvent[] = []; // 从右向左增长的连续事件区间(seq 升序)
  // 页尾 seq:beforeSeq(含)或(无游标时)日志末尾 —— 固定锚,头部增长不影响
  let endSeqVal: number | null = opts.beforeSeq ?? null;
  for await (const data of reader.chunksBackward(opts.beforeSeq)) {
    acc.unshift(...data.events);
    if (endSeqVal === null && acc.length > 0) endSeqVal = acc[acc.length - 1].seq;
    const endIdx = acc.findIndex((e) => e.seq === endSeqVal);
    if (endIdx >= 0) {
      const covered = acc[0].seq === 0;
      const { enough } = pairCountBackward(acc, endIdx, turns);
      if (enough || covered) return { acc, endIdx, coveredToStart: covered };
    }
  }
  // 流尽(已覆盖到日志起点;游标可能仍无匹配 → 空页)
  const endIdx = acc.findIndex((e) => e.seq === endSeqVal);
  return { acc, endIdx, coveredToStart: acc.length > 0 && acc[0].seq === 0 };
}

/** 页组装(上层):分块流 + 配对计数;delete 透传 */
async function assemblePage(
  reader: SimBackwardReader,
  opts: { beforeSeq?: number; turns: number },
): Promise<SimPage> {
  const turns = Math.min(Math.max(1, opts.turns), 100);
  const { acc, endIdx, coveredToStart } = await collectChunks(reader, opts);
  const empty: SimPage = {
    events: [],
    endSeq: opts.beforeSeq ?? -1,
    nextBeforeSeq: null,
    hasMore: false,
  };
  if (acc.length === 0 || endIdx < 0) return endIdx < 0 && opts.beforeSeq !== undefined ? empty : { ...empty, endSeq: -1 };
  const { enough, pageStartIdx } = pairCountBackward(acc, endIdx, turns);
  const start = enough ? pageStartIdx : 0;
  const pageEvents = acc.slice(start, endIdx + 1);
  const hasMore = enough ? start > 0 || !coveredToStart : false;
  const nextBeforeSeq = start > 0 || hasMore ? pageEvents[0].seq - 1 : null;
  return {
    events: pageEvents,
    endSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq,
    hasMore,
  };
}

/** 理想参照:全量事件数组上的同款组装(分块读取不应改变页语义) */
function assemblePageFromFullEvents(
  events: SimEvent[],
  opts: { beforeSeq?: number; turns: number },
): SimPage {
  const turns = Math.min(Math.max(1, opts.turns), 100);
  if (events.length === 0) return { events: [], endSeq: -1, nextBeforeSeq: null, hasMore: false };
  let endIdx = events.length - 1;
  if (opts.beforeSeq !== undefined) {
    endIdx = events.findIndex((e) => e.seq === opts.beforeSeq);
    if (endIdx === -1) return { events: [], endSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
  }
  const { enough, pageStartIdx } = pairCountBackward(events, endIdx, turns);
  const start = enough ? pageStartIdx : 0;
  const pageEvents = events.slice(start, endIdx + 1);
  const hasMore = enough ? start > 0 : false; // 全量数组恒 coveredToStart
  const nextBeforeSeq = start > 0 || hasMore ? pageEvents[0].seq - 1 : null;
  return {
    events: pageEvents,
    endSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq,
    hasMore,
  };
}

// ──────────────────── 模拟前端:投影 + 可见轮次补拉 ────────────────────

/** 全量重建投影:消解 delete(被删回合事件整体剔除),重建闭合轮次列表 */
class SimFrontend {
  eventLog: SimEvent[] = [];
  deleted = new Set<string>();

  /** 前插一页(与真实 loadMessages 的 eventLog 前插一致) */
  prependPage(page: SimPage): void {
    this.eventLog = [...page.events, ...this.eventLog];
    for (const e of page.events) {
      if (e.type === 'delete' && e.turnId) this.deleted.add(e.turnId);
    }
  }

  /** 全量重建投影(与真实 foldEvents 同构):消解 delete 后重建闭合轮次 */
  rebuild(): { closedTurns: string[]; oldestVisibleTurnStartSeq: number | null } {
    const visible = this.eventLog.filter(
      (e) => e.type === 'delete' || !e.turnId || !this.deleted.has(e.turnId),
    );
    const closed: string[] = []; // 正序(旧→新)
    const pending = new Set<string>(); // 已见 start、等待 finish 的回合
    for (const e of visible) {
      if (e.type === 'start') {
        if (e.turnId) pending.add(e.turnId);
      } else if (e.type === 'finish') {
        if (e.turnId && pending.has(e.turnId)) {
          closed.push(e.turnId);
          pending.delete(e.turnId);
        }
      }
    }
    const oldestTid = closed.length > 0 ? closed[0] : null;
    const oldest =
      oldestTid !== null
        ? visible.find((e) => e.type === 'start' && e.turnId === oldestTid)?.seq ?? null
        : null;
    return { closedTurns: closed, oldestVisibleTurnStartSeq: oldest };
  }
}

// ─────────────────────────── 测试 ───────────────────────────

/** 追加一个完整回合(可选模拟"进行中":直接 append start/msg 不加 finish) */
function turn(log: SimLog, nMsgs: number, msgBytes = 40): string {
  const tid = `t${log.events.length}`;
  log.append('start', tid, 90);
  for (let i = 0; i < nMsgs; i += 1) log.append('msg', tid, msgBytes);
  log.append('finish', tid, 90);
  return tid;
}

async function expectChunkedEqualsFull(
  log: SimLog,
  reader: SimBackwardReader,
  opts: { beforeSeq?: number; turns: number },
): Promise<SimPage> {
  const expected = assemblePageFromFullEvents(log.events, opts);
  const actual = await assemblePage(reader, opts);
  try {
    expect(actual).toEqual(expected);
  } catch (e) {
    console.error(
      `[debug] opts=${JSON.stringify(opts)} expected.head=${expected.events[0]?.seq}/${expected.events[0]?.turnId} ` +
        `actual.head=${actual.events[0]?.seq}/${actual.events[0]?.turnId} ` +
        `expected.len=${expected.events.length} actual.len=${actual.events.length} ` +
        `actualSeqs=${actual.events.map((x) => x.seq).join(',')}`,
    );
    throw e;
  }
  return actual;
}

describe('块流读侧协议模拟', () => {
  it('对拍:多档 turns + 整条翻页链,分块组装与理想全量逐字段一致', async () => {
    const log = new SimLog();
    for (let i = 0; i < 12; i += 1) turn(log, 3);
    const reader = new SimBackwardReader(log, 256); // 单回合 ~300B → 跨块

    for (const turns of [1, 2, 3, 5, 12, 13, 100, 0]) {
      await expectChunkedEqualsFull(log, reader, { turns });
    }
    // 翻页链:turns=2 从尾翻到头,每页对拍;收敛 = 末页覆盖日志起点(页首=首回合 start)
    let cursor: number | undefined = undefined;
    let reachedStart = false;
    for (let page = 0; page < 100; page += 1) {
      const p = await assemblePage(reader, { turns: 2, beforeSeq: cursor });
      const expected = assemblePageFromFullEvents(log.events, { turns: 2, beforeSeq: cursor });
      expect(p).toEqual(expected);
      if (p.nextBeforeSeq === null) {
        reachedStart = p.events.length > 0 && p.events[0].seq === 0;
        break;
      }
      cursor = p.nextBeforeSeq;
    }
    expect(reachedStart).toBe(true); // 翻到日志起点(首回合 start seq=0)
  });

  it('跨块回合:turn/start 与 finish 分属不同块仍正确配对', async () => {
    const log = new SimLog();
    turn(log, 3);
    const midTid = turn(log, 10, 60); // 大回合:事件跨多个 chunkBytes=128 的块
    turn(log, 3);
    const reader = new SimBackwardReader(log, 128);

    // turns=2:页首=大回合 start(seq5),其 finish(seq16)与 start 分属不同块
    const page = await assemblePage(reader, { turns: 2 });
    const expected = assemblePageFromFullEvents(log.events, { turns: 2 });
    expect(page).toEqual(expected);
    expect(page.events[0].type).toBe('start');
    expect((page.events[0] as { turnId: string }).turnId).toBe(midTid);
    // 跨块证据:大回合的 start 与 finish 都在页内
    const midStart = page.events.find((e) => e.turnId === midTid && e.type === 'start');
    const midFinish = page.events.find((e) => e.turnId === midTid && e.type === 'finish');
    expect(midStart).toBeDefined();
    expect(midFinish).toBeDefined();
  });

  it('进行中回合(无 finish)不计轮次,但事件保留在页尾', async () => {
    const log = new SimLog();
    for (let i = 0; i < 3; i += 1) turn(log, 2);
    log.append('start', 'active', 90); // 活跃回合:start+msg,无 finish
    log.append('msg', 'active', 40);
    const reader = new SimBackwardReader(log, 256);

    // turns=2:闭合轮次 = t2,t1(活跃不计)→ 页首=t1 start;活跃回合事件在页尾
    const page = await assemblePage(reader, { turns: 2 });
    const expected = assemblePageFromFullEvents(log.events, { turns: 2 });
    expect(page).toEqual(expected);
    expect((page.events[page.events.length - 1] as { turnId: string }).turnId).toBe('active');
    expect(page.events[0].type).toBe('start');
  });

  it('补拉定位:seq 连续 ⇒ 块内偏移 O(1),in-chain 命中不触发扩窗', async () => {
    const log = new SimLog();
    for (let i = 0; i < 10; i += 1) turn(log, 3);
    const reader = new SimBackwardReader(log, 256);
    const initialPage = await assemblePage(reader, { turns: 2 }); // 建立链(尾部种子+左扩到数够 2 轮)
    const headSeq = initialPage.events[0].seq; // 页首 seq 必在链内

    const scansBefore = reader.stats.windowScans;
    const loc = reader.locate(headSeq);
    expect(loc.kind).toBe('in-chain');
    if (loc.kind === 'in-chain') {
      expect(loc.offsetInChunk).toBe(headSeq - loc.data.chunk.startSeq); // O(1) 偏移
      expect(loc.data.events[loc.offsetInChunk].seq).toBe(headSeq);      // 偏移即下标
    }
    expect(reader.stats.windowScans).toBe(scansBefore); // 定位零扩窗

    // 页首之前 10 个 seq(很可能在链首之前)→ 补拉需向左扩
    const headLoc = reader.locate(Math.max(0, headSeq - 10));
    expect(['before-chain', 'in-chain']).toContain(headLoc.kind);
  });

  it('前端补拉循环:delete 消解后可见轮次不足 → 投影后补拉 → 全量重建 → 补齐', async () => {
    const log = new SimLog();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(turn(log, 3));
    // 删除最近 3 个回合(delete 追加在日志末尾)→ 首页(最近 5 轮)投影消解后仅剩 2 轮
    for (const tid of ids.slice(7)) log.append('delete', tid, 80);
    const reader = new SimBackwardReader(log, 256);
    const fe = new SimFrontend();
    const WANT = 5; // 前端期望可见 5 轮

    // ① 首页(配对凑 5 轮,含被删的也在内 → 投影消解后不足)
    let page = await assemblePage(reader, { turns: WANT });
    fe.prependPage(page);
    let proj = fe.rebuild();
    expect(proj.closedTurns.length).toBeLessThan(WANT); // 触发补拉的前提

    // ② 补拉循环:重建投影后仍不足 → beforeSeq = 最早可见轮 start-1,继续拉
    for (let round = 0; round < 10 && proj.closedTurns.length < WANT; round += 1) {
      const beforeSeq = proj.oldestVisibleTurnStartSeq! - 1;
      page = await assemblePage(reader, { turns: WANT, beforeSeq });
      fe.prependPage(page);
      proj = fe.rebuild();
    }

    // ③ 可见轮次补齐,且与"理想全量投影"的前 WANT 轮一致(被删回合已消解)
    expect(proj.closedTurns.length).toBeGreaterThanOrEqual(WANT);
    const ideal = new SimFrontend();
    ideal.eventLog = log.events;
    const idealProj = ideal.rebuild();
    expect(proj.closedTurns.slice(0, WANT)).toEqual(idealProj.closedTurns.slice(0, WANT));
    for (const tid of ids.slice(7)) {
      expect(proj.closedTurns.slice(0, WANT)).not.toContain(tid);
    }
    expect(proj.closedTurns.slice(0, WANT)).toContain(ids[0]); // 最早轮可见(补拉一路回溯到日志头)
  });

  it('追加场景:建链后日志追加 → 右侧续扫 + 新旧内容块内偏移定位仍准确', async () => {
    const log = new SimLog();
    for (let i = 0; i < 6; i += 1) turn(log, 3);
    const reader = new SimBackwardReader(log, 256);
    const before = await assemblePage(reader, { turns: 2 }); // 建链(种子,未覆盖起点)
    const scansBefore = reader.stats.windowScans;

    // 追加 2 回合(append-only:旧内容字节不变 → 已建块索引与 O(1) 偏移不受影响)
    turn(log, 3);
    turn(log, 3);
    const lastSeq = log.events[log.events.length - 1].seq;

    // 组装:右扩续扫覆盖新内容,页与理想全量一致
    const page = await expectChunkedEqualsFull(log, reader, { turns: 2 });
    expect(page.events[0].seq).toBeGreaterThanOrEqual(30); // 页首落在新增回合附近
    expect(reader.stats.windowScans).toBeGreaterThan(scansBefore); // 发生了续扫

    // 新内容块内偏移定位
    const loc = reader.locate(lastSeq);
    expect(loc.kind).toBe('in-chain');
    if (loc.kind === 'in-chain') {
      expect(loc.data.events[loc.offsetInChunk].seq).toBe(lastSeq);
    }
    // 追加前已索引的旧内容定位仍准确
    const oldLoc = reader.locate(before.events[0].seq);
    expect(oldLoc.kind).toBe('in-chain');
    if (oldLoc.kind === 'in-chain') {
      expect(oldLoc.data.events[oldLoc.offsetInChunk].seq).toBe(before.events[0].seq);
    }
  });

  it('索引失效:块内容篡改 → 指纹失配 → 组装抛失效信号(回退理想全量)', async () => {
    const log = new SimLog();
    for (let i = 0; i < 8; i += 1) turn(log, 3);
    const reader = new SimBackwardReader(log, 256);
    await assemblePage(reader, { turns: 2 }); // 建链

    // 篡改尾块内事件(命中路径必读);未读区域的篡改不感知(语义差异,翻页/补拉时暴露)
    reader.tamper(log.events[log.events.length - 2].seq);
    await expect(assemblePage(reader, { turns: 2 })).rejects.toThrow(SimIndexStaleError);
  });
});
