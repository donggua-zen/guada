import { Module } from "@nestjs/common";
import { VectorDbModule } from "../../common/vector-db/vector-db.module";
import { ToolOrchestrator } from "./tool-orchestrator.service";
import { ToolContextFactory } from "./tool-context";
import { KnowledgeBaseToolProvider } from "./providers/knowledge-base-tool.provider";
import { MemoryToolProvider } from "./providers/memory-tool.provider";
import { MCPToolProvider } from "./providers/mcp-tool.provider";
import { TimeToolProvider } from "./providers/time-tool.provider";
import { ImageRecognitionToolProvider } from "./providers/image-recognition-tool.provider";
import { EmbeddingService } from "../knowledge-base/embedding.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../common/database/kb-chunk.repository";
import { FileRepository } from "../../common/database/file.repository";
import { PrismaService } from "../../common/database/prisma.service";

@Module({
  imports: [VectorDbModule],
  providers: [
    ToolOrchestrator,
    ToolContextFactory,
    KnowledgeBaseToolProvider,
    MemoryToolProvider,
    MCPToolProvider,
    TimeToolProvider,
    ImageRecognitionToolProvider,
    EmbeddingService,
    KnowledgeBaseRepository,
    KBFileRepository,
    KBChunkRepository,
    FileRepository,
    PrismaService,
  ],
  exports: [ToolOrchestrator, ToolContextFactory],
})
export class ToolsModule {}
