import { Inject, Injectable, Logger } from "@nestjs/common";
import { KbDatabaseService } from "./kb-database.service";
import { KbDbAccess } from "./kb-file.repository";
import {
  META_VEC_CURSOR,
  META_VEC_DIM,
  VEC_BATCH_SIZE,
  countEmbeddedChunks,
  countIndexedVectors,
  createVecTable,
  declaredVecDim,
  deleteMeta,
  dropVecTable,
  ensureMetaTable,
  insertVector,
  probeEmbeddingDimension,
  selectMissingVectors,
  vecTableExists,
  writeMeta,
} from "./kb-vector-index";

/** 回填结果。调用方据 `state` 决定检索走 vec0 还是回退全表扫描。 */
export type EnsureIndexResult =
  | { state: "ready"; dim: number; indexed: number }
  /** 库里还没有任何向量（新建库 / 刚换模型还没重处理完）——不需要索引 */
  | { state: "empty" }
  /** 单库内存在多种维度，无法用一张 vec0 表承载；拒绝建索引，检索回退 */
  | { state: "inconsistent-dimension"; dims: number[] }
  /** 回填后计数仍不匹配（并发写入、库损坏等）；检索回退 */
  | { state: "failed"; reason: string };

/** 回填最多扫几遍。正常一遍到底；多遍用于覆盖"水位以下被插入"的极端情况。 */
const MAX_BACKFILL_PASSES = 3;

/**
 * 知识库向量索引生命周期（vec0）。
 *
 * ## 职责边界
 *
 * 本服务**独占**索引的结构性变更（建表 / drop / 重建）。写路径（`KBChunkRepository`）
 * 只做保守的"能写就写"（见 `prepareVecTableForWrite`），从不动结构。这样避免两条路径
 * 在"混合维度"这类异常态下互相拆台。
 *
 * ## 为什么是懒触发而不是启动期全量
 *
 * 启动期对每个库建索引 + 回填会把 `onModuleInit` 拖长，且大量库时 LRU 会被反复击穿。
 * 改为：**检索路径发现索引未就绪时，异步触发一次 `ensureIndex`，本次检索回退到全表扫描**
 * （慢但结果正确），下次检索就用上索引。这样升级后的首次访问不会卡，且能自愈。
 *
 * ## 回填不调任何外部 API
 *
 * 它只是把 `chunk.embedding` 里已有的 BLOB 复制进 vec0 表，纯本地操作、零成本。
 * 这一点很重要：用户明确不希望为了改造而重新调用嵌入模型（那是要花钱的）。
 */
@Injectable()
export class KbVectorIndexService {
  private readonly logger = new Logger(KbVectorIndexService.name);

  /** 每库进行中的 ensureIndex（去重，避免并发触发重复回填） */
  private readonly inflight = new Map<string, Promise<EnsureIndexResult>>();
  /** 已经告警过的原因，避免同一问题刷屏 */
  private readonly warned = new Map<string, string>();

  constructor(
    // 显式 token：形参类型是接口（KbDbAccess），运行期被擦除，Nest 会解析成 Object 而失败
    @Inject(KbDatabaseService) private readonly databases: KbDbAccess,
  ) {}

  /**
   * 索引是否就绪（廉价检查，**无副作用**，检索路径每次调用）。
   *
   * 判定用「计数比对」而不是水位/标志位：
   * - 自愈：任何原因导致索引与分块不一致，都会被判定为未就绪并触发重建
   * - 不需要维护额外的状态机，也不会因状态位与实际数据脱节而误判
   *
   * 注意 SQLite 的 rowid 会复用（表清空后从 1 重新分配），所以**不能用 rowid 水位
   * 做就绪判定**——那样在"全删后重建"的场景会误判为就绪。
   */
  async isReady(kbId: string): Promise<boolean> {
    try {
      await this.databases.ready();
      const db = await this.databases.getDb(kbId);
      if (!vecTableExists(db)) return false;
      const embedded = countEmbeddedChunks(db);
      if (embedded === 0) return false;
      return countIndexedVectors(db) === embedded;
    } catch (err: any) {
      this.logger.debug(`索引就绪检查失败（按未就绪处理）${kbId}: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * 幂等确保索引存在且与分块对齐。并发调用会复用同一个进行中的任务。
   *
   * 结构变更（维度不符 → drop 重建）在这里发生，写路径不碰结构。
   */
  async ensureIndex(kbId: string): Promise<EnsureIndexResult> {
    const existing = this.inflight.get(kbId);
    if (existing) return existing;

    const task = this.runEnsure(kbId).finally(() => this.inflight.delete(kbId));
    this.inflight.set(kbId, task);
    return task;
  }

  /** 丢弃索引（换嵌入模型后调用；下一次写入会按新维度重建） */
  async dropIndex(kbId: string): Promise<void> {
    try {
      const db = await this.databases.getDb(kbId);
      db.transaction(() => {
        dropVecTable(db);
        ensureMetaTable(db);
        deleteMeta(db, META_VEC_DIM);
        writeMeta(db, META_VEC_CURSOR, "0");
      })();
      this.warned.delete(kbId);
      this.logger.log(`已丢弃知识库向量索引 ${kbId}（下次写入将按新维度重建）`);
    } catch (err: any) {
      this.logger.warn(`丢弃向量索引失败 ${kbId}: ${err?.message || err}`);
    }
  }

  /** 进行中的回填数（测试与诊断用） */
  inflightCount(): number {
    return this.inflight.size;
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private async runEnsure(kbId: string): Promise<EnsureIndexResult> {
    await this.databases.ready();

    const probe = probeEmbeddingDimension(await this.databases.getDb(kbId));
    if (probe.kind === "none") return { state: "empty" };
    if (probe.kind === "inconsistent") {
      this.warnOnce(
        kbId,
        `inconsistent:${probe.dims.join(",")}`,
        `知识库 ${kbId} 内存在多种向量维度（${probe.dims.join(", ")}），无法建立向量索引；` +
          `检索将回退为全表扫描（结果正确但较慢）。这通常是上次更换嵌入模型的重处理被中断所致，` +
          `建议对该库执行一次"重新处理"。`,
      );
      return { state: "inconsistent-dimension", dims: probe.dims };
    }

    const dim = probe.dim;
    await this.alignTableStructure(kbId, dim);
    const ok = await this.backfill(kbId);

    const db = await this.databases.getDb(kbId);
    const indexed = countIndexedVectors(db);
    const embedded = countEmbeddedChunks(db);

    if (ok && indexed === embedded) {
      this.logger.log(`向量索引就绪 ${kbId}：dim=${dim}, indexed=${indexed}`);
      this.warned.delete(kbId);
      return { state: "ready", dim, indexed };
    }
    const reason = `indexed=${indexed} embedded=${embedded}`;
    this.warnOnce(kbId, `failed:${reason}`, `知识库 ${kbId} 向量索引回填未完成（${reason}）`);
    return { state: "failed", reason };
  }

  /** 表不存在或维度不符 → drop 重建（结构性变更只在这里发生） */
  private async alignTableStructure(kbId: string, dim: number): Promise<void> {
    const db = await this.databases.getDb(kbId);
    const declared = declaredVecDim(db);
    if (vecTableExists(db) && declared === dim) {
      ensureMetaTable(db);
      writeMeta(db, META_VEC_DIM, String(dim));
      return;
    }
    db.transaction(() => {
      dropVecTable(db);
      ensureMetaTable(db);
      createVecTable(db, dim);
      writeMeta(db, META_VEC_DIM, String(dim));
      writeMeta(db, META_VEC_CURSOR, "0");
    })();
    this.logger.log(
      declared === null
        ? `已为知识库 ${kbId} 建立向量索引（dim=${dim}）`
        : `知识库 ${kbId} 向量维度由 ${declared} 变为 ${dim}，已重建索引`,
    );
  }

  /**
   * 分批回填，批间让出事件循环。
   *
   * 每批都重新 `getDb`：一是刷新 LRU 时间戳让本库不被淘汰，二是万一被淘汰重建了句柄，
   * 也不会继续往一个已关闭的连接上写（那会抛 "The database connection is not open"）。
   */
  private async backfill(kbId: string): Promise<boolean> {
    let cursor = 0;

    for (let pass = 0; pass < MAX_BACKFILL_PASSES; pass++) {
      let inserted = 0;

      for (;;) {
        const db = await this.databases.getDb(kbId);
        const rows = selectMissingVectors(db, cursor, VEC_BATCH_SIZE);
        if (rows.length === 0) break;

        db.transaction(() => {
          for (const row of rows) insertVector(db, row.rowid, row.embedding);
        })();

        inserted += rows.length;
        cursor = rows[rows.length - 1].rowid;
        writeMeta(db, META_VEC_CURSOR, String(cursor));

        // 让出事件循环：单批 1000 行是同步事务，不让出会阻塞其他请求
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const db = await this.databases.getDb(kbId);
      if (countIndexedVectors(db) === countEmbeddedChunks(db)) return true;
      if (inserted === 0) return false; // 扫完了但计数仍不等，再扫也无用
      cursor = 0; // 计数仍不等 → 可能在水位以下又插入了行，再扫一遍
    }
    return false;
  }

  private warnOnce(kbId: string, key: string, message: string): void {
    if (this.warned.get(kbId) === key) return;
    this.warned.set(kbId, key);
    this.logger.warn(message);
  }
}
