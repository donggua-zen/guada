import { Module } from '@nestjs/common';
import { VectorDbModule } from '../../common/vector-db/vector-db.module';
import { ToolOrchestrator } from './tool-orchestrator.service';
import { KnowledgeBaseToolProvider } from './providers/knowledge-base-tool.provider';
import { MemoryToolProvider } from './providers/memory-tool.provider';
import { MCPToolProvider } from './providers/mcp-tool.provider';
import { TimeToolProvider } from './providers/time-tool.provider';
import { EmbeddingService } from '../knowledge-base/embedding.service';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
import { KBFileRepository } from '../../common/database/kb-file.repository';
import { KBChunkRepository } from '../../common/database/kb-chunk.repository';
import { PrismaService } from '../../common/database/prisma.service';

@Module({
  imports: [VectorDbModule],
  providers: [
    ToolOrchestrator,
    KnowledgeBaseToolProvider,
    MemoryToolProvider,
    MCPToolProvider,
    TimeToolProvider,
    EmbeddingService,
    KnowledgeBaseRepository,
    KBFileRepository,
    KBChunkRepository,
    PrismaService,
  ],
  exports: [ToolOrchestrator],
})
export class ToolsModule {}
