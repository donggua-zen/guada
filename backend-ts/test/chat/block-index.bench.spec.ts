/**
 * JsonlBlockIndex 性能基准（默认跳过：RUN_BENCH=1 npx jest test/chat/block-index.bench.spec.ts）
 *
 * 对比（同一条真实接入路径）：全量组装（无 index 能力的 backend → getAllEvents）
 * vs 块索引组装（JsonlBackend.index → readChunksBackward + 配对凑页）。
 * 指标：单次请求耗时（ms，多次取中位）+ 单次请求实际读取字节数（独立索引实例 stats）。
 * 场景：初始加载（turns=30）、load-more（下一页）；50MB 多分卷（3 段）与 5MB 单段。
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import { JsonlBlockIndex } from '../../src/common/persistence/jsonl-block-index';
import type { MessageEventLog } from '../../src/common/persistence/event-log.port';
import type { PendingEvent } from '../../src/common/persistence/event-log.port';

const d = process.env.RUN_BENCH === '1' ? describe : describe.skip;
const NOW = 1767225600000;

async function median(xs: number[]): Promise<number> {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function measure(fn: () => Promise<unknown>, times = 3): Promise<number> {
  const out: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const t0 = performance.now();
    await fn();
    out.push(performance.now() - t0);
  }
  return median(out);
}

function mb(bytes: number): number {
  return +(bytes / 1048576).toFixed(1);
}

d('JsonlBlockIndex 性能基准', () => {
  let tmpDir: string;
  let sessionsRoot: string;
  let backend: JsonlBackend;
  let replay: SessionReplayService;
  /** 全量对照:无 index 能力的 backend(与现有实现同路径) */
  let replayFull: SessionReplayService;
  /** 独立索引实例(仅用于读取字节统计,与 backend.index 同文件同块) */

  /** 生成真实规模日志:batchTurns×100 回合,每回合 10 条 1KB 消息 */
  async function generateLog(sid: string, batchTurns: number, msgBytes: number): Promise<void> {
    await backend.createSession(sid);
    let turnId = 0;
    const totalBatches = Math.ceil(batchTurns / 100);
    for (let batch = 0; batch < totalBatches; batch += 1) {
      const evs: PendingEvent[] = [];
      for (let t = 0; t < 100; t += 1) {
        turnId += 1;
        const tid = `bt${turnId}`;
        evs.push({ type: 'turn/start', time: NOW, data: { turnId: tid } });
        for (let m = 0; m < 10; m += 1) {
          evs.push({
            type: 'assistant/message',
            time: NOW,
            data: { messageId: `${tid}-m${m}`, content: 'x'.repeat(msgBytes) },
          });
        }
        evs.push({ type: 'turn/finish', time: NOW, data: { turnId: tid } });
      }
      await backend.appendEvents(sid, evs);
      // 每段约 20MB(SEGMENT_MAX_BYTES):2000 回合 × 10.5KB ≈ 21MB
      if ((batch + 1) % 20 === 0 && batch + 1 < totalBatches) {
        await backend.splitSegment(sid);
      }
    }
  }

  it('全量 vs 索引:50MB 多分卷 + 5MB 单段', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-bench-'));
    process.env.SESSION_DATA_DIR = tmpDir;
    sessionsRoot = path.join(tmpDir, 'sessions');
    backend = new JsonlBackend();
    replay = new SessionReplayService(backend);
    replayFull = new SessionReplayService({
      getAllEvents: (sid: string) => backend.getAllEvents(sid),
    } as unknown as MessageEventLog); // 无 index 能力 → 走全量组装(现有实现路径)
    

    // ── 场景 1:50MB 多分卷(5000 回合 × 10 条 1KB 消息 ≈ 57MB,3 段) ──
    const sid50 = 'bench-50mb';
    const t0 = performance.now();
    await generateLog(sid50, 5000, 1024);
    const genMs = performance.now() - t0;
    const segDir = path.join(sessionsRoot, sid50);
    const segFiles = fs.readdirSync(segDir).filter((f) => f.endsWith('.jsonl'));
    const totalBytes = segFiles.reduce(
      (sum, f) => sum + fs.statSync(path.join(segDir, f)).size,
      0,
    );

    // 全量基准(现有实现路径)
    const fullMs = await measure(() => replayFull.getEventPage(sid50, { turns: 30 }));

    // 索引:首次 = 冷启动种子构建
    const firstMs = await measure(() => replay.getEventPage(sid50, { turns: 30 }), 1);
    const firstBytes = backend.indexStats.bytesRead;
    backend.indexStats.bytesRead = 0;
    const hitMs = await measure(() => replay.getEventPage(sid50, { turns: 30 }));
    backend.indexStats.bytesRead = 0;
    await replay.getEventPage(sid50, { turns: 30 });
    const hitBytes = backend.indexStats.bytesRead;
    const initialPage = await replay.getEventPage(sid50, { turns: 30 });
    const cursor = initialPage.nextBeforeSeq;
    backend.indexStats.bytesRead = 0;
    const loadMs = await measure(
      () => replay.getEventPage(sid50, { turns: 30, beforeSeq: cursor! }),
      1,
    );
    const loadBytes = backend.indexStats.bytesRead;

    // ── 场景 2:5MB 单段(500 回合) ──
    const sid5 = 'bench-5mb';
    await generateLog(sid5, 500, 1024);
    const total5 = fs.statSync(path.join(sessionsRoot, sid5, 'seg-0000.jsonl')).size;
    const full5Ms = await measure(() => replayFull.getEventPage(sid5, { turns: 30 }));
    const first5Ms = await measure(() => replay.getEventPage(sid5, { turns: 30 }), 1);
    const first5Bytes = backend.indexStats.bytesRead;
    backend.indexStats.bytesRead = 0;
    const hit5Ms = await measure(() => replay.getEventPage(sid5, { turns: 30 }));
    backend.indexStats.bytesRead = 0;
    await replay.getEventPage(sid5, { turns: 30 });
    const hit5Bytes = backend.indexStats.bytesRead;

    const rows = [
      { 场景: '50MB/3段 全量(现有实现)', 耗时ms: Math.round(fullMs), 单次读MB: mb(totalBytes) },
      { 场景: '50MB 索引首次·冷启动', 耗时ms: Math.round(firstMs), 单次读MB: mb(firstBytes) },
      { 场景: '50MB 索引命中', 耗时ms: Math.round(hitMs), 单次读MB: mb(hitBytes) },
      { 场景: '50MB 索引load-more', 耗时ms: Math.round(loadMs), 单次读MB: mb(loadBytes) },
      { 场景: '5MB/1段 全量(现有实现)', 耗时ms: Math.round(full5Ms), 单次读MB: mb(total5) },
      { 场景: '5MB 索引首次·冷启动', 耗时ms: Math.round(first5Ms), 单次读MB: mb(first5Bytes) },
      { 场景: '5MB 索引命中', 耗时ms: Math.round(hit5Ms), 单次读MB: mb(hit5Bytes) },
    ];
    console.log(
      `\n生成 50MB 日志耗时 ${Math.round(genMs)}ms（${segFiles.length} 段，共 ${totalBytes} 字节）`,
    );
    console.table(rows);
    console.log(
      `加速比(50MB):首次冷启动 ${(fullMs / firstMs).toFixed(0)}x;命中 ${(fullMs / hitMs).toFixed(0)}x`,
    );

    // 正确性冒烟:两路径结果一致(配对语义)
    expect(await replay.getEventPage(sid50, { turns: 30 })).toEqual(
      await replayFull.getEventPage(sid50, { turns: 30 }),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.SESSION_DATA_DIR;
  }, 600000);
});
