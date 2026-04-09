# 向量数据库抽象层设计方案

## 📋 设计目标

1. **接口抽象化**：定义统一的 `VectorDatabase` 接口，支持多种向量数据库后端
2. **当前实现**：ChromaDB 本地文件模式（参考 Python 后端）
3. **混合搜索**：外部计算 BM25（使用 `rank-bm25` 或 JavaScript 等价库）
4. **可扩展性**：未来可轻松添加 LanceDB、Qdrant 等实现

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────┐
│   KnowledgeBaseService (业务层)      │
└──────────────┬──────────────────────┘
               │ 依赖注入
               ▼
┌─────────────────────────────────────┐
│   VectorDatabase (接口)              │
│   - semanticSearch()                 │
│   - keywordSearch()                  │
│   - hybridSearch()                   │
└──────────────┬──────────────────────┘
               │ 多态
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ChromaDB│ │LanceDB │ │ Qdrant │
│(当前)  │ │(未来)  │ │(未来)  │
└────────┘ └────────┘ └────────┘
```

---

## 📁 文件结构

```
src/modules/knowledge-base/
├── vector-database.interface.ts      # ✅ 已创建：抽象接口
├── implementations/
│   ├── chroma-vector-db.ts           # ChromaDB 实现（待创建）
│   ├── lancedb-vector-db.ts          # LanceDB 实现（未来）
│   └── qdrant-vector-db.ts           # Qdrant 实现（未来）
├── vector.service.ts                  # 当前服务（需重构）
└── knowledge-base.module.ts           # 模块配置
```

---

## 🔧 实施步骤

### Step 1: 安装依赖

```bash
npm install chromadb
npm install @types/chromadb  # 如果有类型定义
npm install rank-bm25-js     # BM25 实现（JavaScript 版本）
```

### Step 2: 创建 ChromaDB 实现

**文件**: `implementations/chroma-vector-db.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ChromaClient, Collection } from 'chromadb';
import * as path from 'path';
import * as fs from 'fs';
import { 
  VectorDatabase, 
  SearchResult, 
  VectorDocument,
  CollectionStats 
} from '../vector-database.interface';

@Injectable()
export class ChromaVectorDB implements VectorDatabase {
  private readonly logger = new Logger(ChromaVectorDB.name);
  private client: ChromaClient | null = null;
  private persistDirectory: string;

  constructor() {
    this.persistDirectory = path.join(process.cwd(), 'data', 'chromadb');
    if (!fs.existsSync(this.persistDirectory)) {
      fs.mkdirSync(this.persistDirectory, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    // ChromaDB 客户端初始化
    this.client = new ChromaClient({
      path: this.persistDirectory,
    });
    this.logger.log(`ChromaDB 初始化完成：${this.persistDirectory}`);
  }

  async createCollection(
    collectionName: string,
    vectorSize: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    if (!this.client) await this.initialize();
    
    try {
      await this.client!.createCollection({
        name: collectionName,
        metadata: {
          ...metadata,
          vector_size: vectorSize,
        },
      });
      this.logger.log(`创建集合：${collectionName}`);
    } catch (error: any) {
      this.logger.error(`创建集合失败：${error.message}`);
      throw error;
    }
  }

  async deleteCollection(collectionName: string): Promise<boolean> {
    if (!this.client) await this.initialize();
    
    try {
      await this.client!.deleteCollection({ name: collectionName });
      this.logger.log(`删除集合：${collectionName}`);
      return true;
    } catch (error: any) {
      this.logger.error(`删除集合失败：${error.message}`);
      return false;
    }
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    if (!this.client) await this.initialize();
    
    try {
      const collections = await this.client!.listCollections();
      return collections.some((c: any) => c.name === collectionName);
    } catch (error: any) {
      this.logger.error(`检查集合存在性失败：${error.message}`);
      return false;
    }
  }

  async addDocuments(
    collectionName: string,
    documents: VectorDocument[],
  ): Promise<string[]> {
    if (!this.client) await this.initialize();
    
    const collection = await this.client!.getOrCreateCollection({
      name: collectionName,
    });

    const ids = documents.map(doc => doc.id);
    const embeddings = documents.map(doc => doc.embedding);
    const metadatas = documents.map(doc => ({
      content: doc.content,
      ...doc.metadata,
    }));

    await collection.add({
      ids,
      embeddings,
      metadatas,
    });

    this.logger.log(`添加 ${documents.length} 个文档到集合 ${collectionName}`);
    return ids;
  }

  async deleteDocuments(
    collectionName: string,
    documentIds: string[],
  ): Promise<number> {
    if (!this.client) await this.initialize();
    
    const collection = await this.client!.getOrCreateCollection({
      name: collectionName,
    });

    await collection.delete({ ids: documentIds });
    this.logger.log(`删除 ${documentIds.length} 个文档`);
    return documentIds.length;
  }

  async semanticSearch(
    collectionName: string,
    queryEmbedding: number[],
    topK: number = 5,
    filterMetadata?: Record<string, any>,
  ): Promise<SearchResult[]> {
    if (!this.client) await this.initialize();
    
    const collection = await this.client!.getOrCreateCollection({
      name: collectionName,
    });

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: filterMetadata,
    });

    return results.ids[0].map((id: string, index: number) => ({
      content: results.metadatas[0][index].content || '',
      metadata: results.metadatas[0][index],
      score: results.distances?.[0]?.[index] || 0,
      semantic_score: 1 - (results.distances?.[0]?.[index] || 0),
    }));
  }

  async keywordSearch(
    collectionName: string,
    queryText: string,
    topK: number = 5,
    filterMetadata?: Record<string, any>,
  ): Promise<SearchResult[]> {
    // ⚠️ ChromaDB 不支持原生 BM25
    // 需要外部计算：获取所有文档 → 计算 BM25 → 排序
    
    if (!this.client) await this.initialize();
    
    const collection = await this.client!.getOrCreateCollection({
      name: collectionName,
    });

    // 获取所有文档
    const allDocs = await collection.get({
      where: filterMetadata,
      include: ['metadatas'],
    });

    // 外部计算 BM25（需要实现 BM25 算法）
    const bm25Results = this.calculateBM25(
      allDocs.metadatas,
      queryText,
      topK,
    );

    return bm25Results;
  }

  async hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    topK: number = 5,
    semanticWeight: number = 0.6,
    keywordWeight: number = 0.4,
    filterMetadata?: Record<string, any>,
  ): Promise<SearchResult[]> {
    // 并行执行语义搜索和关键词搜索
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(collectionName, queryEmbedding, topK * 2, filterMetadata),
      this.keywordSearch(collectionName, queryText, topK * 2, filterMetadata),
    ]);

    // 融合与重排序
    return this.fuseAndRerank(
      semanticResults,
      keywordResults,
      semanticWeight,
      keywordWeight,
      topK,
    );
  }

  async getCollectionStats(collectionName: string): Promise<CollectionStats> {
    if (!this.client) await this.initialize();
    
    const collection = await this.client!.getOrCreateCollection({
      name: collectionName,
    });

    const count = await collection.count();
    return { total_count: count };
  }

  async close(): Promise<void> {
    this.logger.log('ChromaDB 连接已关闭');
  }

  /**
   * 外部计算 BM25（简化实现）
   */
  private calculateBM25(
    metadatas: Record<string, any>[],
    queryText: string,
    topK: number,
  ): SearchResult[] {
    // TODO: 实现完整的 BM25 算法
    // 或使用 rank-bm25-js 库
    
    const queryTokens = queryText.toLowerCase().split(/\s+/);
    
    const scored = metadatas.map((meta, index) => {
      const content = meta.content || '';
      const contentLower = content.toLowerCase();
      
      // 简化的关键词匹配（非真正的 BM25）
      let score = 0;
      for (const token of queryTokens) {
        if (contentLower.includes(token)) {
          score += 1;
        }
      }
      
      return {
        content: content,
        metadata: meta,
        score: score,
        bm25_score: score,
      };
    });

    // 按分数排序
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * 融合与重排序（Min-Max 归一化 + 加权）
   */
  private fuseAndRerank(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    semanticWeight: number,
    keywordWeight: number,
    topK: number,
  ): SearchResult[] {
    // Step 1: 构建文档 ID 映射
    const docMap = new Map<string, SearchResult>();
    
    semanticResults.forEach(result => {
      const key = result.content;
      if (!docMap.has(key)) {
        docMap.set(key, { ...result });
      }
    });

    keywordResults.forEach(result => {
      const key = result.content;
      if (docMap.has(key)) {
        const existing = docMap.get(key)!;
        existing.bm25_score = result.bm25_score;
      } else {
        docMap.set(key, { ...result });
      }
    });

    // Step 2: Min-Max 归一化
    const semanticScores = semanticResults.map(r => r.semantic_score || 0);
    const keywordScores = keywordResults.map(r => r.bm25_score || 0);
    
    const semanticMin = Math.min(...semanticScores);
    const semanticMax = Math.max(...semanticScores);
    const keywordMin = Math.min(...keywordScores);
    const keywordMax = Math.max(...keywordScores);

    // Step 3: 加权融合
    const fused = Array.from(docMap.values()).map(doc => {
      const semanticNorm = semanticMax !== semanticMin
        ? ((doc.semantic_score || 0) - semanticMin) / (semanticMax - semanticMin)
        : 0;
      
      const keywordNorm = keywordMax !== keywordMin
        ? ((doc.bm25_score || 0) - keywordMin) / (keywordMax - keywordMin)
        : 0;
      
      const finalScore = semanticWeight * semanticNorm + keywordWeight * keywordNorm;
      
      return {
        ...doc,
        score: finalScore,
      };
    });

    // Step 4: 排序并返回 Top-K
    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, topK);
  }
}
```

### Step 3: 重构 VectorService

将当前的 `VectorService` 改为使用依赖注入的 `VectorDatabase` 接口：

```typescript
@Injectable()
export class VectorService {
  constructor(
    @Inject('VECTOR_DB') private vectorDb: VectorDatabase,
  ) {}

  async addChunksToCollection(...) {
    // 使用 vectorDb.addDocuments()
  }

  async searchSimilarChunks(...) {
    // 使用 vectorDb.hybridSearch() 或 semanticSearch()
  }
}
```

### Step 4: 模块配置

```typescript
@Module({
  providers: [
    {
      provide: 'VECTOR_DB',
      useClass: ChromaVectorDB,  // 可切换为 LanceDBVectorDB 等
    },
    VectorService,
  ],
})
export class KnowledgeBaseModule {}
```

---

## 🎯 关键优势

1. **解耦**：业务逻辑不依赖具体向量数据库实现
2. **可测试**：可以轻松 Mock `VectorDatabase` 接口
3. **可扩展**：添加新数据库只需实现接口
4. **向后兼容**：可以逐步迁移，不影响现有功能

---

## 📝 下一步行动

1. ✅ 创建 `VectorDatabase` 接口（已完成）
2. ⏳ 实现 `ChromaVectorDB` 类
3. ⏳ 实现 BM25 算法（或使用第三方库）
4. ⏳ 重构 `VectorService` 使用依赖注入
5. ⏳ 编写单元测试
6. ⏳ 更新文档

---

**注意**：由于时间和复杂度限制，建议先完成核心功能，再逐步完善 BM25 实现和测试。
