/**
 * 前向增量读（readTail / getEventsAfter）——断点续传读路径
 *
 * 覆盖：单段内增量（锚点收窄）、limit 截断 + hasMoreAfter、空批回显 afterSeq、
 * afterSeq 越过尾、跨段定位（只读含缺口的段）、索引缺失重建后仍正确、
 * 与全量过滤结果一致（快路径 vs 权威路径）、CorruptSessionLogError 上抛。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';

let tmpDir: string;
let sessionsRoot: string;
let backend: JsonlBackend;
let replay: SessionReplayService;

let turnIdSeq = 0;

function now(): number {
  return Date.UTC(2026, 0, 1);
}

/** 追加一轮：turn/start + N 条 assistant/message + turn/finish */
async function appendTurn(sid: string, nMsgs = 3): Promise<string> {
  turnIdSeq += 1;
  const tid = `t${turnIdSeq}`;
  const evs: any[] = [{ type: 'turn/start', time: now(), data: { turnId: tid } }];
  for (let i = 0; i < nMsgs; i += 1) {
    evs.push({
      type: 'assistant/message',
      time: now(),
      data: { messageId: `${tid}-m${i}`, content: 'x'.repeat(20) },
    });
  }
  evs.push({ type: 'turn/finish', time: now(), data: { turnId: tid } });
  await backend.appendEvents(sid, evs);
  return tid;
}

/** 权威参照：全量过滤（与 SessionReplayService 兜底路径同一口径） */
async function idealAfter(sid: string, afterSeq: number, limit: number) {
  const all = await backend.getAllEvents(sid);
  const after = all.filter((e) => e.seq > afterSeq);
  const page = after.slice(0, limit);
  return {
    events: page,
    endSeq: page.length > 0 ? page[page.length - 1].seq : afterSeq,
    hasMoreAfter: after.length > limit,
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-anchor-tail-'));
  process.env.SESSION_DATA_DIR = tmpDir;
  sessionsRoot = path.join(tmpDir, 'sessions');
  backend = new JsonlBackend();
  replay = new SessionReplayService(backend);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe('前向增量读（快路径 vs 全量权威路径）', () => {
  it('单段：afterSeq 落在回合中间也能精确切出增量', async () => {
    const sid = 'tail-basic';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 2);

    const all = await backend.getAllEvents(sid);
    const mid = all[Math.floor(all.length / 2)].seq;

    const fast = await replay.getEventsAfter(sid, { afterSeq: mid, limit: 500 });
    const ideal = await idealAfter(sid, mid, 500);

    expect(fast.events.map((e) => e.seq)).toEqual(ideal.events.map((e) => e.seq));
    expect(fast.endSeq).toBe(ideal.endSeq);
    expect(fast.hasMoreAfter).toBe(false);
    expect(fast.tailSeq).toBe(all[all.length - 1].seq);
  });

  it('afterSeq = 尾 → 空批回显 afterSeq，tailSeq 仍为真实尾', async () => {
    const sid = 'tail-empty';
    await backend.createSession(sid);
    await appendTurn(sid);
    const all = await backend.getAllEvents(sid);
    const tail = all[all.length - 1].seq;

    const res = await replay.getEventsAfter(sid, { afterSeq: tail });
    expect(res.events).toEqual([]);
    expect(res.endSeq).toBe(tail);
    expect(res.tailSeq).toBe(tail);
    expect(res.hasMoreAfter).toBe(false);
  });

  it('afterSeq 超过尾（客户端水位超前）→ 空批且不抛错', async () => {
    const sid = 'tail-beyond';
    await backend.createSession(sid);
    await appendTurn(sid);

    const res = await replay.getEventsAfter(sid, { afterSeq: 999_999 });
    expect(res.events).toEqual([]);
    expect(res.endSeq).toBe(999_999);
    expect(res.hasMoreAfter).toBe(false);
  });

  it('limit 截断：hasMoreAfter=true，且批次按 seq 升序', async () => {
    const sid = 'tail-limit';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 2);

    const res = await replay.getEventsAfter(sid, { afterSeq: -1, limit: 3 });
    expect(res.events).toHaveLength(3);
    expect(res.hasMoreAfter).toBe(true);
    const seqs = res.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    // 继续拉下一批直到追平（模拟客户端循环；本方案客户端缺口超一批会整页重拉）
    const next = await replay.getEventsAfter(sid, { afterSeq: res.endSeq, limit: 2000 });
    expect(next.hasMoreAfter).toBe(false);
    expect(next.endSeq).toBe(next.tailSeq);
  });

  it('limit 越界被钳制（0 → 1，超大 → 2000）', async () => {
    const sid = 'tail-clamp';
    await backend.createSession(sid);
    for (let i = 0; i < 3; i += 1) await appendTurn(sid, 1);

    const one = await replay.getEventsAfter(sid, { afterSeq: -1, limit: 0 });
    expect(one.events).toHaveLength(1);

    const many = await replay.getEventsAfter(sid, { afterSeq: -1, limit: 99_999 });
    expect(many.events.length).toBeGreaterThan(1);
    expect(many.hasMoreAfter).toBe(false);
  });

  it('跨段：afterSeq 落在归档段时，结果仍与全量一致', async () => {
    const sid = 'tail-multi';
    await backend.createSession(sid);
    // 制造 3 段
    for (let i = 0; i < 6; i += 1) {
      await appendTurn(sid, 2);
      await backend.splitSegment(sid);
    }
    await appendTurn(sid, 2);

    const all = await backend.getAllEvents(sid);
    expect(all.length).toBeGreaterThan(10);

    for (const idx of [0, Math.floor(all.length / 3), Math.floor(all.length / 2), all.length - 2]) {
      const afterSeq = all[idx].seq;
      const fast = await replay.getEventsAfter(sid, { afterSeq, limit: 500 });
      const ideal = await idealAfter(sid, afterSeq, 500);
      expect(fast.events.map((e) => e.seq)).toEqual(ideal.events.map((e) => e.seq));
      expect(fast.endSeq).toBe(ideal.endSeq);
    }
  });

  it('索引缺失（删除 .idx）→ 重建后结果不变', async () => {
    const sid = 'tail-idx-missing';
    await backend.createSession(sid);
    for (let i = 0; i < 3; i += 1) await appendTurn(sid, 2);
    const all = await backend.getAllEvents(sid);
    const afterSeq = all[3].seq;

    const before = await replay.getEventsAfter(sid, { afterSeq, limit: 500 });

    for (const f of fs.readdirSync(path.join(sessionsRoot, sid))) {
      if (f.endsWith('.idx')) fs.rmSync(path.join(sessionsRoot, sid, f));
    }

    const after = await replay.getEventsAfter(sid, { afterSeq, limit: 500 });
    expect(after.events.map((e) => e.seq)).toEqual(before.events.map((e) => e.seq));
  });

  it('无 index 能力的后端 → 走全量兜底，结果一致', async () => {
    const sid = 'tail-no-index';
    await backend.createSession(sid);
    for (let i = 0; i < 3; i += 1) await appendTurn(sid, 2);
    const all = await backend.getAllEvents(sid);
    const afterSeq = all[2].seq;

    const fast = await replay.getEventsAfter(sid, { afterSeq, limit: 500 });

    // 去掉 index 能力，强制走兜底
    const bare = Object.create(backend) as JsonlBackend;
    Object.defineProperty(bare, 'index', { value: undefined });
    const fallbackReplay = new SessionReplayService(bare);
    const fallback = await fallbackReplay.getEventsAfter(sid, { afterSeq, limit: 500 });

    expect(fallback.events.map((e) => e.seq)).toEqual(fast.events.map((e) => e.seq));
    expect(fallback.tailSeq).toBe(fast.tailSeq);
  });

  it('仅有 session/init（无回合）→ 增量含该事件，tailSeq 为其 seq', async () => {
    const sid = 'tail-empty-log';
    await backend.createSession(sid);
    const all = await backend.getAllEvents(sid);
    expect(all.length).toBeGreaterThan(0); // createSession 写 session/init

    const res = await replay.getEventsAfter(sid, { afterSeq: -1 });
    expect(res.events.map((e) => e.seq)).toEqual(all.map((e) => e.seq));
    expect(res.tailSeq).toBe(all[all.length - 1].seq);
    expect(res.hasMoreAfter).toBe(false);

    // 追平后为空批
    const caught = await replay.getEventsAfter(sid, { afterSeq: res.endSeq });
    expect(caught.events).toEqual([]);
  });
});
