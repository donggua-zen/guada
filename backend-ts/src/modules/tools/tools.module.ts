import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { VectorDbModule } from "../../common/vector-db/vector-db.module";
import { SharedModule } from "../../common/services/shared.module";
import { ToolOrchestrator } from "./tool-orchestrator.service";
import { ToolContextFactory } from "./tool-context";
import { KnowledgeBaseToolProvider } from "./providers/knowledge-base-tool.provider";
import { MemoryToolProvider } from "./providers/memory-tool.provider";
import { MCPToolProvider } from "./providers/mcp-tool.provider";
import { TimeToolProvider } from "./providers/time-tool.provider";
import { ImageRecognitionToolProvider } from "./providers/image-recognition-tool.provider";
import { ShellToolProvider } from "./providers/shell-tool.provider";
import { FileToolProvider } from "./providers/file-tool.provider";
import { BrowserToolProvider } from "./providers/browser-tool.provider";
import { SessionManagementToolProvider } from "./providers/session-management-tool.provider";
import { SchedulerToolProvider } from "./providers/scheduler-tool.provider";
import { DocumentToolProvider } from "./providers/document-tool.provider";
import { EmbeddingService } from "../knowledge-base/embedding.service";
import { KbFileService } from "../knowledge-base/kb-file.service";
import { FileParserService } from "../knowledge-base/file-parser.service";
import { ChunkingService } from "../knowledge-base/chunking.service";

import { SkillsModule } from '../skills/skills.module';
import { SkillToolBridgeService } from '../skills/integration/skill-tool-bridge.service';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [VectorDbModule, SkillsModule, SharedModule, forwardRef(() => SchedulerModule)],
  providers: [
    ToolOrchestrator,
    ToolContextFactory,
    KnowledgeBaseToolProvider,
    MemoryToolProvider,
    MCPToolProvider,
    TimeToolProvider,
    ImageRecognitionToolProvider,
    ShellToolProvider,
    FileToolProvider,
    BrowserToolProvider,
    SessionManagementToolProvider,
    SchedulerToolProvider,
    DocumentToolProvider,
    SkillToolBridgeService,
    EmbeddingService,
    KbFileService,
    FileParserService,
    ChunkingService,

  ],
  exports: [ToolOrchestrator, ToolContextFactory],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly kbProvider: KnowledgeBaseToolProvider,
    private readonly memoryProvider: MemoryToolProvider,
    private readonly mcpProvider: MCPToolProvider,
    private readonly timeProvider: TimeToolProvider,
    private readonly imageRecognitionProvider: ImageRecognitionToolProvider,
    private readonly shellProvider: ShellToolProvider,
    private readonly fileProvider: FileToolProvider,
    private readonly browserProvider: BrowserToolProvider,
    private readonly sessionManagementProvider: SessionManagementToolProvider,
    private readonly schedulerProvider: SchedulerToolProvider,
    private readonly documentProvider: DocumentToolProvider,
    private readonly skillToolBridge: SkillToolBridgeService,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.kbProvider);
    this.toolOrchestrator.addProvider(this.memoryProvider);
    this.toolOrchestrator.addProvider(this.mcpProvider);
    this.toolOrchestrator.addProvider(this.timeProvider);
    this.toolOrchestrator.addProvider(this.imageRecognitionProvider);
    this.toolOrchestrator.addProvider(this.shellProvider);
    this.toolOrchestrator.addProvider(this.fileProvider);

    // 仅在 Electron 环境下注册 BrowserToolProvider
    const isElectronEnv = process.env.ELECTRON_APP === 'true';
    if (isElectronEnv) {
      this.toolOrchestrator.addProvider(this.browserProvider);
      console.log('BrowserToolProvider registered (Electron environment)');
    } else {
      console.log('BrowserToolProvider skipped (non-Electron environment)');
    }

    this.toolOrchestrator.addProvider(this.sessionManagementProvider);
    this.toolOrchestrator.addProvider(this.schedulerProvider);
    this.toolOrchestrator.addProvider(this.documentProvider);
    this.toolOrchestrator.addProvider(this.skillToolBridge);
  }
}
