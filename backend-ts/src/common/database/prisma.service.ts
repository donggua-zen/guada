import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(private configService: ConfigService) {
    const databaseUrl =
      configService.get<string>("DATABASE_URL") || "file:./data/ai_chat.db";
    const adapter = new PrismaBetterSqlite3({ url: databaseUrl });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    
    // 启用 SQLite 外键约束（SQLite 默认关闭外键检查）
    try {
      await this.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
    } catch (error) {
      console.error('启用 SQLite 外键约束失败:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
