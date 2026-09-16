import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { MigrationRunner } from "./migration-runner.service";
import { CharacterFileStore } from "../../modules/characters/character-file.store";
import { SessionFileStore } from "../../modules/chat/session-file.store";
import { BotFileStore } from "../../modules/bot-gateway/bot-file.store";
import { KbMetaStore } from "../../modules/knowledge-base/kb-meta.store";
import { KbDatabaseService } from "../../modules/knowledge-base/kb-database.service";
import { KbSearchService } from "../../modules/knowledge-base/kb-search.service";
import { McpFileStore } from "../../modules/mcp-servers/mcp-file.store";
import { KBChunkRepository } from "../../modules/knowledge-base/kb-chunk.repository";
import { KBFileRepository } from "../../modules/knowledge-base/kb-file.repository";
import { MetadataBootstrapGate } from "./metadata-bootstrap.gate";
import { AccountFileStore } from "../../modules/auth/account-file.store";
import { AccountBootstrapService } from "./bootstrap/account-bootstrap.service";
import { CharacterFileBootstrapService } from "./bootstrap/character-file-bootstrap.service";
import { ProviderBootstrapService } from "./bootstrap/provider-bootstrap.service";
import { MetadataFileBootstrapService } from "./bootstrap/metadata-file-bootstrap.service";
import { MigrationBootstrapService } from "./bootstrap/migration-bootstrap.service";
import { KbMigrationBootstrapService } from "./bootstrap/kb-migration-bootstrap.service";
import { SessionMessageDbMigratorService } from "./bootstrap/session-message-db-migrator.service";
import { SessionMessageMigrationBootstrapService } from "./bootstrap/session-message-migration-bootstrap.service";

/**
 * 持久化与启动迁移（全局）
 *
 * 本模块是全局持久化装配点：各域 FileStore、KB 的 kb.db 数据访问层，
 * 以及一次性 DB→文件迁移脚手架（bootstrap/，临时）。
 *
 * 命名说明：目录 `common/database` 与 PrismaService/MigrationRunner 是迁移期遗留；
 * 运行期存储的权威来源已是文件（会话 meta.json+JSONL、角色 AGENT.md、
 * 供应商 yaml、每库 kb.db 等）。仓储兼容层（Character/Session/SessionGroup/
 * KnowledgeBase 四个 Repository shim）已于 2026-09 第一阶段重构中删除，
 * 调用方直连 FileStore；KB 双仓储已归位到 modules/knowledge-base。
 */
const PERSISTENCE_PROVIDERS = [
  PrismaService,
  MigrationRunner,
  // 元信息文件化：门控必须先于各 FileStore 提供（store 构造期注入）
  MetadataBootstrapGate,
  // 单账户：账户文件 + 启动期从 DB 导入（防升级丢密码）
  AccountFileStore,
  // ── 迁移脚手架（临时，两个版本后随主库整体移除；执行顺序由
  //    MigrationBootstrapService 显式编排，见 bootstrap/ 目录注释）──
  CharacterFileBootstrapService,
  ProviderBootstrapService,
  AccountBootstrapService,
  MetadataFileBootstrapService,
  KbMigrationBootstrapService,
  // 会话消息 DB → JSONL（含 meta 骨架修复；编排顺序见 MigrationBootstrapService）
  SessionMessageDbMigratorService,
  SessionMessageMigrationBootstrapService,
  CharacterFileStore,
  SessionFileStore,
  BotFileStore,
  KbMetaStore,
  KbDatabaseService,
  KbSearchService,
  McpFileStore,
  KBChunkRepository,
  KBFileRepository,
  // 编排器必须最后注册：唯一 OnModuleInit，按序调用上面各 bootstrap 的 run()
  MigrationBootstrapService,
];

@Global()
@Module({
  providers: PERSISTENCE_PROVIDERS,
  exports: PERSISTENCE_PROVIDERS,
})
export class DatabaseModule {}
