import { Module } from "@nestjs/common";

import { AgentEngine } from "./agent-engine.service";
import { SessionContextFactory } from "./session-context.factory";
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
import { SettingsModule } from "../settings/settings.module";

import { SessionStreamManager } from "./session-stream.manager";
import { SessionEventsService } from "./session-events.service";
import { SessionEventsController } from "./session-events.controller";
import { UploadPathService } from "../../common/services/upload-path.service";
import { WorkspaceWatcherService } from "../../common/services/workspace-watcher.service";
import { ChatRunnerService } from "./chat-runner.service";
import { SessionTokenTracker } from "./utils/session-token-tracker";
import { EventBusService } from "../../common/events/event-bus.service";

import { CompressionEngine } from "./compression-engine";
import { COMPRESSION_STRATEGY_TOKEN } from "./interfaces";

// 标签解析器
import { TagParserPipeline } from "./parsers/tag-parser-pipeline.service";

@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule, LlmCoreModule, SkillsModule, SettingsModule],
  controllers: [ChatController, MessagesController, SessionsController, SessionGroupController, WorkspaceEventsController, SessionEventsController],
  providers: [
    AgentEngine,
    SessionContextFactory,
    CompressionEngine,
    { provide: COMPRESSION_STRATEGY_TOKEN, useExisting: CompressionEngine },
    MessageService,
    SessionService,
    SessionGroupService,

    SessionStreamManager,
    UploadPathService,
    WorkspaceWatcherService,
    SessionEventsService,
    ChatRunnerService,
    SessionTokenTracker,

    // 标签解析器管道
    TagParserPipeline,
  ],
  exports: [AgentEngine, SessionService, MessageService, SessionEventsService, ChatRunnerService, SessionContextFactory],
})
export class ChatModule {}
