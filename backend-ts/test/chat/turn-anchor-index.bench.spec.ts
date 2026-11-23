/**
 * Turn 锚点索引 —— 性能基准（默认跳过：RUN_BENCH=1 npx jest test/chat/turn-anchor-index.bench.spec.ts）
 *
 * 索引由写入方维护（JsonlBackend.writeEvents 追加），冷启动 = 直接读索引。
 * 对照：
 * 1) 全量：无 index 能力的 backend → getAllEvents 组装（原始实现路径）
 * 2) 锚点·冷启动（写时维护后首读，含索引加载）
 * 3) 锚点·命中 / load-more
 * 4) 异常路径：删除全部 .idx → 单卷重建（旧会话首次 / 索引损坏兜底）
 * 5) 索引体积、写路径追加成本微基准
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JsonlBackend } from '../../src/common/persistence/jsonl-backend';
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import { TurnAnchorIndex } from '../../src/common/persistence/turn-anchor-index';
import type { MessageEventLog, PendingEvent } from '../../src/common/persistence/event-log.port';

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
  return +(bytes / 1048576).toFixed(2);
}

function kb(bytes: number): number {
  return +(bytes / 1024).toFixed(1);
}

d('Turn 锚点索引性能基准', () => {
  let tmpDir: string;
  let sessionsRoot: string;
  let backend: JsonlBackend;
  let replay: SessionReplayService; // 锚点路径(写时维护)
  let replayFull: SessionReplayService; // 全量对照
  let anchor: TurnAnchorIndex; // 独立实例(读取字节统计)

  async function generateLog(sid: string, totalTurns: number, msgBytes: number): Promise<void> {
    await backend.createSession(sid);
    let turnId = 0;
    const totalBatches = Math.ceil(totalTurns / 100);
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
      await backend.appendEvents(sid, evs); // 写入方同步维护锚点索引
      if ((batch + 1) % 20 === 0 && batch + 1 < totalBatches) {
        await backend.splitSegment(sid);
      }
    }
  }

  it('50MB/3段 + 5MB/1段：全量 vs 锚点（写时维护）vs 异常重建', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-anchor-bench-'));
    process.env.SESSION_DATA_DIR = tmpDir;
    sessionsRoot = path.join(tmpDir, 'sessions');
    backend = new JsonlBackend();
    replay = new SessionReplayService(backend);
    replayFull = new SessionReplayService({
      getAllEvents: (sid: string) => backend.getAllEvents(sid),
    } as unknown as MessageEventLog);
    anchor = new TurnAnchorIndex(sessionsRoot);

    // ── 50MB/3 段 ──
    const sid50 = 'bench-50mb';
    await generateLog(sid50, 5000, 1024);
    const segDir = path.join(sessionsRoot, sid50);
    const segFiles = fs.readdirSync(segDir).filter((f) => f.endsWith('.jsonl'));
    const totalBytes = segFiles.reduce((s, f) => s + fs.statSync(path.join(segDir, f)).size, 0);

    const fullMs = await measure(() => replayFull.getEventPage(sid50, { turns: 30 }));
    // 冷启动：索引已由写维护，首读 = 加载索引 + 读页
    anchor.stats.bytesReadEvents = 0;
    anchor.stats.bytesReadIndex = 0;
    const coldMs = await measure(() => anchor.readPage(sid50, { turns: 30 }), 1);
    anchor.stats.bytesReadEvents = 0;
    anchor.stats.bytesReadIndex = 0;
    const coldPage = await anchor.readPage(sid50, { turns: 30 });
    const coldBytes = anchor.stats.bytesReadEvents + anchor.stats.bytesReadIndex;
    // 命中
    const hitMs = await measure(() => anchor.readPage(sid50, { turns: 30 }));
    anchor.stats.bytesReadEvents = 0;
    anchor.stats.bytesReadIndex = 0;
    const page = await anchor.readPage(sid50, { turns: 30 });
    const hitBytes = anchor.stats.bytesReadEvents + anchor.stats.bytesReadIndex;
    // load-more
    anchor.stats.bytesReadEvents = 0;
    const loadMs = await measure(
      () => anchor.readPage(sid50, { turns: 30, beforeSeq: page.nextBeforeSeq! }),
      1,
    );
    const loadBytes = anchor.stats.bytesReadEvents;

    // 索引体积
    const idxBytes = fs
      .readdirSync(segDir)
      .filter((f) => f.endsWith('.idx'))
      .reduce((s, f) => s + fs.statSync(path.join(segDir, f)).size, 0);
    const idxRowBytes = +(idxBytes / 10_000).toFixed(1); // 5000 轮 × 2 行(start+finish) + delete

    // 异常路径：删除全部 .idx → 重建（旧会话首次 / 索引损坏兜底）
    for (const f of fs.readdirSync(segDir).filter((x) => x.endsWith('.idx'))) {
      fs.rmSync(path.join(segDir, f));
    }
    const rebuildMs = await measure(() => anchor.ensureAllIndexes(sid50), 1);

    // ── 5MB/1 段 ──
    const sid5 = 'bench-5mb';
    await generateLog(sid5, 500, 1024);
    const total5 = fs.statSync(path.join(sessionsRoot, sid5, 'seg-0000.jsonl')).size;
    const full5Ms = await measure(() => replayFull.getEventPage(sid5, { turns: 30 }));
    anchor.stats.bytesReadEvents = 0;
    anchor.stats.bytesReadIndex = 0;
    const cold5Ms = await measure(() => anchor.readPage(sid5, { turns: 30 }), 1);
    anchor.stats.bytesReadEvents = 0;
    anchor.stats.bytesReadIndex = 0;
    await anchor.readPage(sid5, { turns: 30 });
    const cold5Bytes = anchor.stats.bytesReadEvents + anchor.stats.bytesReadIndex;
    const hit5Ms = await measure(() => anchor.readPage(sid5, { turns: 30 }));

    // ── 写路径追加成本（1000 行索引 appendFile） ──
    const rows1000 = Array.from({ length: 1000 }, (_, i) => `s,${i},${i * 40},bt${i}`).join('\n') + '\n';
    const benchFile = path.join(tmpDir, 'append-bench.tmp');
    fs.writeFileSync(benchFile, '');
    const appendMs = await measure(async () => {
      await fs.promises.appendFile(benchFile, rows1000, 'utf-8');
    }, 5);
    fs.rmSync(benchFile, { force: true });

    const rows = [
      { 场景: '50MB/3段 全量(原始)', 耗时ms: Math.round(fullMs), 读MB: mb(totalBytes) },
      { 场景: '50MB/3段 锚点·冷启动(写时维护)', 耗时ms: Math.round(coldMs), 读MB: mb(coldBytes) },
      { 场景: '50MB/3段 锚点·命中', 耗时ms: Math.round(hitMs), 读MB: mb(hitBytes) },
      { 场景: '50MB/3段 锚点·load-more', 耗时ms: Math.round(loadMs), 读MB: mb(loadBytes) },
      { 场景: '50MB/3段 异常·删索引重建', 耗时ms: Math.round(rebuildMs), 读MB: mb(totalBytes) },
      { 场景: '5MB/1段 全量(原始)', 耗时ms: Math.round(full5Ms), 读MB: mb(total5) },
      { 场景: '5MB/1段 锚点·冷启动', 耗时ms: Math.round(cold5Ms), 读MB: mb(cold5Bytes) },
      { 场景: '5MB/1段 锚点·命中', 耗时ms: Math.round(hit5Ms), 读MB: '—' },
    ];
    console.table(rows);
    console.log(
      `\n索引体积: ${kb(idxBytes)}KB（5000 轮 ≈ ${idxRowBytes}B/行，CSV）`,
    );
    console.log(
      `写路径成本：1000 行索引追加 ${appendMs.toFixed(2)}ms/次；按每回合 2 行 ≈ 100 回合批 ${
        (appendMs / 5).toFixed(2)
      }ms 量级（写入时同步维护，冷启动免重建）`,
    );
    console.log(
      `加速比(50MB)：冷启动 ${(fullMs / coldMs).toFixed(0)}x；命中 ${(fullMs / hitMs).toFixed(0)}x；` +
        `读放大 ${(totalBytes / 1048576 / (hitBytes / 1048576)).toFixed(0)}x 降低`,
    );

    // 正确性冒烟：锚点页与全量路径一致（稳态两语义等价）
    expect(await replay.getEventPage(sid50, { turns: 30 })).toEqual(
      await replayFull.getEventPage(sid50, { turns: 30 }),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.SESSION_DATA_DIR;
  }, 600000);
});
