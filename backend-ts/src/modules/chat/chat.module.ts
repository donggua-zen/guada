import { Inject, Logger, Module, OnModuleInit } from "@nestjs/common";

import { SESSION_STORE_TOKEN } from './session-store.facade';
import type { SessionStoreFacade } from './session-store.facade';
import { ProjectGroupBootstrapService } from "./project-group-bootstrap.service";
import { AgentEngine } from "./agent-engine.service";
import { SessionContextFactory } from "./session-context.factory";
import { ChatController } from "./chat.controller";
import { MessagesController } from "./messages.controller";
import { SessionGroupController } from "./session-group.controller";
import { SessionGroupService } from "./session-group.service";
import { ProjectGroupController } from "./project-group.controller";
import { ProjectGroupService } from "./project-group.service";
import { SessionsController } from "./sessions.controller";
import { WorkspaceEventsController } from "./workspace-events.controller";
import { SessionService } from "./session.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { AgentsModule } from "../agents/agents.module";
import { LlmCoreModule } from "../llm-core/providers.module";
import { SkillsModule } from "../skills/skills.module";
import { SettingsModule } from "../settings/settings.module";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module";
import { RemoteWorkspaceModule } from "../remote-workspace/remote-workspace.module";
import { JobsModule } from "../jobs/jobs.module";
import { JobNotifierService } from "../jobs/job-notifier.service";

import { SessionStreamManager } from "./session-stream.manager";
import { SessionEventsService } from "./session-events.service";
import { SessionEventsController } from "./session-events.controller";
import { UploadPathService } from "../../common/services/upload-path.service";
import { WorkspaceWatcherService } from "../../common/services/workspace-watcher.service";
import { ChatRunnerService } from "./chat-runner.service";
import { UserInputQueueService } from "./user-input-queue.service";
import { SessionQueueController } from "./session-queue.controller";
import { EventBusService } from "../../common/events/event-bus.service";
import { JsonlSessionContextFactory } from "./jsonl-session-context.factory";
import { CompressionEngine } from "./compaction/compression-engine";
import { MicrocompactService } from "./compaction/microcompact.service";
import { TokenMeterService } from "./token-meter.service";
import { MemorySyncService } from "./memory-sync.service";
import { CompactionCoordinatorService } from "./compaction/compaction-coordinator.service";
import { CompactionService } from "./compaction/compaction.service";
import { ToolImagePruneService } from "./compaction/tool-image-prune.service";
import { SessionReplayService } from "./session-replay.service";
import { PlanHistoryService } from "./plan-history.service";
import { SessionModelBackfillService } from "./session-model-backfill.service";
import { ClaudeImportController } from "./claude-import/claude-import.controller";
import { ClaudeImportService } from "./claude-import/claude-import.service";
import { LocalSlashCommandRegistry } from "./commands/local-slash-command.registry";

// 标签解析器
import { TagParserPipeline } from "./parsers/tag-parser-pipeline.service";

@Module({
  imports: [AuthModule, ToolsModule, AgentsModule, LlmCoreModule, SkillsModule, SettingsModule, KnowledgeBaseModule, RemoteWorkspaceModule, JobsModule],
  controllers: [ChatController, MessagesController, SessionsController, SessionGroupController, ProjectGroupController, WorkspaceEventsController, SessionEventsController, SessionQueueController, ClaudeImportController],
  providers: [
    AgentEngine,
    SessionContextFactory,
    SessionService,
    SessionGroupService,
    // 目录分组（按工作目录分组）：实体在启动期注册，成员关系派生
    ProjectGroupService,
    ProjectGroupBootstrapService,
    // 会话上下文工厂与压缩引擎（依赖经全局 PersistenceModule 注入的 MESSAGE_STORE_TOKEN）
    JsonlSessionContextFactory,
    CompressionEngine,
    MicrocompactService,
    TokenMeterService,
    MemorySyncService,
    CompactionService,
    CompactionCoordinatorService,
    ToolImagePruneService,

    SessionStreamManager,
    UploadPathService,
    WorkspaceWatcherService,
    SessionEventsService,
    UserInputQueueService,
    ChatRunnerService,
    JobNotifierService,
    SessionReplayService,
    // 老会话模型回填（全局默认对话模型移除后的一次性数据收敛）
    SessionModelBackfillService,
    // Claude Code 历史会话导入（扫描 ~/.claude/projects → 解析 → createSession + importTurns）
    ClaudeImportService,
    // 计划历史（转录扫描：计划身份 = ExitPlanMode toolCallId，列表含状态）
    PlanHistoryService,

    // 标签解析器管道
    TagParserPipeline,
    // 本地斜杠命令执行注册表（功能模块在 onModuleInit 注册自己的 handler）
    LocalSlashCommandRegistry,
  ],
  // 会话存储门面由全局 StoreModule 提供（@Global），这里不再重复 provider；
  // 跨域消费者直接 @Inject(SESSION_STORE_TOKEN)，无需 import ChatModule。
  exports: [AgentEngine, SessionService, SessionEventsService, ChatRunnerService, SessionContextFactory, UserInputQueueService, LocalSlashCommandRegistry],
})
export class ChatModule implements OnModuleInit {
  private readonly logger = new Logger(ChatModule.name);

  constructor(
    @Inject(SESSION_STORE_TOKEN) private sessionStore: SessionStoreFacade,
    private projectGroupBootstrap: ProjectGroupBootstrapService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 目录分组一次性注册先于索引预热：分组行依赖 sessions 表的 workspace_key。
    // 失败只记日志不阻塞启动（下次启动重试），与旧编排器的 step 语义一致。
    try {
      await this.projectGroupBootstrap.run();
    } catch (err) {
      this.logger.error(`目录分组注册失败（下次启动重试）: ${String(err)}`);
    }
    // 索引预热：扫描成本留在启动期而非首个请求
    await this.sessionStore.initialize();
  }
}
