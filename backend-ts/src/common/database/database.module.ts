import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { MigrationRunner } from "./migration-runner.service";
import { CharacterRepository } from "./character.repository";
import { CharacterFileStore } from "../../modules/characters/character-file.store";
import { SessionFileStore } from "../../modules/chat/session-file.store";
import { BotFileStore } from "../../modules/bot-gateway/bot-file.store";
import { KbFileStore } from "../../modules/knowledge-base/kb-file.store";
import { McpFileStore } from "../../modules/mcp-servers/mcp-file.store";
import { KBChunkRepository } from "./kb-chunk.repository";
import { KBFileRepository } from "./kb-file.repository";
import { KnowledgeBaseRepository } from "./knowledge-base.repository";
import { SessionGroupRepository } from "./session-group.repository";
import { SessionRepository } from "./session.repository";
import { MetadataBootstrapGate } from "./metadata-bootstrap.gate";
import { AccountFileStore } from "../../modules/auth/account-file.store";
import { AccountBootstrapService } from "./bootstrap/account-bootstrap.service";
import { CharacterFileBootstrapService } from "./bootstrap/character-file-bootstrap.service";
import { ProviderBootstrapService } from "./bootstrap/provider-bootstrap.service";
import { MetadataFileBootstrapService } from "./bootstrap/metadata-file-bootstrap.service";
import { MigrationBootstrapService } from "./bootstrap/migration-bootstrap.service";

const REPOSITORIES = [
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
  CharacterFileStore,
  SessionFileStore,
  BotFileStore,
  KbFileStore,
  McpFileStore,
  CharacterRepository,
  KBChunkRepository,
  KBFileRepository,
  KnowledgeBaseRepository,
  SessionGroupRepository,
  SessionRepository,
  // 编排器必须最后注册：唯一 OnModuleInit，按序调用上面各 bootstrap 的 run()
  MigrationBootstrapService,
];

@Global()
@Module({
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class DatabaseModule {}
