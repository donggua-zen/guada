/**
 * JSONL 事件日志块级位置索引 —— 块流读取层(正式接入版)
 *
 * 分层职责(读侧协议,模拟验证见 test/chat/block-stream-flow.spec.ts):
 * - 本层:与轮次无关的「事件倒序块流读取」。只负责 块级位置索引(seq 范围 ↔
 *   字节范围)+指纹校验 + 种子/扩块/续扫,按块产出事件批(块内 seq 升序、
 *   批序从新到旧),直到覆盖日志起点。何时停由消费方决定。
 * - 消费方(SessionReplayService.getEventPage):for-await 消费块流,块内反向扫,
 *   简单 turn 配对(start 遇到右侧已见 finish → 闭合轮次)凑够 N 轮 → 页首=
 *   该 start;delete 不参与计数、原样下发;进行中回合(无 finish)不计轮次,
 *   事件保留在页尾。
 * - 前端:投影(foldEvents 全量重建)消解 delete 后可见轮次不足 → 补拉
 *   (beforeSeq=最早可见轮 start-1),补拉页前插 eventLog 后再次全量重建。
 *
 * 加速与权威:JSONL 是权威,索引只是加速层。任何校验失败(指纹失配/链断裂/
 * 段缺失)抛 BlockIndexStaleError 并自动作废索引文件;消费方捕获后回退
 * getAllEvents 全量组装。append-only 写模型下已建块字节永不变化——活跃段
 * 追加、rotate 分卷、导入只让索引「不够长」(右扩续扫),不会失效;只有物理
 * 改写(torn 尾截断修复、会话清空重建同名段)才触发指纹失配。
 *
 * 性能(50MB/3 段基准,详见 test/chat/block-index.bench.spec.ts):
 * 冷启动 10-71ms / 命中 5-14ms,单次读取 54.7MB → 0.5-2MB。
 */

import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import type { BaseEvent, Manifest } from './types';
// 会话数据根解析与 JsonlBackend 单一真相同源（生产接入时无参构造即对齐）
import { resolveSessionsBasePath } from '../utils/session-path.util';

export interface BlockIndexEntry {
  /** 段文件名（'seg-0001.jsonl'） */
  file: string;
  /** 行对齐后的块起点（含）——指向上一块末行 \n 之后 */
  startByte: number;
  /** 块终点（不含）——行边界 */
  endByte: number;
  startSeq: number;
  endSeq: number;
  /** 块内事件行数（与 hash 双重校验） */
  eventCount: number;
  /** 块字节 sha256：读块后重算比对，错一个字节即失效 */
  hash: string;
}

export interface EventsBlockIndex {
  version: 1;
  sessionId: string;
  updatedAt: string;
  /** 链首是否已覆盖日志起点（第一段 byte 0） */
  coveredToStart: boolean;
  /** 按 startSeq 升序、seq 连续衔接的块链 */
  blocks: BlockIndexEntry[];
}

export interface BlockIndexStats {
  /** 累计读取字节数（基准断言用：加速后应远小于全量） */
  bytesRead: number;
  /** 索引块命中次数 */
  blockHits: number;
  /** 窗口/全量扫描次数（新块产出） */
  scans: number;
}

/** 索引不可信信号：抛出前已自动作废索引文件，消费方回退全量路径 */
export class BlockIndexStaleError extends Error {}

export const DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024;

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface ParsedLine {
  ev: BaseEvent;
  startRel: number;
  /** 行末（含 \n），相对 buf 起点 */
  endRel: number;
}

/**
 * 按行解析已行对齐的 buffer。expectedSeq 非 null 时校验全局连续（续扫路径）；
 * null 时以首行为锚做块内相对连续校验（种子/左扩窗口路径）。空行跳过
 * （与 JsonlBackend.scanSegmentFile 一致）。
 */
function parseLines(
  buf: Buffer,
  expectedSeq: number | null,
): { lines: ParsedLine[]; gap: { expected: number; got: number } | null; badTail: boolean } {
  const lines: ParsedLine[] = [];
  let pos = 0;
  let expected = expectedSeq;
  for (;;) {
    if (pos >= buf.length) break;
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) return { lines, gap: null, badTail: true }; // 残余无换行（torn）
    if (nl === pos) {
      pos = nl + 1; // 空行
      continue;
    }
    let ev: BaseEvent;
    try {
      ev = JSON.parse(buf.subarray(pos, nl).toString('utf-8')) as BaseEvent;
    } catch {
      return { lines, gap: null, badTail: true }; // 坏行
    }
    // 首行（expectedSeq 显式给出时）校验全局锚点；后续行校验相对连续
    if (lines.length === 0) {
      if (expected !== null && ev.seq !== expected) {
        return { lines, gap: { expected, got: ev.seq }, badTail: false };
      }
    } else if (ev.seq !== lines[lines.length - 1].ev.seq + 1) {
      const expected2 = lines[lines.length - 1].ev.seq + 1;
      return { lines, gap: { expected: expected2, got: ev.seq }, badTail: false };
    }
    lines.push({ ev, startRel: pos, endRel: nl + 1 });
    pos = nl + 1;
  }
  return { lines, gap: null, badTail: false };
}

interface LoadedBlock {
  entry: BlockIndexEntry;
  events: BaseEvent[];
}

async function readRange(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function fileSize(filePath: string): Promise<number> {
  return (await fs.stat(filePath)).size;
}

export class JsonlBlockIndex {
  readonly stats: BlockIndexStats = { bytesRead: 0, blockHits: 0, scans: 0 };

  constructor(
    /** 会话数据根（与 JsonlBackend.basePath 同源同值）；默认走单一真相解析 */
    private readonly basePath: string = resolveSessionsBasePath(),
    private readonly chunkBytes: number = DEFAULT_CHUNK_BYTES,
  ) {}

  /**
   * 倒序块流：从 fromSeq（缺省 = 日志末尾）所在的块开始，向左逐块产出事件批
   * （块内 seq 升序、批序从新到旧），直到覆盖日志起点。何时停由消费方决定
   * （提前 break 即截断）。
   *
   * - 冷启动无索引时从尾部种子窗口起链（免全量），落盘后走同一命中流程
   * - fromSeq 超出链尾（活跃段追加）先右扩续扫覆盖
   * - 链内左邻块优先产出，链首耗尽再向左扩新块
   * - 命中既有块走指纹校验；任何校验失败 → 自动作废索引文件并抛
   *   BlockIndexStaleError（消费方回退 getAllEvents 全量组装）
   */
  async *readChunksBackward(
    sessionId: string,
    opts: { fromSeq?: number } = {},
  ): AsyncGenerator<BaseEvent[]> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest || manifest.segments.length === 0) return; // 无会话数据

    let index = await this.loadIndex(sessionId);
    if (!index || index.blocks.length === 0) {
      index = await this.seedIndexFromTail(sessionId, manifest); // 冷启动:尾部种子窗口
    }
    if (!index || index.blocks.length === 0) return; // 空段/无段文件（回退路径判定空页）
    assertIndexWithinManifest(index, manifest);

    const blocks: BlockIndexEntry[] = [...index.blocks].sort((a, b) => a.startSeq - b.startSeq);
    let cur = -1;
    let dirty = false;
    let stale = false;
    let rightExhausted = false; // 链尾右侧已无新内容（防死循环）

    const readEntry = async (entry: BlockIndexEntry): Promise<BaseEvent[]> => {
      const evs = await this.readBlockByEntry(sessionId, entry);
      this.stats.blockHits += 1;
      return evs;
    };
    const pushRight = (entry: BlockIndexEntry) => {
      blocks.push(entry);
      dirty = true;
    };
    const unshiftLeft = (entry: BlockIndexEntry) => {
      blocks.unshift(entry);
      dirty = true;
    };

    try {
      // 1) 右扩：覆盖请求右界（fromSeq，缺省 = 日志末尾——活跃段追加场景）
      for (;;) {
        const tail = blocks[blocks.length - 1];
        if (opts.fromSeq !== undefined && tail.endSeq >= opts.fromSeq) break;
        if (opts.fromSeq === undefined) {
          if (rightExhausted) break;
          if (await this.chainCoversLogTail(sessionId, manifest, tail)) break;
        }
        const produced = await this.extendRightOnce(
          sessionId,
          manifest,
          blocks,
          tail,
          opts.fromSeq,
          pushRight,
        );
        if (produced.length === 0) {
          // 空产出（torn 残余/无新内容）→ 防死循环：标记右侧已尽
          rightExhausted = true;
          if (opts.fromSeq !== undefined) break;
          continue;
        }
        // 仅登记块链,不在此处 yield——产出统一由向左循环 readEntry 完成,
        // 避免同一块被产出两次(消费方事件序列出现重复)
      }

      // 2) 起始块：fromSeq 所在块（早于链首 → 从链首开始向左找）
      if (opts.fromSeq !== undefined) {
        cur = findLastIdx(blocks, (b) => b.startSeq <= opts.fromSeq);
        if (cur === -1) cur = 0;
      } else {
        cur = blocks.length - 1;
      }
      yield await readEntry(blocks[cur]);

      // 3) 向左产出：链内左邻块优先（索引已有），链首耗尽再扩新块——
      //    跳过链内块会让消费方事件序列出现缺口（页内丢事件）
      for (;;) {
        if (cur > 0) {
          cur -= 1;
          yield await readEntry(blocks[cur]);
          continue;
        }
        if (this.chainCoversLogHead(manifest, blocks)) return; // 覆盖日志起点
        const head = blocks[0];
        const newBlocks = await this.extendLeftAcrossSegment(sessionId, manifest, head);
        if (!newBlocks || newBlocks.length === 0) return;
        for (const l of newBlocks) unshiftLeft(l.entry);
        cur = 0; // 新块插到链头，游标随之归零
        for (const l of newBlocks) yield l.events; // 刚扫描产出，免二次读盘
      }
    } catch (e) {
      if (e instanceof BlockIndexStaleError) {
        stale = true;
        await this.invalidate(sessionId).catch(() => {
          /* 删除失败 = 下次失配回退，不影响正确性 */
        });
      }
      throw e;
    } finally {
      // 增量块写盘（失败不影响正确性，下次重建）；失效路径跳过写盘避免复活坏索引
      if (dirty && !stale) {
        const idxObj: EventsBlockIndex = {
          version: 1,
          sessionId,
          updatedAt: new Date().toISOString(),
          coveredToStart: this.chainCoversLogHead(manifest, blocks),
          blocks: [...blocks].sort((a, b) => a.startSeq - b.startSeq),
        };
        await this.writeIndex(sessionId, idxObj).catch(() => {
          /* 索引写盘失败 = 无加速，下次重建 */
        });
      }
    }
  }

  async loadIndex(sessionId: string): Promise<EventsBlockIndex | null> {
    try {
      const raw = await fs.readFile(this.getIndexPath(sessionId), 'utf-8');
      const parsed = JSON.parse(raw) as EventsBlockIndex;
      if (parsed?.version !== 1 || !Array.isArray(parsed.blocks)) return null;
      return parsed;
    } catch {
      return null; // 缺失/坏 JSON/版本不符 = 无索引
    }
  }

  async invalidate(sessionId: string): Promise<void> {
    await fs.rm(this.getIndexPath(sessionId), { force: true });
  }

  /** 冷启动种子：从最后一段尾部取一个 chunk 窗口块作为初始链尾（免全量扫描） */
  private async seedIndexFromTail(
    sessionId: string,
    manifest: Manifest,
  ): Promise<EventsBlockIndex | null> {
    const lastSeg = manifest.segments[manifest.segments.length - 1];
    const segPath = this.getSegmentPath(sessionId, lastSeg.file);
    if (!existsSync(segPath)) return null;
    const size = await fileSize(segPath);
    if (size === 0) return null;
    const { buf, alignedStartRel } = await this.readAlignedWindowBackward(segPath, size);
    const absStart = size - buf.length + alignedStartRel;
    const cut = this.cutBlocksFromBuffer(buf.subarray(alignedStartRel), lastSeg.file, absStart, null, true);
    if (cut.gap || (cut.tornTail && cut.loaded.length === 0)) {
      // 种子窗口内自洽性破坏（罕见）→ 全量路径做权威判定
      throw new BlockIndexStaleError(`种子窗口异常 ${lastSeg.file}`);
    }
    if (cut.loaded.length === 0) return null; // 段尾全为 torn 残余 → 全量判定
    this.stats.scans += 1;
    const idx: EventsBlockIndex = {
      version: 1,
      sessionId,
      updatedAt: new Date().toISOString(),
      // 小日志(< chunkBytes)时种子窗口天然覆盖日志起点 → coveredToStart=true
      coveredToStart:
        cut.loaded[0].entry.file === manifest.segments[0].file &&
        cut.loaded[0].entry.startByte === 0,
      blocks: cut.loaded.map((l) => l.entry),
    };
    await this.writeIndex(sessionId, idx).catch(() => {
      /* 种子索引写盘失败 = 下次重扫，不影响正确性 */
    });
    return idx;
  }

  /** 校验式读块：sha256 + 行数 + 首尾 seq 三重校验，任一不符 = 索引失效 */
  private async readBlockByEntry(sessionId: string, entry: BlockIndexEntry): Promise<BaseEvent[]> {
    const segPath = this.getSegmentPath(sessionId, entry.file);
    if (!existsSync(segPath)) throw new BlockIndexStaleError(`索引块文件缺失 ${entry.file}`);
    const buf = await readRange(segPath, entry.startByte, entry.endByte - entry.startByte);
    if (hashBuffer(buf) !== entry.hash) throw new BlockIndexStaleError(`块 hash 失配 ${entry.file}`);
    const parsed = parseLines(buf, null);
    if (parsed.gap || parsed.badTail) throw new BlockIndexStaleError(`块内容异常 ${entry.file}`);
    if (parsed.lines.length !== entry.eventCount) throw new BlockIndexStaleError(`块行数失配 ${entry.file}`);
    if (parsed.lines.length === 0) throw new BlockIndexStaleError(`空块 ${entry.file}`);
    const evs = parsed.lines.map((l) => l.ev);
    if (evs[0].seq !== entry.startSeq || evs[evs.length - 1].seq !== entry.endSeq) {
      throw new BlockIndexStaleError(`块 seq 范围失配 ${entry.file}`);
    }
    this.stats.bytesRead += buf.length;
    return evs;
  }

  /**
   * 链尾向右续扫新内容（活跃段追加 / rotate 后的新段），直到 stopSeq 命中
   * 或日志末尾。
   * @returns 新块列表（含事件，按链序）；空 = 右侧已无内容
   */
  private async extendRightOnce(
    sessionId: string,
    manifest: Manifest,
    blocks: BlockIndexEntry[],
    tail: BlockIndexEntry,
    stopSeq: number | undefined,
    pushRight: (entry: BlockIndexEntry) => void,
  ): Promise<LoadedBlock[]> {
    let segIdx = findSegmentIdx(manifest, tail.file);
    if (segIdx === -1) throw new BlockIndexStaleError(`链尾段 ${tail.file} 不在 manifest`);
    let absPos = tail.endByte;
    let expected: number | null = tail.endSeq + 1;
    const produced: LoadedBlock[] = [];
    for (;;) {
      const seg = manifest.segments[segIdx];
      const segPath = this.getSegmentPath(sessionId, seg.file);
      if (!existsSync(segPath)) return produced;
      const size = await fileSize(segPath);
      if (absPos >= size) {
        if (segIdx >= manifest.segments.length - 1) return produced;
        segIdx += 1;
        absPos = 0;
        expected = manifest.segments[segIdx].startSeq; // 新段头锚（rotate 事件占位）
        continue;
      }
      const buf = await readRange(segPath, absPos, size - absPos);
      const isLast = segIdx === manifest.segments.length - 1;
      const cut = this.cutBlocksFromBuffer(buf, seg.file, absPos, expected, isLast);
      if (cut.gap) throw new BlockIndexStaleError(`续扫 seq 缺口 ${seg.file}`);
      if (cut.tornTail && !isLast) throw new BlockIndexStaleError(`归档段坏行 ${seg.file}`);
      if (cut.loaded.length === 0) return produced;
      for (const l of cut.loaded) {
        pushRight(l.entry);
        produced.push(l);
      }
      this.stats.scans += 1;
      if (cut.tornTail) return produced;
      absPos = cut.endAbsByte;
      expected = cut.events[cut.events.length - 1].seq + 1;
      if (stopSeq !== undefined && cut.events.some((e) => e.seq >= stopSeq)) return produced;
    }
  }

  /** 链尾是否覆盖最后一段当前文件末尾（活跃段 append 后为 false → 触发续扫） */
  private async chainCoversLogTail(
    sessionId: string,
    manifest: Manifest,
    tail: BlockIndexEntry,
  ): Promise<boolean> {
    const lastSeg = manifest.segments[manifest.segments.length - 1];
    if (tail.file !== lastSeg.file) return false;
    const segPath = this.getSegmentPath(sessionId, lastSeg.file);
    if (!existsSync(segPath)) return true;
    return tail.endByte >= (await fileSize(segPath));
  }

  /** 链首是否覆盖日志起点（第一段 byte 0） */
  private chainCoversLogHead(manifest: Manifest, blocks: BlockIndexEntry[]): boolean {
    if (blocks.length === 0) return false;
    const head = blocks[0];
    return head.file === manifest.segments[0].file && head.startByte === 0;
  }

  /**
   * 链首向左扩一个 chunk 窗口（同段内窗口左扩，或跨段进入前一段尾部）。
   * @returns 新块列表（按链序，通常 1 块；单行超块扩窗可能多块）；null = 已覆盖日志起点
   */
  private async extendLeftAcrossSegment(
    sessionId: string,
    manifest: Manifest,
    head: BlockIndexEntry,
  ): Promise<LoadedBlock[] | null> {
    let segIdx = findSegmentIdx(manifest, head.file);
    if (segIdx === -1) throw new BlockIndexStaleError(`链首段 ${head.file} 不在 manifest`);
    let segFile = head.file;
    let rightByte = head.startByte;
    if (rightByte === 0) {
      if (segIdx === 0) return null; // 已覆盖日志起点
      segIdx -= 1;
      segFile = manifest.segments[segIdx].file;
      rightByte = await fileSize(this.getSegmentPath(sessionId, segFile));
    }
    const segPath = this.getSegmentPath(sessionId, segFile);
    const { buf, alignedStartRel } = await this.readAlignedWindowBackward(segPath, rightByte);
    const absStart = rightByte - buf.length + alignedStartRel;
    const cut = this.cutBlocksFromBuffer(buf.subarray(alignedStartRel), segFile, absStart, null, false);
    if (cut.gap || cut.tornTail || cut.loaded.length === 0) {
      throw new BlockIndexStaleError(`左扩窗口异常 ${segFile}`);
    }
    const last = cut.loaded[cut.loaded.length - 1];
    if (last.entry.endSeq + 1 !== head.startSeq) {
      throw new BlockIndexStaleError(`左扩块与链首 seq 不衔接 ${segFile}`);
    }
    this.stats.scans += 1;
    return cut.loaded;
  }

  /** 从 rightByte 向左取一个 chunk 窗口，起点对齐到行边界（单行超块时继续向左扩窗） */
  private async readAlignedWindowBackward(
    segPath: string,
    rightByte: number,
  ): Promise<{ buf: Buffer; alignedStartRel: number }> {
    let leftRaw = Math.max(0, rightByte - this.chunkBytes);
    for (;;) {
      const buf = await readRange(segPath, leftRaw, rightByte - leftRaw);
      if (leftRaw === 0) return { buf, alignedStartRel: 0 }; // 文件首行天然完整
      const nl = buf.indexOf(0x0a);
      if (nl !== -1) return { buf, alignedStartRel: nl + 1 }; // 丢弃首部半截行
      leftRaw = Math.max(0, leftRaw - this.chunkBytes); // 窗口内无行边界（单行超块）→ 扩窗
    }
  }

  /**
   * 行对齐 buffer → 按块累积切块（含 hash）。expectedSeq 非 null 做全局连续校验，
   * null 时块内自洽。torn 尾（末尾坏行）：isLast=true 时截断返回（坏行不进块），
   * false 时返回 tornTail=true 由调用方失效处理。
   */
  private cutBlocksFromBuffer(
    buf: Buffer,
    file: string,
    absStart: number,
    expectedSeq: number | null,
    isLast: boolean,
  ): {
    loaded: LoadedBlock[];
    events: BaseEvent[];
    endAbsByte: number;
    tornTail: boolean;
    gap: { expected: number; got: number } | null;
  } {
    const parsed = parseLines(buf, expectedSeq);
    if (parsed.gap) return { loaded: [], events: [], endAbsByte: absStart, tornTail: false, gap: parsed.gap };
    if (parsed.badTail && !isLast) {
      return { loaded: [], events: [], endAbsByte: absStart, tornTail: true, gap: null };
    }
    const loaded: LoadedBlock[] = [];
    let blockStart = parsed.lines[0]?.startRel ?? 0;
    let blockLines: ParsedLine[] = [];
    const flush = () => {
      if (blockLines.length === 0) return;
      const endRel = blockLines[blockLines.length - 1].endRel;
      const evs = blockLines.map((l) => l.ev);
      loaded.push({
        entry: {
          file,
          startByte: absStart + blockStart,
          endByte: absStart + endRel,
          startSeq: evs[0].seq,
          endSeq: evs[evs.length - 1].seq,
          eventCount: evs.length,
          hash: hashBuffer(buf.subarray(blockStart, endRel)),
        },
        events: evs,
      });
      blockLines = [];
      blockStart = endRel;
    };
    for (const ln of parsed.lines) {
      blockLines.push(ln);
      if (ln.endRel - blockStart >= this.chunkBytes) flush();
    }
    flush();
    const endAbsByte = absStart + (parsed.lines[parsed.lines.length - 1]?.endRel ?? 0);
    return { loaded, events: loaded.flatMap((l) => l.events), endAbsByte, tornTail: parsed.badTail, gap: null };
  }

  // ─── 路径工具（与 JsonlBackend 同构：sessions/<id>/ 平铺） ───

  private getSessionDir(sessionId: string): string {
    return path.join(this.basePath, sessionId);
  }

  private getSegmentPath(sessionId: string, file: string): string {
    return path.join(this.getSessionDir(sessionId), file);
  }

  private getIndexPath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'events.index.json');
  }

  private async readManifest(sessionId: string): Promise<Manifest> {
    const content = await fs.readFile(path.join(this.getSessionDir(sessionId), 'manifest.json'), 'utf-8');
    return JSON.parse(content) as Manifest;
  }

  private async writeIndex(sessionId: string, index: EventsBlockIndex): Promise<void> {
    const filePath = this.getIndexPath(sessionId);
    const tmpPath = `${filePath}.tmp`; // 与 manifest/snapshot 同款原子写
    await fs.writeFile(tmpPath, JSON.stringify(index), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }
}

function findSegmentIdx(manifest: Manifest, file: string): number {
  return manifest.segments.findIndex((s) => s.file === file);
}

function findLastIdx<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

/** 索引块文件序列必须是 manifest 段文件序列的保序子序列（会话重建/改写时失序 → 失效） */
function assertIndexWithinManifest(index: EventsBlockIndex, manifest: Manifest): void {
  let mi = 0;
  for (const b of index.blocks) {
    while (mi < manifest.segments.length && manifest.segments[mi].file !== b.file) mi += 1;
    if (mi === manifest.segments.length) {
      throw new BlockIndexStaleError(`索引段 ${b.file} 不在 manifest（会话可能已重建）`);
    }
  }
}
