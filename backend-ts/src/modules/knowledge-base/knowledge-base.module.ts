import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VectorDbModule } from '../../common/vector-db/vector-db.module';
import { KnowledgeBasesController } from './knowledge-bases.controller';
import { KbFilesController } from './kb-files.controller';
import { KbSearchController } from './kb-search.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KbFileService } from './kb-file.service';
import { FileParserService } from './file-parser.service';
import { EmbeddingService } from './embedding.service';
import { ChunkingService } from './chunking.service';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
import { KBFileRepository } from '../../common/database/kb-file.repository';
import { KBChunkRepository } from '../../common/database/kb-chunk.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [HttpModule, AuthModule, VectorDbModule],
  controllers: [KnowledgeBasesController, KbFilesController, KbSearchController],
  providers: [
    KnowledgeBaseService,
    KbFileService,
    FileParserService,
    EmbeddingService,
    ChunkingService,
    KnowledgeBaseRepository,
    KBFileRepository,
    KBChunkRepository,
    PrismaService,
  ],
  exports: [EmbeddingService],
})
export class KnowledgeBaseModule {}
