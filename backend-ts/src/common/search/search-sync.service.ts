/**
 * 搜索索引同步服务
 *
 * 后台定时从主业务库 (Prisma) 增量同步消息内容到搜索索引库 (FTS5)。
 * 仿 ProcessManagerService 的 setInterval 模式。
 *
 * 同步策略：
 * 1. 首次运行（无 last_synced_at）→ 全量回填，分批处理
 * 2. 增量同步 → 仅处理 updatedAt > last_synced_at 的记录
 * 3. 孤儿清理 → 删除 FTS 中已不存在于业务库的 message_id
 *
 * 仅索引非空内容（过滤 AI 工具调用轮次的空 content）。
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { SearchIndexService } from "./search-index.service";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
const INITIAL_DELAY_MS = 10 * 1000; // 启动后 10 秒首次运行
const BATCH_SIZE = 500;
const META_KEY_LAST_SYNC = "last_synced_at";

interface MessageContentRow {
  id: string;
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class SearchSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchSyncService.name);
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private searchIndex: SearchIndexService,
  ) {}

  onModuleInit() {
    // 延迟首次运行，避免与启动流程竞争
    this.syncTimer = setTimeout(() => {
      this.runSync();
      // 首次完成后切换为定时器
      this.syncTimer = setInterval(() => this.runSync(), SYNC_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    this.logger.log(
      `搜索索引同步已调度: 首次延迟 ${INITIAL_DELAY_MS / 1000}s, 间隔 ${SYNC_INTERVAL_MS / 1000 / 60}min`,
    );
  }

  onModuleDestroy() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      clearInterval(this.syncTimer as any);
      this.syncTimer = null;
    }
  }

  /**
   * 执行一次同步周期
   */
  private async runSync(): Promise<void> {
    if (this.isSyncing) {
      this.logger.debug("上一次同步仍在进行中，跳过");
      return;
    }

    this.isSyncing = true;
    try {
      const lastSyncedAt = this.searchIndex.getSyncMeta(META_KEY_LAST_SYNC);

      if (!lastSyncedAt) {
        await this.fullBackfill();
      } else {
        await this.incrementalSync(lastSyncedAt);
        await this.cleanupOrphans();
      }
    } catch (error: any) {
      this.logger.error(`搜索索引同步失败: ${error.message}`, error.stack);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 全量回填 — 首次运行时同步所有历史消息
   */
  private async fullBackfill(): Promise<void> {
    this.logger.log("开始全量回填搜索索引...");

    let offset = 0;
    let totalIndexed = 0;

    while (true) {
      const rows = await this.fetchMessageContents(offset, BATCH_SIZE, null);

      if (rows.length === 0) break;

      const entries = rows
        .filter((r) => r.content && r.content.trim())
        .map((r) => ({
          messageId: r.message_id,
          sessionId: r.session_id,
          role: r.role,
          content: r.content,
          createdAt: r.created_at,
        }));

      if (entries.length > 0) {
        this.searchIndex.upsertBatch(entries);
        totalIndexed += entries.length;
      }

      offset += rows.length;

      if (rows.length < BATCH_SIZE) break;
    }

    // 记录当前时间作为同步点
    const now = new Date().toISOString();
    this.searchIndex.setSyncMeta(META_KEY_LAST_SYNC, now);

    this.logger.log(`全量回填完成: 共索引 ${totalIndexed} 条消息内容`);
  }

  /**
   * 增量同步 — 仅处理 updatedAt > lastSyncedAt 的记录
   */
  private async incrementalSync(lastSyncedAt: string): Promise<void> {
    let offset = 0;
    let totalSynced = 0;

    while (true) {
      const rows = await this.fetchMessageContents(offset, BATCH_SIZE, lastSyncedAt);

      if (rows.length === 0) break;

      const entries = rows
        .filter((r) => r.content && r.content.trim())
        .map((r) => ({
          messageId: r.message_id,
          sessionId: r.session_id,
          role: r.role,
          content: r.content,
          createdAt: r.created_at,
        }));

      if (entries.length > 0) {
        this.searchIndex.upsertBatch(entries);
        totalSynced += entries.length;
      }

      offset += rows.length;

      if (rows.length < BATCH_SIZE) break;
    }

    // 更新同步时间戳
    const now = new Date().toISOString();
    this.searchIndex.setSyncMeta(META_KEY_LAST_SYNC, now);

    if (totalSynced > 0) {
      this.logger.log(`增量同步完成: 更新 ${totalSynced} 条`);
    }
  }

  /**
   * 清理孤儿记录 — FTS 中存在但业务库已删除的 message_id
   */
  private async cleanupOrphans(): Promise<void> {
    // 获取 FTS 中所有 message_id
    const indexedIds = this.searchIndex.getAllIndexedMessageIds();
    if (indexedIds.size === 0) return;

    // 分批检查业务库中是否仍存在
    const batchSize = 1000;
    const idArray = Array.from(indexedIds);
    let orphanCount = 0;

    for (let i = 0; i < idArray.length; i += batchSize) {
      const batch = idArray.slice(i, i + batchSize);

      const existing = await this.prisma.messageContent.findMany({
        where: { id: { in: batch } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((e) => e.id));

      for (const id of batch) {
        if (!existingIds.has(id)) {
          this.searchIndex.deleteByMessage(id);
          orphanCount++;
        }
      }
    }

    if (orphanCount > 0) {
      this.logger.log(`清理孤儿索引: 删除 ${orphanCount} 条`);
    }
  }

  /**
   * 从业务库查询消息内容（JOIN message 获取 session_id 和 role）
   *
   * @param offset 分页偏移
   * @param limit 批次大小
   * @param sinceUpdatedAt 仅返回 updatedAt > 此值 的记录（null = 全量）
   */
  private async fetchMessageContents(
    offset: number,
    limit: number,
    sinceUpdatedAt: string | null,
  ): Promise<MessageContentRow[]> {
    // 使用 raw SQL 高效 JOIN，避免 Prisma 的 N+1 查询
    if (sinceUpdatedAt) {
      return this.prisma.$queryRawUnsafe<MessageContentRow[]>(
        `SELECT
           mc.id,
           mc.message_id,
           m.session_id,
           m.role,
           mc.content,
           mc.created_at,
           mc.updated_at
         FROM message_content mc
         INNER JOIN message m ON mc.message_id = m.id
         WHERE mc.updated_at > ?
           AND mc.content IS NOT NULL
           AND m.role IN ('user', 'assistant')
         ORDER BY mc.updated_at ASC
         LIMIT ? OFFSET ?`,
        sinceUpdatedAt,
        limit,
        offset,
      );
    }

    return this.prisma.$queryRawUnsafe<MessageContentRow[]>(
      `SELECT
         mc.id,
         mc.message_id,
         m.session_id,
         m.role,
         mc.content,
         mc.created_at,
         mc.updated_at
       FROM message_content mc
       INNER JOIN message m ON mc.message_id = m.id
       WHERE mc.content IS NOT NULL
         AND m.role IN ('user', 'assistant')
       ORDER BY mc.created_at ASC
       LIMIT ? OFFSET ?`,
      limit,
      offset,
    );
  }
}
