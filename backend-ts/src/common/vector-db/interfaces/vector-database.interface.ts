/**
 * 向量数据库抽象接口定义
 * 
 * 提供统一的向量数据库操作接口，支持多种后端实现：
 * - LanceDB (本地文件模式)
 * - ChromaDB
 * - Qdrant
 * - 其他向量数据库
 * 
 * Metadata 过滤规范：
 * - 支持 document_id 字段作为标准过滤字段
 * - 不支持的 metadata 字段可以使用 __metadata_xxxx 形式作为独立列
 * - 返回时自动将 __metadata_xxxx 字段重组为 metadata 对象
 */

/**
 * Chunk 数据结构
 */
export interface VectorChunk {
  id: string;
  documentId: string; // 独立顶层字段，用于过滤和批量删除
  content: string;
  metadata?: Record<string, any>;
}

/**
 * 带向量的 Chunk（内部使用）
 */
export interface VectorDocument extends VectorChunk {
  embedding: number[];
}

/**
 * 搜索结果
 */
export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  score: number; // 最终分数（混合搜索）或 BM25/语义分数
  bm25Score?: number;
  semanticScore?: number;
}

/**
 * 集合统计信息
 */
export interface CollectionStats {
  total_count: number;
  [key: string]: any;
}

/**
 * 向量数据库抽象接口
 * 
 * 所有向量数据库实现必须实现此接口
 */
export interface VectorDatabase {
  /**
   * 初始化数据库连接
   */
  initialize(): Promise<void>;

  /**
   * 创建集合
   * @param collectionName 集合名称
   * @param vectorSize 向量维度
   * @param metadata 集合元数据
   */
  createCollection(
    collectionName: string,
    vectorSize: number,
    metadata?: Record<string, any>,
  ): Promise<void>;

  /**
   * 删除集合
   * @param collectionName 集合名称
   * @returns 是否删除成功
   */
  deleteCollection(collectionName: string): Promise<boolean>;

  /**
   * 检查集合是否存在
   * @param collectionName 集合名称
   * @returns 集合是否存在
   */
  collectionExists(collectionName: string): Promise<boolean>;

  /**
   * 添加文档到集合
   * @param collectionName 集合名称（tableId）
   * @param documents 文档列表
   * @returns 添加的文档 ID 列表
   */
  addDocuments(
    collectionName: string,
    documents: VectorDocument[],
  ): Promise<string[]>;

  /**
   * 删除文档（支持 IDs 或 documentId 过滤）
   * @param collectionName 集合名称
   * @param options 删除选项（ids 和 documentId 至少提供一个）
   * @returns 删除的文档数量
   */
  deleteDocuments(
    collectionName: string,
    options?: {
      ids?: string[];
      documentId?: string;
    },
  ): Promise<number>;

  /**
   * 语义搜索（向量相似度搜索）
   * @param collectionName 集合名称
   * @param queryEmbedding 查询向量
   * @param topK 返回结果数量
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @returns 搜索结果列表（按相似度降序）
   */
  semanticSearch(
    collectionName: string,
    queryEmbedding: number[],
    topK?: number,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]>;

  /**
   * 关键词搜索（BM25）
   * @param collectionName 集合名称
   * @param queryText 查询文本
   * @param topK 返回结果数量
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @returns 搜索结果列表（按 BM25 分数降序）
   */
  keywordSearch(
    collectionName: string,
    queryText: string,
    topK?: number,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]>;

  /**
   * 混合搜索（语义 + 关键词加权融合）
   * @param collectionName 集合名称
   * @param queryEmbedding 查询向量
   * @param queryText 查询文本
   * @param topK 返回结果数量
   * @param semanticWeight 语义权重 (0-1)
   * @param keywordWeight 关键词权重 (0-1)
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @returns 搜索结果列表（按最终分数降序）
   */
  hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    topK?: number,
    semanticWeight?: number,
    keywordWeight?: number,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]>;

  /**
   * 获取集合统计信息
   * @param collectionName 集合名称
   * @returns 统计信息字典
   */
  getCollectionStats(collectionName: string): Promise<CollectionStats>;

  /**
   * 关闭数据库连接
   */
  close(): Promise<void>;
}
