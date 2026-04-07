import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingService } from './embedding.service';
import { VectorDbService } from '../../common/vector-db/vector-db.service';
import { SqliteVectorDB } from '../../common/vector-db/implementations/sqlite-vector-db';
import * as fs from 'fs';
import * as path from 'path';

describe('Knowledge Base Vector Services', () => {
  let embeddingService: EmbeddingService;
  let vectorDbService: VectorDbService;
  const testDbPath = path.join(process.cwd(), 'data', 'vector_db_test.sqlite');

  beforeAll(async () => {
    // 确保测试目录存在
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        VectorDbService,
        {
          provide: 'VECTOR_DB',
          useClass: SqliteVectorDB,
        },
      ],
    }).compile();

    embeddingService = module.get<EmbeddingService>(EmbeddingService);
    vectorDbService = module.get<VectorDbService>(VectorDbService);
  });

  afterAll(async () => {
    // 清理测试数据
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch (error) {
      console.error('清理测试数据失败:', error);
    }
  });

  describe('Vector Database Operations', () => {
    it('应该能够添加文档并执行混合搜索', async () => {
      const tableId = 'test_kb_hybrid';
      
      // 创建测试数据（使用模拟向量）
      const chunks = [
        {
          id: 'doc_1',
          content: 'LanceDB 是一个嵌入式向量数据库',
          metadata: { source: 'doc1' },
        },
        {
          id: 'doc_2',
          content: 'Qdrant 需要独立服务器部署',
          metadata: { source: 'doc2' },
        },
        {
          id: 'doc_3',
          content: '向量数据库支持语义搜索和关键词搜索',
          metadata: { source: 'doc3' },
        },
      ];

      const embeddings = [
        new Array(1536).fill(0).map(() => Math.random()),
        new Array(1536).fill(0).map(() => Math.random()),
        new Array(1536).fill(0).map(() => Math.random()),
      ];

      // 添加文档
      const ids = await vectorDbService.addChunks(tableId, chunks, embeddings);
      expect(ids.length).toBe(3);

      // 等待索引创建
      await new Promise(resolve => setTimeout(resolve, 300));

      // 执行关键词搜索
      const keywordResults = await vectorDbService.searchChunksKeyword(
        tableId,
        '向量数据库',
        5,
      );

      // 验证结果
      expect(Array.isArray(keywordResults)).toBe(true);
      expect(keywordResults.length).toBeGreaterThan(0);
      
      if (keywordResults.length > 0) {
        expect(keywordResults[0]).toHaveProperty('bm25_score');
        expect(typeof keywordResults[0].bm25_score).toBe('number');
        expect(keywordResults[0]).toHaveProperty('content');
        
        console.log('关键词搜索结果:', keywordResults.map((r: any) => ({
          content: r.content.substring(0, 30),
          bm25_score: r.bm25_score?.toFixed(4),
        })));
      }

      // 清理
      await vectorDbService.deleteTable(tableId);
    }, 15000);

    it('应该能够按 document_id 过滤删除文档', async () => {
      const tableId = 'test_kb_filter';
      
      const chunks = [
        {
          id: 'chunk_0_file1',
          content: '文件1的内容',
          metadata: { document_id: 'file1', file_name: 'test1.txt' },
        },
        {
          id: 'chunk_1_file1',
          content: '文件1的更多内容',
          metadata: { document_id: 'file1', file_name: 'test1.txt' },
        },
        {
          id: 'chunk_0_file2',
          content: '文件2的内容',
          metadata: { document_id: 'file2', file_name: 'test2.txt' },
        },
      ];

      const embeddings = [
        new Array(1536).fill(0).map(() => Math.random()),
        new Array(1536).fill(0).map(() => Math.random()),
        new Array(1536).fill(0).map(() => Math.random()),
      ];

      // 添加文档
      await vectorDbService.addChunks(tableId, chunks, embeddings);

      // 删除 file1 的所有文档
      const deletedCount = await vectorDbService.deleteChunks(tableId, {
        filterMetadata: { document_id: 'file1' },
      });

      expect(deletedCount).toBe(2);

      // 验证只剩下 file2 的文档
      const stats = await vectorDbService.getTableStats(tableId);
      expect(stats.total_count).toBe(1);

      // 清理
      await vectorDbService.deleteTable(tableId);
    }, 15000);
  });
});
