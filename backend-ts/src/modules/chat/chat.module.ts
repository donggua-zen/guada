import { Module } from "@nestjs/common";

import { AgentEngine } from "./agent-engine.service";
import { SessionContextFactory } from "./session-context.factory";
import { ChatController } from "./chat.controller";
import { MessagesController } from "./messages.controller";
import { SessionGroupController } from "./session-group.controller";
import { SessionGroupService } from "./session-group.service";
import { SessionsController } from "./sessions.controller";
import { WorkspaceEventsController } from "./workspace-events.controller";
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
import { EventBusService } from "../../common/events/event-bus.service";
import { JsonlSessionContextFactory } from "./jsonl-session-context.factory";
import { CompressionEngine } from "./compression-engine";
import { TokenMeterService } from "./token-meter.service";
import { MemorySyncService } from "./memory-sync.service";
import { CompactionCoordinatorService } from "./compaction/compaction-coordinator.service";
import { CompactionService } from "./compaction/compaction.service";
import { SessionReplayService } from "./session-replay.service";

// 标签解析器
import { TagParserPipeline } from "./parsers/tag-parser-pipeline.service";

@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule, LlmCoreModule, SkillsModule, SettingsModule],
  controllers: [ChatController, MessagesController, SessionsController, SessionGroupController, WorkspaceEventsController, SessionEventsController],
  providers: [
    AgentEngine,
    SessionContextFactory,
    SessionService,
    SessionGroupService,

    // 会话上下文工厂与压缩引擎（依赖经全局 PersistenceModule 注入的 MESSAGE_STORE_TOKEN）
    JsonlSessionContextFactory,
    CompressionEngine,
    TokenMeterService,
    MemorySyncService,
    CompactionService,
    CompactionCoordinatorService,

    SessionStreamManager,
    UploadPathService,
    WorkspaceWatcherService,
    SessionEventsService,
    ChatRunnerService,
    SessionReplayService,

    // 标签解析器管道
    TagParserPipeline,
  ],
  exports: [AgentEngine, SessionService, SessionEventsService, ChatRunnerService, SessionContextFactory],
})
export class ChatModule {}
