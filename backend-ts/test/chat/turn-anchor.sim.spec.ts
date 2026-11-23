/**
 * Turn 锚点索引 —— 协议模拟(纯内存)
 *
 * 与真实层实验(test/chat/turn-anchor-index.spec.ts)互补:这里用内存事件序列 +
 * 内存索引行验证**协议算法本身**(不依赖 fs):start 计数(delete 排除、未闭合计入)、
 * beforeSeq→锚点映射、索引落后 K 轮的规整、不足 N 时的全量页语义。
 */

import { describe, it, expect } from '@jest/globals';

interface SimEvent {
  seq: number;
  type: 'start' | 'finish' | 'msg' | 'delete' | 'init';
  turnId?: string;
}

interface SimRow {
  seq: number;
  kind: 's' | 'f' | 'd';
  turnId?: string;
}

/** 从事件序列生成索引行（模拟写入时追加；off 省略——协议模拟不需要字节） */
function buildRows(events: SimEvent[]): SimRow[] {
  const rows: SimRow[] = [];
  for (const e of events) {
    if (e.type === 'start') rows.push({ seq: e.seq, kind: 's', turnId: e.turnId });
    else if (e.type === 'finish') rows.push({ seq: e.seq, kind: 'f', turnId: e.turnId });
    else if (e.type === 'delete') rows.push({ seq: e.seq, kind: 'd', turnId: e.turnId });
  }
  return rows;
}

interface SimPage {
  events: SimEvent[];
  firstSeq: number;
  lastSeq: number;
  nextBeforeSeq: number | null;
  hasMore: boolean;
}

/** 理想参照：start 计数 + delete 排除 + beforeSeq 含语义 */
function idealPage(events: SimEvent[], opts: { beforeSeq?: number; turns: number }): SimPage {
  const turns = Math.min(Math.max(1, opts.turns), 100);
  if (events.length === 0) {
    return { events: [], firstSeq: -1, lastSeq: -1, nextBeforeSeq: null, hasMore: false };
  }
  let endIdx = events.length - 1;
  if (opts.beforeSeq !== undefined) {
    endIdx = events.findIndex((e) => e.seq === opts.beforeSeq);
    if (endIdx === -1) {
      return { events: [], firstSeq: -1, lastSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
    }
  }
  const deleted = new Set(events.filter((e) => e.type === 'delete' && e.turnId).map((e) => e.turnId!));
  const validIdx: number[] = [];
  for (let i = endIdx; i >= 0; i -= 1) {
    if (events[i].type !== 'start') continue;
    const tid = events[i].turnId;
    if (tid && deleted.has(tid)) continue;
    validIdx.push(i);
  }
  const start = validIdx.length < turns ? 0 : validIdx[turns - 1];
  const pageEvents = events.slice(start, endIdx + 1);
  return {
    events: pageEvents,
    firstSeq: pageEvents[0]?.seq ?? -1,
    lastSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq: start > 0 ? pageEvents[0].seq - 1 : null,
    hasMore: start > 0,
  };
}

/**
 * 锚点读页（协议模拟）：
 * 1) 用索引定位"页尾前第 N 个有效 start"（排除 delete）作为锚点 seq
 * 2) 从锚点 seq 在事件序列中定位（实际数据的权威位置）读区间
 * 3) 区间内从尾数 N 个有效 start 规整（索引落后/多拿 → 裁到实际页首）
 */
function anchorPage(
  events: SimEvent[],
  rows: SimRow[],
  opts: { beforeSeq?: number; turns: number },
): SimPage {
  const turns = Math.min(Math.max(1, opts.turns), 100);
  const starts = rows.filter((r) => r.kind === 's');
  if (starts.length === 0) return idealPage(events, opts);
  const deleted = new Set(rows.filter((r) => r.kind === 'd' && r.turnId).map((r) => r.turnId!));
  const valid = starts.filter((r) => !(r.turnId && deleted.has(r.turnId)));

  // 页尾锚：索引中第一个 seq > beforeSeq 的 start
  let endIdx = events.length - 1;
  if (opts.beforeSeq !== undefined) {
    const next = starts.find((r) => (r.seq as number) > opts.beforeSeq!);
    if (!next) {
      return { events: [], firstSeq: -1, lastSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
    }
    endIdx = events.findIndex((e) => e.seq === next.seq) - 1;
    if (endIdx < 0) endIdx = -1;
  }

  // 页尾之前的有效 start（按 seq）；不足 N 个 → 页首=日志起点（全量页语义，含 init）
  const before = valid.filter((r) => r.seq <= (events[endIdx]?.seq ?? -1));
  if (before.length < turns) return idealPage(events, opts);
  const anchorSeq = before[before.length - turns].seq;

  // 从锚点 seq 读区间到页尾（实际数据权威）
  const startEventIdx = events.findIndex((e) => e.seq === anchorSeq);
  if (startEventIdx === -1 || endIdx < startEventIdx) return idealPage(events, opts); // 索引悬空 → 重建路径(模拟:落理想)
  const slice = events.slice(startEventIdx, endIdx + 1);

  // 规整：区间内从尾数 N 个有效 start
  const actualValid: number[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const e = slice[i];
    if (e.type !== 'start') continue;
    if (e.turnId && deleted.has(e.turnId)) continue;
    actualValid.push(i);
  }
  const actualStart = actualValid.length === 0 ? 0 : actualValid[Math.max(0, actualValid.length - turns)];
  const pageEvents = slice.slice(actualStart);
  const firstSeq = pageEvents[0]?.seq ?? -1;
  return {
    events: pageEvents,
    firstSeq,
    lastSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq: firstSeq > 0 ? firstSeq - 1 : null,
    hasMore: firstSeq > 0,
  };
}

// ─── 事件工厂 ───

function turn(events: SimEvent[], nMsgs: number): string {
  const tid = `t${events.length}`;
  events.push({ seq: events.length, type: 'start', turnId: tid });
  for (let i = 0; i < nMsgs; i += 1) events.push({ seq: events.length, type: 'msg' });
  events.push({ seq: events.length, type: 'finish', turnId: tid });
  return tid;
}

function initLog(): SimEvent[] {
  return [{ seq: 0, type: 'init' }];
}

function expectPage(events: SimEvent[], rows: SimRow[], opts: { beforeSeq?: number; turns: number }): void {
  const expected = idealPage(events, opts);
  const actual = anchorPage(events, rows, opts);
  expect(actual.events).toEqual(expected.events);
  expect(actual.nextBeforeSeq).toBe(expected.nextBeforeSeq);
  expect(actual.hasMore).toBe(expected.hasMore);
}

describe('Turn 锚点索引协议模拟', () => {
  it('多档 turns + 整条翻页链:锚点读页与理想参照一致', () => {
    const events = initLog();
    for (let i = 0; i < 10; i += 1) turn(events, 3);
    const rows = buildRows(events);

    for (const turns of [1, 2, 3, 5, 10, 11, 100]) {
      expectPage(events, rows, { turns });
    }
    let cursor: number | undefined = undefined;
    for (let p = 0; p < 100; p += 1) {
      const expected = idealPage(events, { turns: 2, beforeSeq: cursor });
      expectPage(events, rows, { turns: 2, beforeSeq: cursor });
      if (expected.nextBeforeSeq === null) break;
      cursor = expected.nextBeforeSeq;
    }
  });

  it('delete 排除:被删目标不计入凑数,页含被删轮事件(透传)', () => {
    const events = initLog();
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) ids.push(turn(events, 3));
    events.push({ seq: events.length, type: 'delete', turnId: ids[7] });
    events.push({ seq: events.length, type: 'delete', turnId: ids[6] });
    events.push({ seq: events.length, type: 'delete', turnId: ids[2] });
    const rows = buildRows(events);

    expectPage(events, rows, { turns: 5 });
    expectPage(events, rows, { turns: 1 });
    // 页内可见(未删)轮次 = turns
    const page = anchorPage(events, rows, { turns: 5 });
    const deleted = new Set([ids[7], ids[6], ids[2]]);
    const visible = page.events.filter((e) => e.type === 'start' && e.turnId && !deleted.has(e.turnId));
    expect(visible.length).toBe(5);
  });

  it('索引落后 K 轮:锚点偏旧 → 区间规整到实际页首(结果与理想一致)', () => {
    const events = initLog();
    for (let i = 0; i < 8; i += 1) turn(events, 3);
    let rows = buildRows(events);
    // 追加 3 轮但不更新索引(模拟写索引失败/崩溃窗口)
    for (let i = 0; i < 3; i += 1) turn(events, 3);

    expectPage(events, rows, { turns: 3 }); // 规整后正确
    expectPage(events, rows, { turns: 2 });

    // 追平(模拟)后仍一致
    rows = buildRows(events);
    expectPage(events, rows, { turns: 3 });
  });

  it('未闭合轮次计入:活跃回合(仅 start)参与凑数', () => {
    const events = initLog();
    for (let i = 0; i < 3; i += 1) turn(events, 2);
    events.push({ seq: events.length, type: 'start', turnId: 'active' });
    events.push({ seq: events.length, type: 'msg' });
    const rows = buildRows(events);

    const page = anchorPage(events, rows, { turns: 2 });
    expect(page.events.some((e) => e.type === 'start' && e.turnId === 'active')).toBe(true);
    expectPage(events, rows, { turns: 2 });
  });

  it('不足 N 轮:返回日志起点起的全部(全量页,无更多)', () => {
    const events = initLog();
    for (let i = 0; i < 2; i += 1) turn(events, 2);
    const rows = buildRows(events);
    const page = anchorPage(events, rows, { turns: 5 });
    expect(page.events[0].seq).toBe(0); // 含 init
    expect(page.nextBeforeSeq).toBeNull();
    expect(page.hasMore).toBe(false);
    expectPage(events, rows, { turns: 5 });
  });

  it('游标无匹配:空页(与全量语义一致)', () => {
    const events = initLog();
    for (let i = 0; i < 2; i += 1) turn(events, 2);
    const rows = buildRows(events);
    const page = anchorPage(events, rows, { beforeSeq: 99999, turns: 2 });
    expect(page.events).toEqual([]);
    expect(page.nextBeforeSeq).toBeNull();
    expectPage(events, rows, { beforeSeq: 99999, turns: 2 });
  });
});
