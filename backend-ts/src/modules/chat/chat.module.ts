import { Module, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { SessionRepository } from "../../common/database/session.repository";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageContentRepository } from "../../common/database/message-content.repository";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { FileRepository } from "../../common/database/file.repository";
import { AgentService } from "./agent.service";
import { ContextManagerService } from "./context-manager.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import { ChatController } from "./chat.controller";
import { MessagesController } from "./messages.controller";
import { SessionsController } from "./sessions.controller";
import { MessageService } from "./message.service";
import { SessionService } from "./session.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { CharactersModule } from "../characters/characters.module";
import { FilesModule } from "../files/files.module";

import { SessionLockService } from "./session-lock.service";
import { ToolResultCleaner } from "./tool-result-cleaner.service";

@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule],
  controllers: [ChatController, MessagesController, SessionsController],
  providers: [
    AgentService,
    ContextManagerService,
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
    SessionLockService,
    TokenizerService,
    ToolResultCleaner,
    // SettingsStorage 由 SharedModule 全局提供，无需在此声明
    // LLMService 由 LlmCoreModule 全局提供，无需在此声明
  ],
  exports: [AgentService],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private toolOrchestrator: ToolOrchestrator, // 从 ToolsModule 注入
  ) { }

  onModuleInit() {
    // KnowledgeBaseToolProvider 已在 ToolsModule 中注册，无需再次添加
  }
}
