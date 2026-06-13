import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { VectorDbModule } from "../../common/vector-db/vector-db.module";
import { KnowledgeBasesController } from "./knowledge-bases.controller";
import { KbFilesController } from "./kb-files.controller";
import { KbSearchController } from "./kb-search.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KbFileService } from "./kb-file.service";
import { FileParserService } from "./file-parser.service";
import { EmbeddingService } from "./embedding.service";
import { ChunkingService } from "./chunking.service";
import { OcrService } from "./ocr.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../common/database/kb-chunk.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ToolsModule } from "../tools/tools.module";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { KnowledgeBaseToolProvider } from "./tools/knowledge-base-tool.provider";
import { DocumentToolProvider } from "./tools/document-tool.provider";

@Module({
  imports: [HttpModule, AuthModule, VectorDbModule, SettingsModule, ToolsModule],
  controllers: [
    KnowledgeBasesController,
    KbFilesController,
    KbSearchController,
  ],
  providers: [
    KnowledgeBaseService,
    KbFileService,
    FileParserService,
    EmbeddingService,
    ChunkingService,
    OcrService,
    KnowledgeBaseRepository,
    KBFileRepository,
    KBChunkRepository,
    PrismaService,
    KnowledgeBaseToolProvider,
    DocumentToolProvider,
  ],
  exports: [EmbeddingService],
})
export class KnowledgeBaseModule implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseModule.name);

  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly kbToolProvider: KnowledgeBaseToolProvider,
    private readonly documentToolProvider: DocumentToolProvider,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.kbToolProvider);
    this.toolOrchestrator.addProvider(this.documentToolProvider);
    this.logger.log("KnowledgeBaseToolProvider + DocumentToolProvider 已注册");
  }
}
