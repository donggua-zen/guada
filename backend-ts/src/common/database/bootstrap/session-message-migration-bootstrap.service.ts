/**
 * 会话消息迁移引导（⚠️ 迁移脚手架：随 Prisma/主库整体移除）
 *
 * DB message/message_content/session_context_state → JSONL 事件日志的启动期一次性迁移，
 * 由 MigrationBootstrapService 编排调用（kb 步之后、sessionStore.initialize() 之前——
 * JSONL 与 meta 修复先于索引预热，孤儿自愈不再抢先产生无标题骨架行）。
 *
 * Marker：<sessions根>/.migrated-session-messages（独立于元信息导出的 .migrated-sessions：
 * 消息迁移可能晚于元信息导出数个版本才上线，共用 marker 会漏迁）。
 * 失败不落 marker，下次启动重试；已成功会话按幂等跳过。
 */
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { resolveSessionsBasePath } from "../../utils/session-path.util";
import { SessionMessageDbMigratorService } from "./session-message-db-migrator.service";

export const SESSION_MESSAGES_MIGRATED_MARKER = ".migrated-session-messages";

@Injectable()
export class SessionMessageMigrationBootstrapService {
  private readonly logger = new Logger(SessionMessageMigrationBootstrapService.name);

  constructor(private readonly migrator: SessionMessageDbMigratorService) {}

  /** @returns 是否完成（已完成/本次成功 = true；失败 = false，下次启动重试） */
  async run(): Promise<boolean> {
    const marker = path.join(
      resolveSessionsBasePath(),
      SESSION_MESSAGES_MIGRATED_MARKER,
    );
    if (fs.existsSync(marker)) return true;

    try {
      const result = await this.migrator.migrateAll();
      this.logger.log(
        `会话消息迁移: 新迁 ${result.migrated}，跳过(已有) ${result.skipped}，` +
          `meta 修复 ${result.metaRepaired}，失败 ${result.failed}`,
      );
      if (result.failed === 0) {
        await fsp.writeFile(
          marker,
          `migrated at ${new Date().toISOString()}\n`,
          "utf8",
        );
        return true;
      }
      this.logger.warn(
        "会话消息迁移存在失败项，不落 marker（下次启动重试；已成功会话幂等跳过）",
      );
      return false;
    } catch (err) {
      this.logger.error(`会话消息迁移失败（下次启动重试）: ${String(err)}`);
      return false;
    } finally {
      // 释放 _meta.db 句柄（meta 修复用），避免 Windows 下锁住目录
      this.migrator.close();
    }
  }
}
