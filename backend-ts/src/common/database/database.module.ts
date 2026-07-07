import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { UserRepository } from "./user.repository";
import { CharacterGroupRepository } from "./character-group.repository";
import { CharacterRepository } from "./character.repository";
import { FileRepository } from "./file.repository";
import { KBChunkRepository } from "./kb-chunk.repository";
import { KBFileRepository } from "./kb-file.repository";
import { KnowledgeBaseRepository } from "./knowledge-base.repository";
import { McpServerRepository } from "./mcp-server.repository";
import { MessageContentRepository } from "./message-content.repository";
import { MessageRepository } from "./message.repository";
import { ModelRepository } from "./model.repository";
import { SessionContextStateRepository } from "./session-context-state.repository";
import { SessionGroupRepository } from "./session-group.repository";
import { SessionRepository } from "./session.repository";

const REPOSITORIES = [
  PrismaService,
  UserRepository,
  CharacterGroupRepository,
  CharacterRepository,
  FileRepository,
  KBChunkRepository,
  KBFileRepository,
  KnowledgeBaseRepository,
  McpServerRepository,
  MessageContentRepository,
  MessageRepository,
  ModelRepository,
  SessionContextStateRepository,
  SessionGroupRepository,
  SessionRepository,
];

@Global()
@Module({
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class DatabaseModule {}
