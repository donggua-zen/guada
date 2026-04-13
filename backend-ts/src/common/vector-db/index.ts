/**
 * 向量数据库模块
 *
 * 提供统一的向量数据库抽象层，支持多种后端实现：
 * - SQLite (本地文件模式 + sqlite-vec)
 *
 * 使用示例：
 * ```typescript
 * import { VectorDatabase, SqliteVectorDB } from '@/common/vector-db';
 *
 * const vectorDb = new SqliteVectorDB();
 * await vectorDb.initialize();
 *
 * // 语义搜索
 * const results = await vectorDb.semanticSearch('collection', embedding);
 *
 * // 关键词搜索
 * const keywordResults = await vectorDb.keywordSearch('collection', 'query');
 *
 * // 混合搜索
 * const hybridResults = await vectorDb.hybridSearch(
 *   'collection',
 *   embedding,
 *   'query',
 *   5,
 *   0.6,  // 语义权重
 *   0.4,  // 关键词权重
 * );
 * ```
 */

// 导出接口和类型
export {
  VectorDatabase,
  SearchResult,
  VectorDocument,
  VectorChunk,
  CollectionStats,
} from "./interfaces/vector-database.interface";

// 导出实现
export { SqliteVectorDB } from "./implementations";

// 导出服务层
export { VectorDbService } from "./vector-db.service";

// 导出模块
export { VectorDbModule } from "./vector-db.module";

// 未来添加其他实现
// export { ChromaVectorDB, QdrantVectorDB } from './implementations';
