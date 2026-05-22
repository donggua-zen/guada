import { Module, OnModuleInit } from "@nestjs/common";
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
import { EmbeddingService } from "../knowledge-base/embedding.service";
import { KbFileService } from "../knowledge-base/kb-file.service";
import { FileParserService } from "../knowledge-base/file-parser.service";
import { ChunkingService } from "../knowledge-base/chunking.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../common/database/kb-chunk.repository";
import { FileRepository } from "../../common/database/file.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { SkillsModule } from '../skills/skills.module';
import { SkillToolBridgeService } from '../skills/integration/skill-tool-bridge.service';

@Module({
  imports: [VectorDbModule, SkillsModule, SharedModule],
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
    SkillToolBridgeService,
    EmbeddingService,
    KbFileService,
    FileParserService,
    ChunkingService,
    KnowledgeBaseRepository,
    KBFileRepository,
    KBChunkRepository,
    FileRepository,
    PrismaService,
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
    this.toolOrchestrator.addProvider(this.skillToolBridge);
  }
}
