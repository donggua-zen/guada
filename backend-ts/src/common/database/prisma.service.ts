import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private readonly isSqlite: boolean;

  constructor(private configService: ConfigService) {
    const databaseUrl =
      configService.get<string>("DATABASE_URL") || "file:./data/ai_chat.db";

    const adapter = PrismaService.createAdapter(databaseUrl);
    super({ adapter });

    this.isSqlite = databaseUrl.startsWith("file:") || databaseUrl.endsWith(".db");
  }

  async onModuleInit() {
    await this.$connect();

    if (this.isSqlite) {
      // WAL 模式：读写不互相阻塞，显著提升并发性能
      await this.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
      // 写冲突时等待 60 秒而非立即报错（默认 busy_timeout = 0）
      await this.$executeRawUnsafe("PRAGMA busy_timeout = 60000;");
      // 启用外键约束（SQLite 默认关闭）
      await this.$executeRawUnsafe("PRAGMA foreign_keys = ON;");

      this.logger.log("SQLite: WAL mode enabled, busy_timeout=60s");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * 根据数据库 URL 选择对应的 Prisma 适配器。
   *
   * - SQLite（file: 或 .db）→ PrismaBetterSqlite3
   * - PostgreSQL（postgresql:）→ 由 PrismaClient 原生处理（不传 adapter）
   * - MySQL（mysql:）→ 同上
   *
   * 新增数据库类型时在此扩展即可，无需修改调用方。
   */
  private static createAdapter(databaseUrl: string): any {
    if (
      databaseUrl.startsWith("file:") ||
      databaseUrl.endsWith(".db") ||
      !databaseUrl.includes("://")
    ) {
      return new PrismaBetterSqlite3({
        url: databaseUrl as any,
        timeout: 60000, // better-sqlite3 层也设 60s 超时，双重保险
      });
    }

    // PostgreSQL / MySQL 等由 PrismaClient 原生驱动处理
    return undefined;
  }
}
