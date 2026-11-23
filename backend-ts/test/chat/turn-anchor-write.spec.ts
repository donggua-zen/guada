/**
 * Turn 锚点索引 —— 写路径接入测试（JsonlBackend 唯一写者维护索引）
 *
 * 覆盖：appendEvents 后索引卷自动更新（行内容/偏移/seq 升序）；无锚点批确保卷存在；
 * 索引写失败 → 作废该卷（读时重建兜底）；truncate 后索引卷被删；分卷新卷索引创建；
 * 端到端：SessionReplayService 读页（索引由写维护，无需预先构建）。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import { TurnAnchorIndex } from '../../src/common/persistence/turn-anchor-index';
import type { PendingEvent } from '../../src/common/persistence/event-log.port';

let tmpDir: string;
let sessionsRoot: string;
let backend: JsonlBackend;
let replay: SessionReplayService;

let turnIdSeq = 0;

function now(): number {
  return Date.UTC(2026, 0, 1);
}

async function appendTurn(sid: string, nMsgs = 3): Promise<string> {
  turnIdSeq += 1;
  const tid = `w${turnIdSeq}`;
  const evs: PendingEvent[] = [{ type: 'turn/start', time: now(), data: { turnId: tid } }];
  for (let i = 0; i < nMsgs; i += 1) {
    evs.push({ type: 'assistant/message', time: now(), data: { messageId: `${tid}-m${i}`, content: 'x'.repeat(20) } });
  }
  evs.push({ type: 'turn/finish', time: now(), data: { turnId: tid } });
  await backend.appendEvents(sid, evs);
  return tid;
}

function idxPathOf(sid: string, seg = 'seg-0000'): string {
  return path.join(sessionsRoot, sid, `${seg}.idx`);
}

/** 解析 CSV 索引（测试用） */
function readRows(idxPath: string): Array<{ kind: string; seq: number; off: number; turnId: string }> {
  const raw = fs.readFileSync(idxPath, 'utf-8');
  expect(raw.startsWith('#1')).toBe(true);
  return raw
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const [kind, seq, off, turnId] = l.split(',');
      return { kind, seq: Number(seq), off: Number(off), turnId };
    });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-anchor-write-'));
  process.env.SESSION_DATA_DIR = tmpDir;
  sessionsRoot = path.join(tmpDir, 'sessions');
  backend = new JsonlBackend();
  replay = new SessionReplayService(backend);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe('写入路径维护锚点索引', () => {
  it('appendEvents 后索引卷自动更新：start/finish/delete 行、偏移精确、seq 升序', async () => {
    const sid = 'w-basic';
    await backend.createSession(sid);
    const t1 = await appendTurn(sid, 3);
    const t2 = await appendTurn(sid, 2);
    await backend.appendEvents(sid, [{ type: 'turn/delete', time: now(), data: { turnId: t1 } }]);

    const rows = readRows(idxPathOf(sid));
    // 2 轮 × (start+finish) + 1 delete = 5 行
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.kind).join('')).toBe('sfsfd');
    // seq 升序
    const seqs = rows.map((r) => r.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // 偏移精确：用索引行 off 回读事件文件，逐行 seq 必须一致
    const segBuf = fs.readFileSync(path.join(sessionsRoot, sid, 'seg-0000.jsonl'));
    for (const r of rows) {
      const nl = segBuf.indexOf(0x0a, r.off);
      const ev = JSON.parse(segBuf.subarray(r.off, nl).toString('utf-8')) as { seq: number; type: string };
      expect(ev.seq).toBe(r.seq);
      if (r.kind === 's') expect(ev.type).toBe('turn/start');
      if (r.kind === 'f') expect(ev.type).toBe('turn/finish');
      if (r.kind === 'd') expect(ev.type).toBe('turn/delete');
    }
    // delete 行带目标 turnId
    expect(rows[rows.length - 1].turnId).toBe(t1);
    expect(rows[0].turnId).toBe(t1);
    expect(rows[2].turnId).toBe(t2);
  });

  it('无锚点事件的批次也确保索引卷存在（分卷 rotate 批）', async () => {
    const sid = 'w-rotate';
    await backend.createSession(sid);
    await appendTurn(sid, 2);
    await backend.splitSegment(sid); // 新段首行 = session/rotate（非锚点）

    // 新段索引卷存在且仅有 header（rotate 不产生锚点行）
    const newIdx = idxPathOf(sid, 'seg-0001');
    expect(fs.existsSync(newIdx)).toBe(true);
    expect(readRows(newIdx).length).toBe(0);
    // 继续写 → 新卷索引开始累积
    await appendTurn(sid, 2);
    expect(readRows(newIdx).length).toBe(2); // start+finish
  });

  it('索引写失败 → 作废该卷索引，读时缺失重建兜底', async () => {
    const sid = 'w-fail';
    await backend.createSession(sid);
    await appendTurn(sid, 2);
    await appendTurn(sid, 2);
    const idxPath = idxPathOf(sid);
    expect(fs.existsSync(idxPath)).toBe(true);

    // 模拟索引追加失败：spy 一次 reject → writeEvents 应 catch 并删除该卷索引
    const anchorInternal = (backend as unknown as { anchorIndex: TurnAnchorIndex }).anchorIndex;
    const spy = jest.spyOn(anchorInternal, 'appendBatchRows').mockRejectedValueOnce(new Error('disk full'));
    try {
      await appendTurn(sid, 2); // 事件写成功、索引追加失败 → 删卷
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(idxPath)).toBe(false); // 已作废

    // 读时缺失 → 单卷重建 → 页正确
    const expected = await replay.getEventPage(sid, { turns: 3 });
    expect(expected.events.length).toBeGreaterThan(0);
    expect(fs.existsSync(idxPath)).toBe(true); // 重建完成
    // 重建后的索引与事件文件一致（行数 = 3 轮 × 2）
    expect(readRows(idxPath).length).toBe(6);
  });

  it('truncate 后索引卷被删除（读时重建），不残留悬空偏移', async () => {
    const sid = 'w-trunc';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 2);
    // 模拟 torn 尾修复：截断尾部 2 行并调用 truncate（内部会作废索引）
    const segPath = path.join(sessionsRoot, sid, 'seg-0000.jsonl');
    const buf = fs.readFileSync(segPath);
    let cut = buf.length;
    for (let n = 0; n < 2; n += 1) cut = buf.lastIndexOf(0x0a, cut - 1);
    const truncateTo = cut + 1;
    fs.truncateSync(segPath, truncateTo);
    // 取截断点前的最后一个完整事件 seq
    const content = fs.readFileSync(segPath, 'utf-8').trim().split('\n');
    const lastSeq = (JSON.parse(content[content.length - 1]) as { seq: number }).seq;
    await backend.maintenance.truncate!(sid, truncateTo, lastSeq, truncateTo);

    expect(fs.existsSync(idxPathOf(sid))).toBe(false); // truncate 后索引被删
    const page = await replay.getEventPage(sid, { turns: 2 });
    expect(page.events[page.events.length - 1].seq).toBe(lastSeq);
    expect(fs.existsSync(idxPathOf(sid))).toBe(true); // 读时重建
  });

  it('端到端：连续写入 → 读页/翻页（索引由写维护，无需 ensureAllIndexes）', async () => {
    const sid = 'w-e2e';
    await backend.createSession(sid);
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(await appendTurn(sid, 3));
    // 删除中间一轮（delete 精准凑数）
    await backend.appendEvents(sid, [{ type: 'turn/delete', time: now(), data: { turnId: ids[5] } }]);

    // 索引已由写入方维护：直接读（无需任何预构建）
    const page = await replay.getEventPage(sid, { turns: 3 });
    const visible = page.events.filter(
      (e) =>
        e.type === 'turn/start' &&
        (e.data as { turnId: string }).turnId !== ids[5],
    );
    expect(visible.length).toBe(3); // 页内准确保 3 个可见轮次
    // 翻页链收敛
    let cursor = page.nextBeforeSeq;
    let pages = 1;
    while (cursor !== null && pages < 20) {
      const next = await replay.getEventPage(sid, { turns: 3, beforeSeq: cursor });
      pages += 1;
      cursor = next.nextBeforeSeq;
    }
    expect(cursor).toBeNull();
    // 三个索引卷?单段场景:seg-0000.idx 的行数 = 10×2 + 1(delete) = 21
    expect(readRows(idxPathOf(sid)).length).toBe(21);
  });
});
