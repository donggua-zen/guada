import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { KnowledgeBasesController } from "./knowledge-bases.controller";
import { KbFilesController } from "./kb-files.controller";
import { KbSearchController } from "./kb-search.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KbSearchService } from "./kb-search.service";
import { KbFileService } from "./kb-file.service";
import { FileParserService } from "./file-parser.service";
import { EmbeddingService } from "./embedding.service";
import { ChunkingService } from "./chunking.service";
import { OcrService } from "./ocr.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../common/database/kb-chunk.repository";
import { PdfToImageService } from "../../common/pdf-render/pdf-to-image.service";
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { WorkspaceService } from "../../common/services/workspace.service";
import { KnowledgeBasePlugin } from "./plugins/knowledge-base.plugin";
import { DocumentPlugin } from "./plugins/document.plugin";

@Module({
  imports: [HttpModule, AuthModule, SettingsModule, ToolsModule],
  controllers: [KnowledgeBasesController, KbFilesController, KbSearchController],
  // KbDatabaseService/KbMetaStore/KbSearchService 与三个仓储由 @Global 的 DatabaseModule 提供。
  // **不要在这里再注册一次**：那会造出第二个 KbDatabaseService 实例，两套句柄注册表互不知情，
  // 一条路径打开的 kb.db，另一条路径 close() 时关不掉 → 删库时 Windows 报占用。
  providers: [
    KnowledgeBaseService, KbFileService,
    FileParserService, EmbeddingService, ChunkingService, OcrService,
    PdfToImageService,
    WorkspaceService,
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
    private readonly chunkRepo: KBChunkRepository,
    private readonly searchService: KbSearchService,
    private readonly embeddingService: EmbeddingService,
    private readonly kbFileService: KbFileService,
    private readonly fileParserService: FileParserService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(new KnowledgeBasePlugin(
      this.providerStore, this.kbRepo, this.fileRepo, this.chunkRepo,
      this.searchService, this.embeddingService, this.kbFileService,
    ));
    await this.pluginManager.registerPlugin(new DocumentPlugin(this.fileParserService, this.workspaceService));
    this.logger.log("KnowledgeBasePlugin + DocumentPlugin 已注册");
  }
}
