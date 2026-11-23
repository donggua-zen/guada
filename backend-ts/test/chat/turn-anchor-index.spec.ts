/**
 * Turn 锚点索引 —— 实验验收(真实 fs,未接业务)
 *
 * 语义(用户定稿):按 turn/start 计轮次(未闭合轮次也计入),turn/delete 目标排除。
 * 对拍对象 = 测试内"理想参照"(全量事件上的同语义组装);另对照现有 SessionReplayService
 * (配对语义 + delete 透传计数)记录已知差异,不参与对拍。
 *
 * 覆盖:稳态对拍(多档 turns/翻页链)、delete 精准凑数(无需补拉)、活跃回合计入、
 * 跨卷翻页、竞态(索引落后规整+追平/offset 篡改/事件截断/坏索引)、单卷重建、
 * torn 尾。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import { TurnAnchorIndex } from '../../src/common/persistence/turn-anchor-index';
import type { BaseEvent } from '../../src/common/persistence/types';
import type { PendingEvent } from '../../src/common/persistence/event-log.port';

let tmpDir: string;
let sessionsRoot: string;
let backend: JsonlBackend;
let replay: SessionReplayService; // 现有实现(配对语义,仅对照)
let anchor: TurnAnchorIndex;

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

/** 理想参照(测试内独立实现):start 计数 + delete 排除 + beforeSeq=页首-1 语义 */
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
  // 全会话 delete 集合
  const deleted = new Set<string>();
  for (const e of events) {
    if (e.type === 'turn/delete') {
      const tid = (e.data as { turnId?: string }).turnId;
      if (tid) deleted.add(tid);
    }
  }
  // 反向数 start(排除 delete 目标;未闭合也计入)
  const validIdx: number[] = [];
  for (let i = endIdx; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'turn/start') continue;
    const tid = (e.data as { turnId?: string }).turnId;
    if (tid && deleted.has(tid)) continue;
    validIdx.push(i);
  }
  // 不足 N 个有效轮次 → 页首=日志起点（全量页，含 session/init 等前导事件）
  const start = validIdx.length < turns ? 0 : validIdx[turns - 1];
  const pageEvents = events.slice(start, endIdx + 1);
  const firstSeq = pageEvents[0]?.seq ?? -1;
  const hasMore = start > 0;
  return {
    events: pageEvents,
    endSeq: pageEvents[pageEvents.length - 1]?.seq ?? opts.beforeSeq ?? -1,
    nextBeforeSeq: start > 0 ? firstSeq - 1 : null,
    hasMore,
  };
}

/** 新语义对拍:锚点索引 vs 理想参照(命中路径再跑一次) */
async function expectMatchesAnchor(
  sid: string,
  opts: { beforeSeq?: number; turns: number },
): Promise<{ nextBeforeSeq: number | null }> {
  const expected = assembleIdeal(await backend.getAllEvents(sid), opts);
  const actual = await anchor.readPage(sid, opts);
  expect(actual).toEqual(expected);
  const again = await anchor.readPage(sid, opts); // 命中(索引已就位)
  expect(again).toEqual(expected);
  return { nextBeforeSeq: expected.nextBeforeSeq };
}

/** 整条翻页链:新语义对拍,游标取理想参照(权威) */
async function expectPagedChainMatches(sid: string, turns: number): Promise<void> {
  let cursor: number | undefined = undefined;
  for (let page = 0; page < 200; page += 1) {
    const { nextBeforeSeq } = await expectMatchesAnchor(sid, { turns, beforeSeq: cursor });
    if (nextBeforeSeq === null) return;
    cursor = nextBeforeSeq;
  }
  throw new Error(`翻页链未收敛(sid=${sid}, turns=${turns})`);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-anchor-'));
  process.env.SESSION_DATA_DIR = tmpDir;
  sessionsRoot = path.join(tmpDir, 'sessions');
  backend = new JsonlBackend();
  replay = new SessionReplayService(backend);
  anchor = new TurnAnchorIndex(sessionsRoot);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe('TurnAnchorIndex 读页(对拍理想参照)', () => {
  it('稳态多档 turns + 整条翻页链:与理想参照逐字段一致', async () => {
    const sid = 'a-matrix';
    await backend.createSession(sid);
    for (let i = 0; i < 12; i += 1) await appendTurn(sid, 3);

    for (const turns of [1, 2, 3, 5, 12, 13, 100, 0]) {
      await expectMatchesAnchor(sid, { turns });
    }
    await expectPagedChainMatches(sid, 2);
    await expectPagedChainMatches(sid, 5);

    // 索引卷已建立且行数 = 12 start + 12 finish(冗余)
    const idxPath = path.join(sessionsRoot, sid, 'seg-0000.idx');
    expect(fs.existsSync(idxPath)).toBe(true);
    const rows = fs.readFileSync(idxPath, 'utf-8').trim().split('\n').filter((l) => !l.startsWith('#'));
    expect(rows.length).toBe(24);
  });

  it('delete 精准凑数:排除被删目标后仍返回 N 个可见轮次(无需前端补拉)', async () => {
    const sid = 'a-delete';
    await backend.createSession(sid);
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) ids.push(await appendTurn(sid, 3));
    // 删最近 2 个 + 中间 1 个(delete 追加在末尾,可指向任意历史位置)
    await backend.appendEvents(sid, [
      { type: 'turn/delete', time: now(), data: { turnId: ids[7] } },
      { type: 'turn/delete', time: now(), data: { turnId: ids[6] } },
      { type: 'turn/delete', time: now(), data: { turnId: ids[2] } },
    ]);

    // turns=5:锚点向前扩到第 5 个**未删** start → 页内含被删轮事件(透传),可见轮次=5
    const opts = { turns: 5 };
    const expected = assembleIdeal(await backend.getAllEvents(sid), opts);
    const page = await anchor.readPage(sid, opts);
    expect(page).toEqual(expected);
    // 页首比"仅数最近 5 个 start"更早(多含被删轮):与现有实现(delete 不参与计数)对比
    const legacy = await replay.getEventPage(sid, opts);
    expect(page.events[0].seq).toBeLessThanOrEqual(legacy.events[0].seq);
    // 页内可见(未删)轮次 = 5
    const deletedSet = new Set([ids[7], ids[6], ids[2]]);
    const visible = page.events.filter(
      (e) => e.type === 'turn/start' && !deletedSet.has((e.data as { turnId: string }).turnId),
    );
    expect(visible.length).toBe(5);
    // 翻页链(含 delete)对拍
    await expectPagedChainMatches(sid, 3);
  });

  it('活跃回合(无 finish)计入轮次:页含进行中回合', async () => {
    const sid = 'a-active';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 3);
    // 活跃回合:start + msg,无 finish
    await backend.appendEvents(sid, [
      { type: 'turn/start', time: now(), data: { turnId: 'active' } },
      { type: 'assistant/message', time: now(), data: { messageId: 'active-m0', content: 'yy' } },
    ]);

    const opts = { turns: 2 };
    const expected = assembleIdeal(await backend.getAllEvents(sid), opts);
    const page = await anchor.readPage(sid, opts);
    expect(page).toEqual(expected);
    // 页内应包含活跃回合的 turn/start（未闭合轮次计入）
    const activeStart = page.events.find(
      (e) => e.type === 'turn/start' && (e.data as { turnId?: string }).turnId === 'active',
    );
    expect(activeStart).toBeDefined();

    // 已接入的 getEventPage 与锚点索引同语义(同一实现路径)→ 页一致
    const viaService = await replay.getEventPage(sid, opts);
    expect(viaService).toEqual(page);
  });

  it('空会话/游标无匹配:与全量语义一致', async () => {
    const sid = 'a-blank';
    await backend.createSession(sid); // 仅 session/init
    await expectMatchesAnchor(sid, { turns: 3 });
    await expectMatchesAnchor(sid, { beforeSeq: 99999, turns: 2 });
  });

  it('多分卷(3 段):跨卷读页与跨卷翻页链对拍', async () => {
    const sid = 'a-multi';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 4);

    for (const turns of [2, 5, 8]) {
      await expectMatchesAnchor(sid, { turns });
    }
    await expectPagedChainMatches(sid, 3);
    // 三个索引卷都建立
    for (const f of ['seg-0000.idx', 'seg-0001.idx', 'seg-0002.idx']) {
      expect(fs.existsSync(path.join(sessionsRoot, sid, f))).toBe(true);
    }
  });

});

describe('TurnAnchorIndex 竞态与失效重建', () => {
  it('索引落后(索引文件未跟上写入):规整返回正确页,读端纯只读(不补写/不重建)', async () => {
    const sid = 'a-lag';
    await backend.createSession(sid);
    for (let i = 0; i < 6; i += 1) await appendTurn(sid, 3);
    await anchor.ensureAllIndexes(sid); // 索引到位
    const idxPath = path.join(sessionsRoot, sid, 'seg-0000.idx');
    const snapshot = fs.readFileSync(idxPath, 'utf-8'); // 旧索引快照

    // 追加 2 回合(接入后写入方会自动维护索引)——为模拟"写索引失败"的落后窗口,
    // 把索引文件回滚到追加前的快照
    for (let i = 0; i < 2; i += 1) await appendTurn(sid, 3);
    fs.writeFileSync(idxPath, snapshot);
    const statBefore = fs.statSync(idxPath);

    anchor.stats.laggedStarts = 0;
    anchor.stats.rebuilds = 0;
    anchor.stats.bytesReadEvents = 0;
    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 3 });
    const lagging = await anchor.readPage(sid, { turns: 3 });
    expect(lagging).toEqual(expected); // 规整正确(多读后裁到实际页首)
    expect(anchor.stats.laggedStarts).toBeGreaterThan(0); // 只读诊断可见落后
    expect(anchor.stats.rebuilds).toBe(0); // 未触发重建

    // 读端纯只读:索引文件大小与 mtime 均未变化(不补写)
    const statAfter = fs.statSync(idxPath);
    expect(statAfter.size).toBe(statBefore.size);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

    // 二次读:结果一致(落后状态持续,直到写入方补齐)
    anchor.stats.bytesReadEvents = 0;
    const hit = await anchor.readPage(sid, { turns: 3 });
    expect(hit).toEqual(expected);
  });

  it('offset 篡改 → 锚点行首 seq 校验失败 → 重建该卷后正确', async () => {
    const sid = 'a-offset';
    await backend.createSession(sid);
    for (let i = 0; i < 6; i += 1) await appendTurn(sid, 3);
    await anchor.ensureAllIndexes(sid);

    // 篡改页首锚点行(倒数第 3 个 start 行)的 off:只有锚点 off 参与定位校验,
    // 中间行 off 不参与（设计优势）——所以必须改锚点行才能触发失配
    const idxPath = path.join(sessionsRoot, sid, 'seg-0000.idx');
    const lines = fs.readFileSync(idxPath, 'utf-8').split('\n');
    const startLineIdxs = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.startsWith('s,'))
      .map(({ i }) => i);
    const target = startLineIdxs[startLineIdxs.length - 3];
    const parts = lines[target].split(',');
    parts[2] = String(Number(parts[2]) + 7);
    lines[target] = parts.join(',');
    fs.writeFileSync(idxPath, lines.join('\n'));

    anchor.stats.rebuilds = 0;
    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 3 });
    const page = await anchor.readPage(sid, { turns: 3 });
    expect(page).toEqual(expected);
    expect(anchor.stats.rebuilds).toBeGreaterThan(0); // 已重建
  });

  it('事件截断截掉整轮 → 锚点悬空 → 重建后返回截断后正确页', async () => {
    const sid = 'a-truncate';
    await backend.createSession(sid);
    for (let i = 0; i < 6; i += 1) await appendTurn(sid, 3);
    await anchor.ensureAllIndexes(sid);

    // 物理截断事件卷尾部 6 个换行 = 整轮 5 行 + 前一行末换行
    // (t6 的 start 也被截掉):索引仍含该轮 start → 锚点指向不存在字节
    const segPath = path.join(sessionsRoot, sid, 'seg-0000.jsonl');
    const buf = fs.readFileSync(segPath);
    let cut = buf.length;
    for (let n = 0; n < 6; n += 1) cut = buf.lastIndexOf(0x0a, cut - 1);
    fs.truncateSync(segPath, cut + 1);

    anchor.stats.rebuilds = 0;
    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 1 });
    const page = await anchor.readPage(sid, { turns: 1 });
    expect(page).toEqual(expected);
    expect(anchor.stats.rebuilds).toBeGreaterThan(0);
  });

  it('坏索引(垃圾字节)→ 重建后正确', async () => {
    const sid = 'a-bad';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 3);
    fs.writeFileSync(path.join(sessionsRoot, sid, 'seg-0000.idx'), '\u0000garbage\u0000');

    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 2 });
    const page = await anchor.readPage(sid, { turns: 2 });
    expect(page).toEqual(expected);
  });

  it('单卷索引缺失 → 只重建该卷(扫描字节 ≤ 该卷大小)', async () => {
    const sid = 'a-single-rebuild';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 4);
    await anchor.ensureAllIndexes(sid);

    const seg1 = path.join(sessionsRoot, sid, 'seg-0001.jsonl');
    const seg1Size = fs.statSync(seg1).size;
    fs.rmSync(path.join(sessionsRoot, sid, 'seg-0001.idx')); // 删中间/尾部卷索引

    anchor.stats.rebuilds = 0;
    anchor.stats.rebuildScannedBytes = 0;
    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 3 });
    const page = await anchor.readPage(sid, { turns: 3 });
    expect(page).toEqual(expected);
    expect(anchor.stats.rebuilds).toBe(1); // 只重建缺失卷
    expect(anchor.stats.rebuildScannedBytes).toBeLessThanOrEqual(seg1Size);
  });

  it('torn 尾:半行 JSON → 重建索引截断处理,读页不含 torn', async () => {
    const sid = 'a-torn';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 3);
    const segPath = path.join(sessionsRoot, sid, 'seg-0000.jsonl');
    fs.appendFileSync(segPath, '{"type":"assistant/mess');
    fs.rmSync(path.join(sessionsRoot, sid, 'seg-0000.idx'), { force: true }); // 强制重建路径

    const expected = assembleIdeal(await backend.getAllEvents(sid), { turns: 2 });
    const page = await anchor.readPage(sid, { turns: 2 });
    expect(page).toEqual(expected);
  });
});
