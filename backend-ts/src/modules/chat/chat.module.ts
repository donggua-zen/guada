import { Module, OnModuleInit } from "@nestjs/common";

import { AgentEngine } from "./agent-engine.service";
import { SessionContextFactory } from "./session-context.factory";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ChatController } from "./chat.controller";
import { MessagesController } from "./messages.controller";
import { SessionGroupController } from "./session-group.controller";
import { SessionGroupService } from "./session-group.service";
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
import { ChatRunnerService } from "./chat-runner.service";
import { ToolCallDisplayUtil } from "./utils/tool-call-display.util";
import { EventBusService } from "../../common/events/event-bus.service";

import { MessageStoreService } from "./message-store.service";
import { CompressionEngine } from "./compression-engine";
import { MESSAGE_STORE_TOKEN, COMPRESSION_STRATEGY_TOKEN } from "./interfaces";

@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule, LlmCoreModule, SkillsModule],
  controllers: [ChatController, MessagesController, SessionsController, SessionGroupController, WorkspaceEventsController, SessionEventsController],
  providers: [
    AgentEngine,
    SessionContextFactory,
    MessageStoreService,
    CompressionEngine,
    { provide: MESSAGE_STORE_TOKEN, useExisting: MessageStoreService },
    { provide: COMPRESSION_STRATEGY_TOKEN, useExisting: CompressionEngine },
    MessageService,
    SessionService,
    SessionGroupService,

    SessionStreamManager,
    UploadPathService,
    FileWatcherService,
    SessionEventsService,
    ChatRunnerService,
    ToolCallDisplayUtil,
  ],
  exports: [AgentEngine, SessionService, MessageService, SessionEventsService, ChatRunnerService, SessionContextFactory],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private toolOrchestrator: ToolOrchestrator, // 从 ToolsModule 注入
  ) { }

  onModuleInit() {
    // KnowledgeBaseToolProvider 已在 ToolsModule 中注册，无需再次添加
  }
}
