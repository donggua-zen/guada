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
import { KbMetaStore } from "./kb-meta.store";
import { KbDatabaseService } from "./kb-database.service";
import { KBFileRepository } from "./kb-file.repository";
import { KBChunkRepository } from "./kb-chunk.repository";
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
  providers: [
    // KB 数据层（每库一个 kb.db 的句柄注册表）在本模块自持注册；
    // 历史上「由 @Global 的集中模块提供、禁止在此重复注册」的约定已随注册归位移除。
    KbDatabaseService, KbMetaStore, KbSearchService,
    KBFileRepository, KBChunkRepository,
    KnowledgeBaseService, KbFileService,
    FileParserService, EmbeddingService, ChunkingService, OcrService,
    PdfToImageService,
    WorkspaceService,
  ],
  exports: [EmbeddingService, KnowledgeBaseService, KbMetaStore, KbSearchService],
})
export class KnowledgeBaseModule implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly providerStore: ProviderFileStore,
    private readonly kbRepo: KbMetaStore,
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
