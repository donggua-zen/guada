import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { VectorDbModule } from "../../common/vector-db/vector-db.module";
import { KnowledgeBasesController } from "./knowledge-bases.controller";
import { KbFilesController } from "./kb-files.controller";
import { KbSearchController } from "./kb-search.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KbFileService } from "./kb-file.service";
import { KbChunkFileStore } from "./kb-chunk-file.store";
import { FileParserService } from "./file-parser.service";
import { EmbeddingService } from "./embedding.service";
import { ChunkingService } from "./chunking.service";
import { OcrService } from "./ocr.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import { PdfToImageService } from "../../common/pdf-render/pdf-to-image.service";
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ToolsModule } from "../tools/tools.module";
import { VectorDbService } from "../../common/vector-db/vector-db.service";
import { PluginManager } from "../plugins";
import { WorkspaceService } from "../../common/services/workspace.service";
import { KnowledgeBasePlugin } from "./plugins/knowledge-base.plugin";
import { DocumentPlugin } from "./plugins/document.plugin";

@Module({
  imports: [HttpModule, AuthModule, VectorDbModule, SettingsModule, ToolsModule],
  controllers: [KnowledgeBasesController, KbFilesController, KbSearchController],
  providers: [
    KnowledgeBaseService, KbFileService, KbChunkFileStore, FileParserService,
    EmbeddingService, ChunkingService, OcrService,
    KnowledgeBaseRepository, KBFileRepository,
    PdfToImageService,
    VectorDbService, WorkspaceService,
  ],
  exports: [EmbeddingService, KnowledgeBaseService],
})
export class KnowledgeBaseModule implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly providerStore: ProviderFileStore,
    private readonly kbRepo: KnowledgeBaseRepository,
    private readonly fileRepo: KBFileRepository,
    private readonly chunkFileStore: KbChunkFileStore,
    private readonly vectorDbService: VectorDbService,
    private readonly embeddingService: EmbeddingService,
    private readonly kbFileService: KbFileService,
    private readonly fileParserService: FileParserService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(new KnowledgeBasePlugin(
      this.providerStore, this.kbRepo, this.fileRepo, this.chunkFileStore,
      this.vectorDbService, this.embeddingService, this.kbFileService,
    ));
    await this.pluginManager.registerPlugin(new DocumentPlugin(this.fileParserService, this.workspaceService));
    this.logger.log("KnowledgeBasePlugin + DocumentPlugin 已注册");
  }
}
