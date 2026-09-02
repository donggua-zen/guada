/**
 * JSONL 持久化 — 文件后端实现
 * PoC 阶段：最小可用版本
 */

import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  BaseEvent,
  Manifest,
  PersistenceBackend,
  SessionMeta,
  SegmentMeta,
  SEGMENT_COMPACTION_COUNT,
} from './types';
import { CorruptSessionLogError } from './errors';

interface ActiveSegment {
  file: string;
  startSeq: number;
  endSeq: number | null;
  compactionCount: number;
  /** 段累计写入字节(append 时累加,分卷判断依据) */
  bytes: number;
}

@Injectable()
export class JsonlBackend implements PersistenceBackend {
  private readonly logger = new Logger(JsonlBackend.name);
  private basePath: string;

  // 内存缓存活跃段信息（避免频繁读 manifest）
  private activeSegments = new Map<string, ActiveSegment>();

  constructor() {
    // 会话数据根目录解析：
    // 1. 显式 SESSION_DATA_DIR 环境变量
    // 2. USERDATA_DIR（Electron 数据根目录，如 ~/.guada/）→ 存 <USERDATA_DIR>/sessions
    // 3. 由 UPLOAD_ROOT_DIR 的父目录派生（Electron 为 <dataHome>/file_stores → <dataHome>）
    // 4. 默认 ./data/sessions
    const explicit = process.env.SESSION_DATA_DIR;
    const userData = process.env.USERDATA_DIR;
    const uploadRoot = process.env.UPLOAD_ROOT_DIR;
    if (explicit) {
      this.basePath = path.join(explicit, 'sessions');
    } else if (userData) {
      this.basePath = path.join(userData, 'sessions');
    } else if (uploadRoot) {
      this.basePath = path.join(path.dirname(uploadRoot), 'sessions');
    } else {
      this.basePath = path.join(process.cwd(), 'data', 'sessions');
    }
  }

  // ─── 路径工具 ───

  private getSessionDir(sessionId: string): string {
    return path.join(this.basePath, sessionId);
  }

  private getSegmentPath(sessionId: string, file: string): string {
    return path.join(this.getSessionDir(sessionId), file);
  }

  private getManifestPath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'manifest.json');
  }

  private getActiveSegmentFile(sessionId: string): string {
    const seg = this.activeSegments.get(sessionId);
    return seg ? seg.file : 'seg-0000.jsonl';
  }

  // ─── 会话 ───

  async createSession(sessionId: string, meta?: Partial<SessionMeta>): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    await fs.mkdir(dir, { recursive: true });

    // 初始化活跃段（内存态）
    this.activeSegments.set(sessionId, {
      file: 'seg-0000.jsonl',
      startSeq: 0,
      endSeq: null,
      compactionCount: 0,
      bytes: 0,
    });

    // 写入 session/init 事件（'wx' 独占创建，幂等）：
    // - 文件已存在（并发兜底 / 半初始化恢复 / 重建 manifest）→ EEXIST 跳过，绝不重复写：
    //   重复的 seq=0 init 会被 seq 连续性校验判为缺口，会话将永久无法加载；
    // - 独占创建本身即原子检查点：即使调用方未串行化，也只有一个调用者能写出 init。
    const segPath = this.getSegmentPath(sessionId, 'seg-0000.jsonl');
    const initLine =
      JSON.stringify({
        type: 'session/init',
        seq: 0,
        time: Date.now(),
        data: { sessionId, title: meta?.title ?? '新对话' },
      }) + '\n';
    try {
      await fs.writeFile(segPath, initLine, { flag: 'wx', encoding: 'utf-8' });
      const seg = this.activeSegments.get(sessionId);
      if (seg) seg.bytes = Buffer.byteLength(initLine, 'utf-8');
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
    }

    // manifest 最后写：hasSession()（= manifest 存在）为 true 时保证 init 已落盘，
    // 消除“manifest 在而 init 缺失”的半初始化窗口
    const initialSeg: SegmentMeta = {
      file: 'seg-0000.jsonl',
      startSeq: 0,
      endSeq: null,
      status: 'active',
    };
    const manifest: Manifest = {
      sessionId,
      version: 1,
      createdAt: new Date().toISOString(),
      segments: [initialSeg],
      compactionBoundaries: [],
    };
    await this.writeManifest(sessionId, manifest);
  }

  async getSession(sessionId: string): Promise<SessionMeta | null> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest) return null;
    return {
      id: manifest.sessionId,
      createdAt: manifest.createdAt,
    };
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return existsSync(this.getManifestPath(sessionId));
  }

  /**
   * 删除整个会话目录（manifest + 全部分卷）。
   * 用于"清空会话"：事件溯源下直接物理删除，不做 delete 事件重放。
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.activeSegments.delete(sessionId);
    const dir = this.getSessionDir(sessionId);
    await fs.rm(dir, { recursive: true, force: true });
    this.logger.log(`[jsonl] deleted session dir: ${sessionId}`);
  }

  /**
   * 列出所有已存在的会话 ID（扫描 manifest 文件）
   */
  async listSessionIds(): Promise<string[]> {
    if (!existsSync(this.basePath)) return [];
    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(this.basePath, entry.name, 'manifest.json');
        if (existsSync(manifestPath)) {
          ids.push(entry.name);
        }
      }
    }
    return ids;
  }

  // ─── 事件 ───

  async appendEvent(sessionId: string, event: BaseEvent): Promise<void> {
    const file = this.getActiveSegmentFile(sessionId);
    const filePath = this.getSegmentPath(sessionId, file);

    // append-only 写入
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');

    // 更新活跃段
    const seg = this.activeSegments.get(sessionId);
    if (seg) {
      seg.endSeq = event.seq;
      seg.bytes += Buffer.byteLength(line, 'utf-8');
    }
  }

  async appendEvents(sessionId: string, events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return;
    const file = this.getActiveSegmentFile(sessionId);
    const filePath = this.getSegmentPath(sessionId, file);

    const lines = events.map(e => JSON.stringify(e) + '\n').join('');
    await fs.appendFile(filePath, lines, 'utf-8');

    const seg = this.activeSegments.get(sessionId);
    if (seg) {
      seg.endSeq = events[events.length - 1].seq;
      seg.bytes += Buffer.byteLength(lines, 'utf-8');
    }
  }

  async readEvents(sessionId: string, fromSeq = 0): Promise<BaseEvent[]> {
    const file = this.getActiveSegmentFile(sessionId);
    const filePath = this.getSegmentPath(sessionId, file);

    if (!existsSync(filePath)) return [];

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    const events: BaseEvent[] = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as BaseEvent;
        if (event.seq >= fromSeq) {
          events.push(event);
        }
      } catch (e) {
        this.logger.warn(`Parse error in ${filePath}: ${e}`);
      }
    }
    return events;
  }

  async getAllEvents(sessionId: string): Promise<BaseEvent[]> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest) return [];

    const allEvents: BaseEvent[] = [];
    let expectedSeq = 0;
    const segments = manifest.segments;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const isActive = seg.status === 'active' || isLast;
      const filePath = this.getSegmentPath(sessionId, seg.file);
      if (!existsSync(filePath)) continue;

      const { events, truncateTo, gap } = await this.scanSegmentFile(filePath, expectedSeq);
      this.assertScanClean(sessionId, seg.file, isActive, truncateTo, gap);

      allEvents.push(...events);
      if (events.length > 0) expectedSeq = events[events.length - 1].seq + 1;
      // 活跃段 torn 尾：截断事件已返回（坏行及之后忽略，不抛错；修复由冷加载路径负责）
      if (truncateTo != null) break;
    }
    return allEvents;
  }

  /**
   * 从指定 seq 起读跨卷增量事件（含首条）。
   *
   * 按 manifest 段 startSeq/endSeq 定位 fromSeq 所在段（活跃段 endSeq=null 用实际末条 seq）：
   * - fromSeq 落在某段内（段内 seq 连续）→ 从该段内 fromSeq 起读 + 后续所有段
   * - fromSeq 恰在分卷边界（= 下一段 startSeq）→ 直接读下一段起
   * - fromSeq 超过全部段末尾（快照即最新）→ 返回空数组（合法：无后续事件）
   * 用于恢复路径：快照 + readEventsFrom(snapshotSeq + 1)。
   * 严格性：seq 缺口 / 归档段坏行 → CorruptSessionLogError；活跃段 torn 尾 → 返回截断事件。
   */
  async readEventsFrom(sessionId: string, fromSeq: number): Promise<BaseEvent[]> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest) return [];

    const result: BaseEvent[] = [];
    let expectedSeq = 0;
    let started = false;
    const segments = manifest.segments;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const isActive = seg.status === 'active' || isLast;
      const filePath = this.getSegmentPath(sessionId, seg.file);
      if (!existsSync(filePath)) continue;

      const { events, truncateTo, gap } = await this.scanSegmentFile(filePath, expectedSeq);
      this.assertScanClean(sessionId, seg.file, isActive, truncateTo, gap);

      if (events.length > 0) expectedSeq = events[events.length - 1].seq + 1;

      if (!started) {
        const endSeq = events.length > 0
          ? events[events.length - 1].seq
          : (seg.endSeq ?? Number.POSITIVE_INFINITY);
        const contains = seg.startSeq <= fromSeq && fromSeq <= endSeq;
        if (!contains) continue; // fromSeq 在本段之后
        // 段内从 fromSeq 起（seq 连续；首条可能是本段 session/rotate，seq 通常 < fromSeq 会被 findIndex 跳过）
        const fromIdx = events.findIndex(e => e.seq >= fromSeq);
        if (fromIdx !== -1) result.push(...events.slice(fromIdx));
        started = true;
      } else {
        result.push(...events);
      }

      // 活跃段 torn 尾：截断事件已返回；活跃段是最后一段，结束
      if (truncateTo != null) break;
    }

    return result;
  }

  /**
   * 扫描活跃段（供冷加载修复用）：返回事件 + torn 截断点 + seq 缺口信息。
   * gap 非空 = 硬损坏（调用方应抛 CorruptSessionLogError）；truncateTo 非空 = 可修复 torn 尾。
   */
  async scanActiveSegment(
    sessionId: string,
  ): Promise<{
    events: BaseEvent[];
    truncateTo: number | null;
    gap: { expected: number; got: number } | null;
  }> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    const active = manifest?.segments.find(s => s.status === 'active')
      ?? manifest?.segments[manifest.segments.length - 1];
    if (!active) return { events: [], truncateTo: null, gap: null };
    const filePath = this.getSegmentPath(sessionId, active.file);
    if (!existsSync(filePath)) return { events: [], truncateTo: null, gap: null };
    return this.scanSegmentFile(filePath, active.startSeq);
  }

  /**
   * 扫描单个段文件：逐行解析并校验 seq 连续性（段内从 firstSeq 起连续）。
   * @returns events 已解析事件（遇坏行/缺口时仅含此前完整部分）
   * @returns truncateTo 坏行截断点（最后一个完整行末尾字节偏移）；无坏行为 null
   * @returns gap 非空表示 seq 缺口（expected 期望、got 实际）
   */
  private async scanSegmentFile(
    filePath: string,
    firstSeq: number,
  ): Promise<{
    events: BaseEvent[];
    truncateTo: number | null;
    gap: { expected: number; got: number } | null;
  }> {
    if (!existsSync(filePath)) return { events: [], truncateTo: null, gap: null };

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const events: BaseEvent[] = [];
    let lastSeq = firstSeq - 1;
    let lastGoodEnd = 0;
    let byteOffset = 0;

    for (const line of lines) {
      if (line.length === 0) {
        byteOffset += 1; // 尾部空串（文件以 \n 结尾）
        continue;
      }
      const lineLen = Buffer.byteLength(line, 'utf-8');
      try {
        const ev = JSON.parse(line) as BaseEvent;
        if (ev.seq !== lastSeq + 1) {
          // seq 缺口：整消息粒度下中间事件物理丢失，无法安全修复 → 由调用方抛错
          return { events, truncateTo: null, gap: { expected: lastSeq + 1, got: ev.seq } };
        }
        events.push(ev);
        lastSeq = ev.seq;
      } catch {
        // 坏行（torn 尾）：坏行前 seq 连续即无损，截断点 = 最后一个完整行末尾
        return { events, truncateTo: lastGoodEnd, gap: null };
      }
      lastGoodEnd = byteOffset + lineLen + 1;
      byteOffset = lastGoodEnd;
    }

    return { events, truncateTo: null, gap: null };
  }

  /** 扫描结果严格性断言：seq 缺口 / 归档段坏行 → 拒绝加载 */
  private assertScanClean(
    sessionId: string,
    file: string,
    isActive: boolean,
    truncateTo: number | null,
    gap: { expected: number; got: number } | null,
  ): void {
    if (gap) {
      throw new CorruptSessionLogError(
        `会话日志损坏：${file} 存在 seq 缺口（期望 ${gap.expected}，实际 ${gap.got}）。` +
          `整消息粒度下缺口=数据丢失，拒绝加载。`,
        { sessionId, file, expectedSeq: gap.expected, gotSeq: gap.got },
      );
    }
    if (truncateTo != null && !isActive) {
      throw new CorruptSessionLogError(
        `会话日志损坏：归档段 ${file} 存在坏行。历史分卷应完整，坏行=已提交区损坏，拒绝加载。`,
        { sessionId, file },
      );
    }
  }

  /**
   * 物理截断活跃段到指定字节偏移（修复 torn 尾后调用），并同步内存活跃段状态。
   * 仅允许在无活跃写入的冷加载路径使用。
   */
  async truncateActiveSegment(
    sessionId: string,
    truncateTo: number,
    lastSeq: number,
    bytes: number,
  ): Promise<void> {
    const file = this.getActiveSegmentFile(sessionId);
    const filePath = this.getSegmentPath(sessionId, file);
    await fs.truncate(filePath, truncateTo);
    const seg = this.activeSegments.get(sessionId);
    if (seg) {
      seg.endSeq = lastSeq;
      seg.bytes = bytes;
    }
    this.logger.warn(
      `[jsonl] truncated active segment ${file} of ${sessionId} to ${truncateTo} bytes (torn tail repair, lastSeq=${lastSeq})`,
    );
  }

  // ─── 分卷 ───

  async splitSegment(sessionId: string): Promise<void> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest) return;

    const seg = this.activeSegments.get(sessionId);
    if (!seg) return;

    // 移除原 active 条目（segments 中应只有一条 active；不移除会导致同一文件被记录两次，
    // getAllEvents/readEventsFrom 重复读同一段事件）
    const oldActiveIdx = manifest.segments.findIndex((s) => s.status === 'active');
    if (oldActiveIdx !== -1) manifest.segments.splice(oldActiveIdx, 1);

    // 归档当前段(记录字节)
    const archivedMeta: SegmentMeta = {
      file: seg.file,
      startSeq: seg.startSeq,
      endSeq: seg.endSeq,
      status: 'archived',
      compactedAt: new Date().toISOString(),
      bytes: seg.bytes,
    };
    manifest.segments.push(archivedMeta);

    // 开新段（文件名索引 = 当前段数，移除旧 active 后连续）
    const newSegIndex = manifest.segments.length;
    const newFile = `seg-${String(newSegIndex).padStart(4, '0')}.jsonl`;
    const newStartSeq = (seg.endSeq ?? 0) + 1;
    const newSeg: ActiveSegment = {
      file: newFile,
      startSeq: newStartSeq,
      endSeq: null,
      compactionCount: 0,
      bytes: 0,
    };
    this.activeSegments.set(sessionId, newSeg);

    // 立即写 session/rotate 到新段,携带 seq(新段首条 = 分卷边界 + 1):
    // 新段天然有落盘 seq 基准,恢复时 getNextSeq = 活跃段最后 seq + 1 永不空。
    await this.appendEvent(sessionId, {
      type: 'session/rotate',
      seq: newStartSeq,
      time: Date.now(),
      data: { from: archivedMeta.file, to: newFile, boundarySeq: seg.endSeq ?? 0 },
    });

    // 新活跃段也加入 manifest(端 seq 由 appendEvent 更新到内存,manifest 保持 null 直到下次归档)
    manifest.segments.push({
      file: newFile,
      startSeq: newStartSeq,
      endSeq: null,
      status: 'active',
    });

    await this.writeManifest(sessionId, manifest);
  }

  async readManifest(sessionId: string): Promise<Manifest> {
    const filePath = this.getManifestPath(sessionId);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Manifest;
  }

  async writeManifest(sessionId: string, manifest: Manifest): Promise<void> {
    const filePath = this.getManifestPath(sessionId);
    const tmpPath = filePath + '.tmp';

    // 原子写入：先写临时文件再 rename
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  // ─── 快照 ───

  /**
   * 写状态快照(原子:先写临时文件再 rename,避免写一半废了)。
   * 快照 seq 仅用于恢复时校验衔接(活跃段首条 seq === snapshotSeq + 1),不用于跳读。
   * 只保留一份(永远用最新的,旧快照覆盖)。
   * version=2：扁平消息 surface（ReplayState.messages/turnMeta）；旧 version=1（三层 turns）快照
   * 由 rebuildState 形状守卫回退全量重放（数据重新转换导入，不做兼容迁移）。
   */
  async writeSnapshot(
    sessionId: string,
    snapshotSeq: number,
    state: unknown,
  ): Promise<void> {
    const file = 'snapshot.json';
    const filePath = this.getSegmentPath(sessionId, file);
    const tmpPath = filePath + '.tmp';
    const snapshot = {
      version: 2,
      sessionId,
      snapshotSeq,
      createdAt: new Date().toISOString(),
      state,
    };

    // 1. 先写快照成功
    await fs.writeFile(tmpPath, JSON.stringify(snapshot), 'utf-8');
    await fs.rename(tmpPath, filePath);

    // 2. 再标记 manifest.snapshot(先快照成功,才允许后续分卷逻辑引用它)
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (manifest) {
      manifest.snapshot = { file, seq: snapshotSeq };
      await this.writeManifest(sessionId, manifest);
    }
  }

  /**
   * 读状态快照。返回 null 表示无快照(回退全量重放)。
   */
  async readSnapshot(
    sessionId: string,
  ): Promise<{ snapshotSeq: number; state: unknown } | null> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest?.snapshot) return null;
    const filePath = this.getSegmentPath(sessionId, manifest.snapshot.file);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    const snapshot = JSON.parse(content) as { snapshotSeq: number; state: unknown };
    return { snapshotSeq: snapshot.snapshotSeq, state: snapshot.state };
  }

  /**
   * 当前活跃段信息(供分卷判断:bytes 超阈值触发 snapshotThenSplit)
   */
  async getActiveSegmentInfo(
    sessionId: string,
  ): Promise<{ file: string; endSeq: number | null; bytes: number } | null> {
    const seg = this.activeSegments.get(sessionId);
    if (!seg) return null;
    return { file: seg.file, endSeq: seg.endSeq, bytes: seg.bytes };
  }

  /**
   * 从 manifest 确定活跃段文件(重启后内存 activeSegments 为空时仍可靠)。
   */
  private async getActiveSegmentFileFromManifest(
    sessionId: string,
  ): Promise<string | null> {
    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (!manifest) return null;
    const active = manifest.segments.find((s) => s.status === 'active');
    return active?.file ?? null;
  }

  /**
   * 读活跃段全部事件(恢复路径:快照 + 活跃段增量)。
   * 按 manifest 定位活跃段文件,不依赖内存缓存(重启安全)。
   */
  async readActiveSegmentEvents(sessionId: string): Promise<BaseEvent[]> {
    const file = await this.getActiveSegmentFileFromManifest(sessionId);
    if (!file) return [];
    const filePath = this.getSegmentPath(sessionId, file);
    if (!existsSync(filePath)) return [];

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const events: BaseEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as BaseEvent);
      } catch (e) {
        this.logger.warn(`Parse error in ${filePath}: ${e}`);
      }
    }
    return events;
  }

  // ─── 工具方法 ───

  /**
   * 获取下一个 seq
   */
  async getNextSeq(sessionId: string): Promise<number> {
    const seg = this.activeSegments.get(sessionId);
    if (!seg) return 0;
    return (seg.endSeq ?? 0) + 1;
  }

  /**
   * 记录一次 compaction（达到阈值后自动分卷）。
   * 仅记录边界 seq（compactionBoundaries 只写不读，遮蔽信息由事件流承载，不在此重复）。
   */
  async recordCompaction(sessionId: string): Promise<void> {
    const seg = this.activeSegments.get(sessionId);
    if (!seg) return;

    seg.compactionCount++;

    const manifest = await this.readManifest(sessionId).catch(() => null);
    if (manifest) {
      manifest.compactionBoundaries.push({
        seq: await this.getNextSeq(sessionId),
      });
      await this.writeManifest(sessionId, manifest);
    }

    // 达到阈值 → 分卷
    if (seg.compactionCount >= SEGMENT_COMPACTION_COUNT) {
      await this.splitSegment(sessionId);
    }
  }
}
