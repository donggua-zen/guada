import { Module, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { SessionRepository } from "../../common/database/session.repository";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageContentRepository } from "../../common/database/message-content.repository";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { FileRepository } from "../../common/database/file.repository";
import { AgentEngine } from "./agent-engine.service";
import { SessionContextService } from "./session-context.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import { ChatController } from "./chat.controller";
import { MessagesController } from "./messages.controller";
import { SessionsController } from "./sessions.controller";
import { WorkspaceEventsController } from "./workspace-events.controller";
import { MessageService } from "./message.service";
import { SessionService } from "./session.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { CharactersModule } from "../characters/characters.module";
import { FilesModule } from "../files/files.module";
import { LlmCoreModule } from "../llm-core/providers.module";
import { SkillsModule } from "../skills/skills.module";

import { SessionStreamManager } from "./session-stream.manager";
import { SessionEventsService } from "./session-events.service";
import { SessionEventsController } from "./session-events.controller";
import { UploadPathService } from "../../common/services/upload-path.service";
import { FileWatcherService } from "../../common/services/file-watcher.service";

import { MessageStoreService } from "./message-store.service";
import { CompressionEngine } from "./compression-engine";
import { ConversationContextFactory, MESSAGE_STORE_TOKEN, COMPRESSION_STRATEGY_TOKEN } from "./conversation-context.factory";

@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule, LlmCoreModule, SkillsModule],
  controllers: [ChatController, MessagesController, SessionsController, WorkspaceEventsController, SessionEventsController],
  providers: [
    AgentEngine,
    SessionContextService,
    MessageStoreService,
    CompressionEngine,
    ConversationContextFactory,
    { provide: MESSAGE_STORE_TOKEN, useExisting: MessageStoreService },
    { provide: COMPRESSION_STRATEGY_TOKEN, useExisting: CompressionEngine },
    MessageService,
    SessionService,
    SessionRepository,
    SessionContextStateRepository,
    MessageRepository,
    MessageContentRepository,
    KnowledgeBaseRepository,
    ModelRepository,
    FileRepository,
    PrismaService,
    SessionStreamManager,
    TokenizerService,
    UploadPathService,
    FileWatcherService,
    SessionEventsService,
  ],
  exports: [AgentEngine],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private toolOrchestrator: ToolOrchestrator, // 从 ToolsModule 注入
  ) { }

  onModuleInit() {
    // KnowledgeBaseToolProvider 已在 ToolsModule 中注册，无需再次添加
  }
}
