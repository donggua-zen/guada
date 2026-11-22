/**
 * JsonlBlockIndex 块流读取层测试(正式接入版)
 *
 * 分层职责:索引层只做「与轮次无关的事件倒序块流读取」——种子/命中/左扩/右续扫/
 * 指纹校验/索引落盘;页组装(turn 配对凑页)在 SessionReplayService(见
 * session-replay.block-index.spec.ts)。
 *
 * 主验收:**全流对拍** —— readChunksBackward 产出的事件批拼接后与
 * backend.getAllEvents(权威全量)逐字段一致;fromSeq 定位、追加续扫、篡改失效、
 * torn 尾截断、多分卷覆盖各有专项。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import {
  JsonlBlockIndex,
  BlockIndexStaleError,
} from '../../src/common/persistence/jsonl-block-index';
import type { BaseEvent } from '../../src/common/persistence/types';
import type { PendingEvent } from '../../src/common/persistence/event-log.port';

let tmpDir: string;
let sessionsRoot: string;
let backend: JsonlBackend;
/** chunkBytes=512:单回合 ~300B → 大量跨块,不用造大文件即可测块边界 */
let index: JsonlBlockIndex;

let turnIdSeq = 0;

function now(): number {
  return Date.UTC(2026, 0, 1);
}

/** 生成并追加一个完整回合,返回分配的 turnId */
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

function segPathOf(sid: string): string {
  return path.join(sessionsRoot, sid, 'seg-0000.jsonl');
}

/** 消费整条块流(不提前 break),拼接为 seq 升序事件序列 */
async function collectAll(sid: string, fromSeq?: number): Promise<BaseEvent[]> {
  const out: BaseEvent[] = [];
  const opts = fromSeq !== undefined ? { fromSeq } : undefined;
  for await (const batch of index.readChunksBackward(sid, opts)) {
    out.unshift(...batch);
  }
  return out;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-index-'));
  process.env.SESSION_DATA_DIR = tmpDir;
  sessionsRoot = path.join(tmpDir, 'sessions');
  backend = new JsonlBackend();
  index = new JsonlBlockIndex(sessionsRoot, 512);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe('readChunksBackward 块流读取', () => {
  it('全流对拍:单段多回合,块流拼接 == getAllEvents 权威全量(逐字段)', async () => {
    const sid = 's-single';
    await backend.createSession(sid);
    for (let i = 0; i < 12; i += 1) await appendTurn(sid, 3);

    const expected = await backend.getAllEvents(sid);
    const actual = await collectAll(sid);
    expect(actual).toEqual(expected);
    // 跨块:chunkBytes=512 → 块链多于 1 块
    const idx = await index.loadIndex(sid);
    expect((idx?.blocks.length ?? 0)).toBeGreaterThan(1);
  });

  it('fromSeq 定位:结果仍为全量(终点=日志头),但读取字节显著减少', async () => {
    const sid = 's-single'; // 复用已建会话(链已含尾段)
    const all = await backend.getAllEvents(sid);
    // 先建全链(无游标拉一次),基准字节数 = 命中全链
    await collectAll(sid);
    index.stats.bytesRead = 0;
    await collectAll(sid);
    const fullBytes = index.stats.bytesRead;

    // 带游标:定位到游标所在块起链,链尾到游标块之间的块不再读取 → 字节更少;
    // 产出 = 起始块(含游标,块粒度可含游标右侧少量事件)向左到日志起点 = 全量前缀
    for (const cursor of [25, 10]) {
      index.stats.bytesRead = 0;
      const collected = await collectAll(sid, cursor);
      const fromIdx = all.findIndex((e) => e.seq === cursor);
      expect(fromIdx).toBeGreaterThanOrEqual(0);
      // 覆盖游标(含)与日志起点(含),且无缺口:collected == 全量前缀
      expect(collected[0].seq).toBe(0);
      expect(collected[collected.length - 1].seq).toBeGreaterThanOrEqual(cursor);
      expect(collected).toEqual(all.slice(0, collected.length));
      expect(collected.length).toBeGreaterThanOrEqual(fromIdx + 1);
      const localizedBytes = index.stats.bytesRead;
      expect(localizedBytes).toBeGreaterThan(0);
      expect(localizedBytes).toBeLessThan(fullBytes);
    }
    // 游标超日志尾:从尾块起产出(=全流),消费方按页语义判定空页
    const beyond = await collectAll(sid, all.length + 100);
    expect(beyond).toEqual(all);
  });

  it('多分卷(3 段):跨段左扩/右续扫,全流对拍', async () => {
    const sid = 's-multi-seg';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 4);
    await backend.splitSegment(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 4);

    const manifest = await (backend as unknown as {
      readManifest: (s: string) => Promise<{ segments: unknown[] }>;
    }).readManifest(sid);
    expect(manifest.segments.length).toBe(3);

    const expected = await backend.getAllEvents(sid);
    const actual = await collectAll(sid);
    expect(actual).toEqual(expected);
    const idx = await index.loadIndex(sid);
    const files = new Set(idx?.blocks.map((b) => b.file));
    expect(files.size).toBe(3); // 块链横跨三个段文件
  });

  it('活跃段追加:append-only → 已建块仍有效,右扩续扫覆盖新内容', async () => {
    const sid = 's-append';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 3);
    const collectedBefore = await collectAll(sid, 10); // 建链
    expect(collectedBefore.length).toBeGreaterThan(0);

    const scansBefore = index.stats.scans;
    const idxBefore = await index.loadIndex(sid);

    for (let i = 0; i < 3; i += 1) await appendTurn(sid, 3); // 追加

    const expected = await backend.getAllEvents(sid);
    const actual = await collectAll(sid);
    expect(actual).toEqual(expected); // 右扩续扫后全流一致
    expect(index.stats.scans).toBeGreaterThan(scansBefore);
    const idxAfter = await index.loadIndex(sid);
    expect((idxAfter?.blocks.length ?? 0)).toBeGreaterThan(idxBefore?.blocks.length ?? 0);
  });

  it('命中加速:二次读取字节数远小于全量', async () => {
    const sid = 's-perf';
    await backend.createSession(sid);
    for (let i = 0; i < 40; i += 1) await appendTurn(sid, 3);
    const fileBytes = fs.statSync(segPathOf(sid)).size;

    await collectAll(sid, 10); // 建链(定位到中部游标)
    index.stats.bytesRead = 0;
    await collectAll(sid, 10); // 命中
    expect(index.stats.bytesRead).toBeGreaterThan(0);
    expect(index.stats.bytesRead).toBeLessThan(fileBytes / 3);
  });

  it('空会话(仅 init)/无 manifest:流产出与 getAllEvents 一致', async () => {
    const sid = 's-blank';
    await backend.createSession(sid); // createSession 幂等写 session/init → 日志并非真空
    const expected = await backend.getAllEvents(sid);
    const batches: BaseEvent[][] = [];
    for await (const batch of index.readChunksBackward(sid)) batches.push(batch);
    expect(batches.flat()).toEqual(expected); // 1 批 = [session/init]

    const sid2 = 's-no-manifest';
    fs.mkdirSync(path.join(sessionsRoot, sid2), { recursive: true });
    const batches2: BaseEvent[][] = [];
    for await (const batch of index.readChunksBackward(sid2)) batches2.push(batch);
    expect(batches2).toEqual([]); // 无 manifest = 无会话数据 → 流立即结束
  });

  it('torn 尾:活跃段半条 JSON → 截断返回且不触碰文件', async () => {
    const sid = 's-torn';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 3);
    const segPath = segPathOf(sid);
    const sizeBefore = fs.statSync(segPath).size;

    await collectAll(sid); // 建链
    fs.appendFileSync(segPath, '{"type":"assistant/mess'); // torn 尾
    const sizeAfterAppend = fs.statSync(segPath).size;

    const expected = await backend.getAllEvents(sid); // 全量:torn 截断(权威)
    const actual = await collectAll(sid); // 块流:续扫 torn 截断(同语义)
    expect(actual).toEqual(expected);
    expect(fs.statSync(segPath).size).toBe(sizeAfterAppend);
    expect(sizeAfterAppend).toBe(sizeBefore + '{"type":"assistant/mess'.length);
  });
});

describe('索引失效(JSONL 为权威)', () => {
  it('块内容篡改一个字节 → 指纹失配 → 抛 Stale 且索引文件被作废', async () => {
    const sid = 's-tamper';
    await backend.createSession(sid);
    for (let i = 0; i < 6; i += 1) await appendTurn(sid, 3);
    await collectAll(sid, 10); // 建链(覆盖尾部)

    // 篡改尾部已索引块内一个字节:msg content 的 'x' → 'y'(JSON 保持合法,仅 hash 变)
    const segPath = segPathOf(sid);
    const buf = fs.readFileSync(segPath);
    for (let i = buf.length - 1; i >= 0; i -= 1) {
      if (buf[i] === 0x78) {
        buf[i] = 0x79;
        break;
      }
    }
    fs.writeFileSync(segPath, buf);

    const batches: BaseEvent[][] = [];
    await expect(
      (async () => {
        for await (const batch of index.readChunksBackward(sid)) batches.push(batch);
      })(),
    ).rejects.toThrow(BlockIndexStaleError);
    expect(await index.loadIndex(sid)).toBeNull(); // 抛出前已自动作废

    // 回退全量(消费方语义):getAllEvents 权威结果仍正确
    const expected = await backend.getAllEvents(sid);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('坏索引 JSON → 视为无索引,种子重建正常产出', async () => {
    const sid = 's-bad-index';
    await backend.createSession(sid);
    for (let i = 0; i < 4; i += 1) await appendTurn(sid, 3);
    fs.writeFileSync(path.join(sessionsRoot, sid, 'events.index.json'), '{oops not json');

    const expected = await backend.getAllEvents(sid);
    const actual = await collectAll(sid);
    expect(actual).toEqual(expected);
    const idx = await index.loadIndex(sid);
    expect(idx).not.toBeNull(); // 重建成功
  });

  it('索引 seq 范围被篡改 → 块校验失配 → Stale + 作废', async () => {
    const sid = 's-forged-seq';
    await backend.createSession(sid);
    for (let i = 0; i < 5; i += 1) await appendTurn(sid, 3);
    await collectAll(sid, 10);

    const idxPath = path.join(sessionsRoot, sid, 'events.index.json');
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    idx.blocks[idx.blocks.length - 1].endSeq += 7;
    fs.writeFileSync(idxPath, JSON.stringify(idx));

    await expect(
      (async () => {
        for await (const _batch of index.readChunksBackward(sid)) {
          void _batch;
        }
      })(),
    ).rejects.toThrow(BlockIndexStaleError);
    expect(await index.loadIndex(sid)).toBeNull();
  });
});
