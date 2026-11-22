/**
 * SessionReplayService.getEventPage 接入集成测试(块索引快路径 + 全量兜底路径)
 *
 * 页级三方对拍:块索引快路径(readChunksBackward 消费 + 配对凑页)、全量兜底路径
 * (getAllEvents + 同款配对)、理想参照(测试内独立组装实现)——三者逐字段一致。
 *
 * 覆盖:turns 矩阵/整条翻页链/turn/delete 透传(页含被删回合,新语义)/跨块回合/
 * 进行中回合留页尾/驱动判别(无 index 能力 → 全量)/篡改回退/损坏 fail-fast 透传。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import { JsonlBlockIndex } from '../../src/common/persistence/jsonl-block-index';
import { CorruptSessionLogError } from '../../src/common/persistence/errors';
import type { MessageEventLog, PendingEvent } from '../../src/common/persistence/event-log.port';
import type { BaseEvent } from '../../src/common/persistence/types';

let tmpDir: string;
let sessionsRoot: string;
let backend: JsonlBackend;
let replay: SessionReplayService; // 真实路径:backend.index(块索引)→ 快路径,失败回退全量
let replayFull: SessionReplayService; // 无 index 能力的 backend → 恒走全量兜底路径
let index: JsonlBlockIndex;

let turnIdSeq = 0;

function now(): number {
  return Date.UTC(2026, 0, 1);
}

async function appendTurn(sid: string, nMsgs = 3, contentLen = 40): Promise<string> {
  turnIdSeq += 1;
  const tid = `t${turnIdSeq}`;
  const evs: PendingEvent[] = [{ type: 'turn/start', time: now(), data: { turnId: tid } }];
  for (let i = 0; i < nMsgs; i += 1) {
    evs.push({
      type: 'assistant/message',
      time: now(),
      data: { messageId: `${tid}-m${i}`, content: 'x'.repeat(contentLen) },
    });
  }
  evs.push({ type: 'turn/finish', time: now(), data: { turnId: tid } });
  await backend.appendEvents(sid, evs);
  return tid;
}

/** 理想参照(测试内独立实现):全量事件 + 配对凑页 */
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
  // 反向配对计数
  const open = new Set<string>();
  const counted = new Set<string>();
  let valid = 0;
  let pageStartIdx = 0;
  outer: for (let i = endIdx; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === 'turn/finish') {
      const tid = (e.data as { turnId?: string }).turnId;
      if (tid) open.add(tid);
    } else if (e.type === 'turn/start') {
      const tid = (e.data as { turnId?: string }).turnId;
      if (tid && open.has(tid) && !counted.has(tid)) {
        counted.add(tid);
        valid += 1;
        if (valid === turns) {
          pageStartIdx = i;
          break outer;
        }
      }
    }
  }
  const enough = valid === turns;
  const start = enough ? pageStartIdx : 0;
  const pageEvents = events.slice(start, endIdx + 1);
  const hasMore = enough ? start > 0 : false;
  return {
    events: pageEvents,
    endSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq: start > 0 || hasMore ? pageEvents[0].seq - 1 : null,
    hasMore,
  };
}

/** 页级三方对拍:理想参照 vs 块索引快路径 vs 全量兜底路径 */
async function expectPageMatchesAll(
  sid: string,
  opts: { beforeSeq?: number; turns: number },
): Promise<{ nextBeforeSeq: number | null }> {
  const expected = assembleIdeal(await backend.getAllEvents(sid), opts);
  const viaIndex = await replay.getEventPage(sid, opts);
  const viaFull = await replayFull.getEventPage(sid, opts);
  expect(viaIndex).toEqual(expected);
  expect(viaFull).toEqual(expected);
  // 命中路径再跑一遍(索引已持久化)
  const hit = await replay.getEventPage(sid, opts);
  expect(hit).toEqual(expected);
  return { nextBeforeSeq: expected.nextBeforeSeq };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-index-'));
  process.env.SESSION_DATA_DIR = tmpDir;
  sessionsRoot = path.join(tmpDir, 'sessions');
  backend = new JsonlBackend();
  replay = new SessionReplayService(backend);
  replayFull = new SessionReplayService({
    getAllEvents: (sid: string) => backend.getAllEvents(sid),
  } as unknown as MessageEventLog); // 无 index 能力(模拟非 JSONL 驱动)
  index = new JsonlBlockIndex(sessionsRoot, 512);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe('getEventPage 接入(块索引快路径 + 全量兜底)', () => {
  it('turns 矩阵 + 整条翻页链:三方对拍一致(跨块构建 → 命中)', async () => {
    const sid = 's-matrix';
    await backend.createSession(sid);
    for (let i = 0; i < 12; i += 1) await appendTurn(sid, 3);

    for (const turns of [1, 2, 3, 5, 12, 13, 100, 0]) {
      await expectPageMatchesAll(sid, { turns });
    }
    // 整条翻页链(turns=2),每页三方对拍
    let cursor: number | undefined = undefined;
    let reachedStart = false;
    for (let page = 0; page < 100; page += 1) {
      const { nextBeforeSeq } = await expectPageMatchesAll(sid, { turns: 2, beforeSeq: cursor });
      if (nextBeforeSeq === null) {
        const last = await replay.getEventPage(sid, { turns: 2, beforeSeq: cursor });
        reachedStart = last.events.length > 0 && last.events[0].seq === 0;
        break;
      }
      cursor = nextBeforeSeq;
    }
    expect(reachedStart).toBe(true);
    const idx = await index.loadIndex(sid);
    expect(idx?.coveredToStart).toBe(true);
  });

  it('turn/delete 透传(新语义):被删回合计入轮次、事件原样下发', async () => {
    const sid = 's-delete';
    await backend.createSession(sid);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await appendTurn(sid, 3));
    await backend.appendEvents(sid, [
      { type: 'turn/delete', time: now(), data: { turnId: ids[3] } },
    ]);

    for (const turns of [1, 2, 3, 6, 7]) {
      await expectPageMatchesAll(sid, { turns });
    }
    // turns=2:页含被删回合(ids[3])的事件(配对计数不排除 delete)
    const page = await replay.getEventPage(sid, { turns: 2 });
    const ideal = assembleIdeal(await backend.getAllEvents(sid), { turns: 2 });
    expect(page).toEqual(ideal);
    const hasDeletedTurn = page.events.some(
      (e) => (e.data as { turnId?: string }).turnId === ids[3],
    );
    expect(hasDeletedTurn).toBe(true); // delete 透传:前端投影消解
    await expectPageMatchesAll(sid, { turns: 2, beforeSeq: ideal.nextBeforeSeq! });
  });

  it('跨块回合与钳制:大回合跨块配对,turns 钳制 [1,100]', async () => {
    const sid = 's-bigturn';
    await backend.createSession(sid);
    await appendTurn(sid, 3);
    await appendTurn(sid, 10, 120); // 大回合跨 chunkBytes=512 块
    await appendTurn(sid, 3);
    await appendTurn(sid, 3);

    for (const turns of [1, 2, 3, 4, 1000]) {
      await expectPageMatchesAll(sid, { turns });
    }
  });

  it('空会话/游标无匹配:两路径同形空页', async () => {
    const sid = 's-blank';
    await backend.createSession(sid);
    await expectPageMatchesAll(sid, { turns: 3 });
    await expectPageMatchesAll(sid, { beforeSeq: 99999, turns: 2 });
  });

  it('驱动判别:无 index 能力的 backend 恒走全量兜底,结果与快路径一致', async () => {
    const sid = 's-driver';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 3);

    // replayFull 的 backend 无 index → 无论索引是否存在恒走 getAllEvents
    const viaIndex = await replay.getEventPage(sid, { turns: 3 });
    const viaFull = await replayFull.getEventPage(sid, { turns: 3 });
    expect(viaIndex).toEqual(viaFull);
    const idx = await index.loadIndex(sid);
    expect(idx).not.toBeNull(); // 索引仍正常维护(快路径可用)
  });

  it('篡改回退:已建索引尾块被改 → 块流失配 → 兜底全量,结果仍正确', async () => {
    const sid = 's-tamper';
    await backend.createSession(sid);
    for (let i = 0; i < 6; i += 1) await appendTurn(sid, 3);
    await expectPageMatchesAll(sid, { turns: 2 }); // 建索引

    const segPath = path.join(sessionsRoot, sid, 'seg-0000.jsonl');
    const buf = fs.readFileSync(segPath);
    for (let i = buf.length - 1; i >= 0; i -= 1) {
      if (buf[i] === 0x78) {
        buf[i] = 0x79; // 'x' → 'y'(JSON 合法,仅指纹变化)
        break;
      }
    }
    fs.writeFileSync(segPath, buf);

    // 块流指纹失配(Stale)→ getEventPage 兜底 → 全量组装(权威读取)
    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 2 });
    const actual = await replay.getEventPage(sid, { turns: 2 });
    expect(actual).toEqual(expected);
    const hit = await replay.getEventPage(sid, { turns: 2 });
    expect(hit).toEqual(expected);
    const idx = await index.loadIndex(sid);
    expect(idx).not.toBeNull(); // 兜底路径走 getAllEvents,索引已由 Stale 作废、下次重建
  });

  it('损坏 fail-fast 透传:归档段坏行 → 左扩回退全量 → CorruptSessionLogError', async () => {
    const sid = 's-corrupt';
    await backend.createSession(sid);
    for (let i = 0; i < 3; i += 1) await appendTurn(sid, 3);
    await backend.splitSegment(sid);
    for (let i = 0; i < 2; i += 1) await appendTurn(sid, 3);
    await replay.getEventPage(sid, { turns: 2 }); // 建索引(尾部窗口)

    const archivedPath = path.join(sessionsRoot, sid, 'seg-0000.jsonl');
    const buf = fs.readFileSync(archivedPath);
    buf[0] = 0x21; // '{' → '!' → 归档段坏行
    fs.writeFileSync(archivedPath, buf);

    // 首页(种子窗口只读尾段)不感知未读区域损坏
    const page = await replay.getEventPage(sid, { turns: 2 });
    expect(page).toHaveProperty('events');
    // 翻页(左扩读归档段)→ 失效回退全量 → getAllEvents fail-fast → 透传 500 语义
    await expect(replay.getEventPage(sid, { turns: 2, beforeSeq: 5 })).rejects.toThrow(
      CorruptSessionLogError,
    );
    await expect(replayFull.getEventPage(sid, { turns: 2 })).rejects.toThrow(
      CorruptSessionLogError,
    );
  });
});
