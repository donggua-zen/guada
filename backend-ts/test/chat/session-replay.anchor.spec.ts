/**
 * SessionReplayService.getEventPage —— 锚点索引接入集成测试
 *
 * 三方对拍：锚点快路径（backend.index.readPage）vs 全量兜底路径（无 index 能力的
 * fake backend → getAllEvents 组装）vs 理想参照（测试内 start 计数组装）。
 * 语义：按 turn/start 计轮次（未闭合计入）、turn/delete 目标排除。
 *
 * 覆盖：turns 矩阵/翻页链/delete 精准凑数/活跃回合/跨卷/驱动判别/损坏 fail-fast 透传。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import { CorruptSessionLogError } from '../../src/common/persistence/errors';
import type { MessageEventLog, PendingEvent } from '../../src/common/persistence/event-log.port';
import type { BaseEvent } from '../../src/common/persistence/types';

let tmpDir: string;
let sessionsRoot: string;
let backend: JsonlBackend;
let replay: SessionReplayService; // 快路径(锚点索引)
let replayFull: SessionReplayService; // 无 index 能力 → 全量兜底

let turnIdSeq = 0;

function now(): number {
  return Date.UTC(2026, 0, 1);
}

async function appendTurn(sid: string, nMsgs = 3): Promise<string> {
  turnIdSeq += 1;
  const tid = `s${turnIdSeq}`;
  const evs: PendingEvent[] = [{ type: 'turn/start', time: now(), data: { turnId: tid } }];
  for (let i = 0; i < nMsgs; i += 1) {
    evs.push({ type: 'assistant/message', time: now(), data: { messageId: `${tid}-m${i}`, content: 'x'.repeat(40) } });
  }
  evs.push({ type: 'turn/finish', time: now(), data: { turnId: tid } });
  await backend.appendEvents(sid, evs);
  return tid;
}

/** 理想参照：start 计数 + delete 排除 */
function assembleIdeal(
  events: BaseEvent[],
  opts: { beforeSeq?: number; turns: number },
): { events: BaseEvent[]; endSeq: number; nextBeforeSeq: number | null; hasMore: boolean } {
  const turns = Math.min(Math.max(1, opts.turns), 100);
  if (events.length === 0) return { events: [], endSeq: -1, nextBeforeSeq: null, hasMore: false };
  let endIdx = events.length - 1;
  if (opts.beforeSeq !== undefined) {
    endIdx = events.findIndex((e) => e.seq === opts.beforeSeq);
    if (endIdx === -1) return { events: [], endSeq: opts.beforeSeq, nextBeforeSeq: null, hasMore: false };
  }
  const deleted = new Set<string>();
  for (const e of events) {
    if (e.type === 'turn/delete') {
      const tid = (e.data as { turnId?: string }).turnId;
      if (tid) deleted.add(tid);
    }
  }
  const validIdx: number[] = [];
  for (let i = endIdx; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'turn/start') continue;
    const tid = (e.data as { turnId?: string }).turnId;
    if (tid && deleted.has(tid)) continue;
    validIdx.push(i);
  }
  const start = validIdx.length < turns ? 0 : validIdx[turns - 1];
  const pageEvents = events.slice(start, endIdx + 1);
  const hasMore = start > 0;
  return {
    events: pageEvents,
    endSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq: start > 0 ? pageEvents[0].seq - 1 : null,
    hasMore,
  };
}

async function expectMatchesAll(
  sid: string,
  opts: { beforeSeq?: number; turns: number },
): Promise<{ nextBeforeSeq: number | null }> {
  const expected = assembleIdeal(await backend.getAllEvents(sid), opts);
  const viaIndex = await replay.getEventPage(sid, opts);
  const viaFull = await replayFull.getEventPage(sid, opts);
  expect(viaIndex).toEqual(expected);
  expect(viaFull).toEqual(expected);
  return { nextBeforeSeq: expected.nextBeforeSeq };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-anchor-'));
  process.env.SESSION_DATA_DIR = tmpDir;
  sessionsRoot = path.join(tmpDir, 'sessions');
  backend = new JsonlBackend();
  replay = new SessionReplayService(backend);
  replayFull = new SessionReplayService({
    getAllEvents: (sid: string) => backend.getAllEvents(sid),
  } as unknown as MessageEventLog);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe('getEventPage 锚点索引接入', () => {
  it('turns 矩阵 + 整条翻页链：三方逐字段一致', async () => {
    const sid = 'i-matrix';
    await backend.createSession(sid);
    for (let i = 0; i < 12; i += 1) await appendTurn(sid, 3);

    for (const turns of [1, 2, 3, 5, 12, 13, 100, 0]) {
      await expectMatchesAll(sid, { turns });
    }
    let cursor: number | undefined = undefined;
    for (let page = 0; page < 100; page += 1) {
      const { nextBeforeSeq } = await expectMatchesAll(sid, { turns: 2, beforeSeq: cursor });
      if (nextBeforeSeq === null) break;
      cursor = nextBeforeSeq;
    }
    expect(cursor).not.toBeUndefined();
  });

  it('delete 精准凑数：页内可见轮次=N，快路径与全量一致', async () => {
    const sid = 'i-delete';
    await backend.createSession(sid);
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) ids.push(await appendTurn(sid, 3));
    await backend.appendEvents(sid, [
      { type: 'turn/delete', time: now(), data: { turnId: ids[7] } },
      { type: 'turn/delete', time: now(), data: { turnId: ids[6] } },
      { type: 'turn/delete', time: now(), data: { turnId: ids[2] } },
    ]);

    for (const turns of [1, 3, 5, 8]) {
      await expectMatchesAll(sid, { turns });
    }
    const page = await replay.getEventPage(sid, { turns: 5 });
    const deletedSet = new Set([ids[7], ids[6], ids[2]]);
    const visible = page.events.filter(
      (e) => e.type === 'turn/start' && !deletedSet.has((e.data as { turnId: string }).turnId),
    );
    expect(visible.length).toBe(5);
  });

  it('活跃回合（无 finish）计入轮次：页含进行中回合', async () => {
    const sid = 'i-active';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 3);
    await backend.appendEvents(sid, [
      { type: 'turn/start', time: now(), data: { turnId: 'active' } },
      { type: 'assistant/message', time: now(), data: { messageId: 'active-m0', content: 'yy' } },
    ]);

    await expectMatchesAll(sid, { turns: 2 });
    const page = await replay.getEventPage(sid, { turns: 2 });
    expect(
      page.events.some(
        (e) => e.type === 'turn/start' && (e.data as { turnId?: string }).turnId === 'active',
      ),
    ).toBe(true);
  });

  it('多分卷（3 段）：跨卷读页与翻页链三方一致', async () => {
    const sid = 'i-multi';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 4);

    for (const turns of [2, 5, 8]) {
      await expectMatchesAll(sid, { turns });
    }
    let cursor: number | undefined = undefined;
    for (let page = 0; page < 100; page += 1) {
      const { nextBeforeSeq } = await expectMatchesAll(sid, { turns: 3, beforeSeq: cursor });
      if (nextBeforeSeq === null) break;
      cursor = nextBeforeSeq;
    }
  });

  it('驱动判别：无 index 能力的 backend 恒走全量，结果与快路径一致', async () => {
    const sid = 'i-driver';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 3);

    const viaIndex = await replay.getEventPage(sid, { turns: 3 });
    const viaFull = await replayFull.getEventPage(sid, { turns: 3 });
    expect(viaIndex).toEqual(viaFull);
    expect(fs.existsSync(path.join(sessionsRoot, sid, 'seg-0000.idx'))).toBe(true);
  });

  it('损坏 fail-fast 透传：归档段坏行 → 快路径回退全量 → CorruptSessionLogError', async () => {
    const sid = 'i-corrupt';
    await backend.createSession(sid);
    for (let i = 0; i < 3; i += 1) await appendTurn(sid, 3);
    await backend.splitSegment(sid);
    for (let i = 0; i < 2; i += 1) await appendTurn(sid, 3);

    // 破坏归档段首行
    const archivedPath = path.join(sessionsRoot, sid, 'seg-0000.jsonl');
    const buf = fs.readFileSync(archivedPath);
    buf[0] = 0x21; // '{' → '!'
    fs.writeFileSync(archivedPath, buf);
    // 归档段索引也失效（读时会重建，重建扫描到坏行 → 该卷无有效锚点）
    fs.rmSync(path.join(sessionsRoot, sid, 'seg-0000.idx'), { force: true });

    // 归档段坏行 = 已提交区损坏：快路径加载该卷索引时即失效 → 回退全量 →
    // fail-fast（与原始 getAllEvents 权威语义一致；块索引"首页不感知"的顺带行为不再存在）
    await expect(replay.getEventPage(sid, { turns: 2 })).rejects.toThrow(
      CorruptSessionLogError,
    );
    await expect(replayFull.getEventPage(sid, { turns: 2 })).rejects.toThrow(
      CorruptSessionLogError,
    );
  });

  it('索引文件损坏（垃圾字节）：快路径重建该卷后与全量一致', async () => {
    const sid = 'i-badidx';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 3);
    fs.writeFileSync(path.join(sessionsRoot, sid, 'seg-0000.idx'), '\u0000garbage\u0000');

    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 2 });
    const page = await replay.getEventPage(sid, { turns: 2 });
    expect(page).toEqual(expected);
    // 重建后的索引 header 正常
    expect(fs.readFileSync(path.join(sessionsRoot, sid, 'seg-0000.idx'), 'utf-8').startsWith('#1')).toBe(true);
  });
});
