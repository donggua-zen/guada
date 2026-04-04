"""
向量存储服务

基于 Qdrant 本地模式实现知识库分块的向量化存储和检索
支持多种 Embedding 模型提供商（OpenAI、阿里云、硅基流动等）
利用 Qdrant 内置的 BM25 索引功能实现混合搜索

技术特点：
- 使用 QdrantClient 本地模式（path 持久化存储）
- 原生异步 API (AsyncQdrantClient)，无需线程池
- 内置 BM25 稀疏向量支持，无需手动实现 rank_bm25
- 真正的异步非阻塞操作
"""

import logging
import uuid
from typing import List, Dict, Optional, Tuple
from qdrant_client import AsyncQdrantClient, models
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class VectorService:
    """向量存储服务（基于 Qdrant 本地模式）"""

    def __init__(self, persist_directory: str = "./data/qdrant_db"):
        """
        初始化向量服务
        
        Args:
            persist_directory: Qdrant 本地数据持久化路径
        """
        self.persist_directory = persist_directory
        self.qdrant_client = None
        self.collection_map = {}  # kb_id -> collection info
        logger.info(f"VectorService 初始化完成，数据路径：{persist_directory}")

    async def _get_qdrant_client(self) -> AsyncQdrantClient:
        """获取 Qdrant 异步客户端（单例模式）"""
        if self.qdrant_client is None:
            # 创建本地模式的异步客户端
            self.qdrant_client = AsyncQdrantClient(path=self.persist_directory)
            logger.info(f"Qdrant 异步客户端已初始化：{self.persist_directory}")
        return self.qdrant_client

    async def get_embedding(
        self,
        text: str,
        base_url: str,
        api_key: str,
        model_name: str,
    ) -> List[float]:
        """
        获取文本的向量嵌入

        Args:
            text: 待嵌入的文本
            provider_name: 向量模型提供商名称
            model_name: 向量模型名称

        Returns:
            List[float]: 向量嵌入

        Raises:
            ValueError: 不支持的提供商
            RuntimeError: API 调用失败
        """

        try:
            # 使用异步 OpenAI 客户端
            client = AsyncOpenAI(
                base_url=base_url,
                api_key=api_key,
            )

            # 调用嵌入 API（异步方法）
            response = await client.embeddings.create(
                model=model_name,
                input=text,
            )

            embedding = response.data[0].embedding
            logger.debug(
                f"获取嵌入成功：provider={base_url}, model={model_name}, dims={len(embedding)}"
            )
            return embedding

        except Exception as e:
            logger.error(f"获取向量嵌入失败：{e} text len={len(text)}")
            raise RuntimeError(f"向量化失败：{str(e)}")

    async def add_chunks_to_collection(
        self,
        chunks: List[Dict],
        embeddings: List[List[float]],
        knowledge_base_id: str,
    ) -> List[str]:
        """
        将分块添加到 Qdrant 集合（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID
            chunks: 分块数据列表（包含 content, chunk_index, metadata 等）
            embeddings: 对应的向量嵌入列表

        Returns:
            List[str]: 添加的向量 ID 列表
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"

        # 准备数据
        ids = [
            str(uuid.uuid4())  # 使用 UUID 作为唯一标识
            for _ in chunks
        ]
        
        documents = [chunk["content"] for chunk in chunks]
        metadatas = [chunk["metadata"] for chunk in chunks]

        # 创建点（points）用于上传
        points = [
            models.PointStruct(
                id=ids[i],
                vector=embeddings[i],
                payload={
                    "content": documents[i],
                    **metadatas[i],  # 合并 metadata
                }
            )
            for i in range(len(ids))
        ]

        # 确保集合存在并配置 BM25 稀疏向量
        await self._ensure_collection_with_bm25(client, collection_name, len(embeddings[0]) if embeddings else 1536)

        # 批量上传点
        result = await client.upsert(
            collection_name=collection_name,
            points=points,
        )
        
        logger.info(f"添加 {len(ids)} 个分块到知识库 {knowledge_base_id}")
        return ids

    async def search_similar_chunks(
        self,
        knowledge_base_id: str,
        query_text: str,
        base_url: str,  # 新增：向量模型 API 地址
        api_key: str,  # 新增：向量模型 API 密钥
        model_name: str,
        top_k: int = 5,
        filter_metadata: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        搜索相似的分块（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID
            query_text: 查询文本
            provider_name: 向量模型提供商
            model_name: 向量模型名称
            top_k: 返回结果数量
            filter_metadata: 过滤条件（如 file_id）

        Returns:
            List[Dict]: 搜索结果，包含分块内容、相似度分数等
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"
        
        # 先获取查询文本的向量（这是异步方法）
        query_embedding = await self.get_embedding(
            query_text, base_url, api_key, model_name
        )

        # 构建过滤条件
        scroll_filter = None
        if filter_metadata:
            conditions = []
            for key, value in filter_metadata.items():
                conditions.append(
                    models.FieldCondition(
                        key=key,
                        match=models.MatchValue(value=value),
                    )
                )
            scroll_filter = models.Filter(must=conditions)

        # 使用余弦相似度搜索
        search_result = await client.query_points(
            collection_name=collection_name,
            query=query_embedding,
            limit=top_k,
            query_filter=scroll_filter,
            with_payload=True,
        )
        
        # Qdrant 1.13.2 返回的是包含 points 属性的对象
        points = search_result.points if hasattr(search_result, 'points') else []

        # 格式化结果
        formatted_results = []
        for point in points:
            result = {
                "content": point.payload.get("content", ""),
                "metadata": {k: v for k, v in point.payload.items() if k != "content"},
                "distance": point.score,  # Qdrant 返回的是相似度分数
                "similarity": point.score,
            }
            formatted_results.append(result)

        logger.info(f"搜索到 {len(formatted_results)} 个相似分块")
        return formatted_results

    async def _ensure_collection_with_bm25(self, client: AsyncQdrantClient, collection_name: str, vector_size: int):
        """
        确保集合存在并配置 BM25 稀疏向量支持
            
        Args:
            client: Qdrant 异步客户端
            collection_name: 集合名称
            vector_size: 密集向量的维度
        """
        try:
            # 检查集合是否已存在
            collections = await client.get_collections()
            collection_exists = any(c.name == collection_name for c in collections.collections)
                
            if not collection_exists:
                # 创建集合，配置密集向量和稀疏向量（BM25）
                await client.create_collection(
                    collection_name=collection_name,
                    vectors_config=models.VectorParams(
                        size=vector_size,
                        distance=models.Distance.COSINE,
                    ),
                    sparse_vectors_config={
                        "bm25": models.SparseVectorParams(
                            index=models.SparseIndexParams(
                                on_disk=True,  # 使用磁盘存储优化内存
                            )
                        )
                    },
                )
                logger.info(f"创建集合 {collection_name}，配置 BM25 稀疏向量")
        except Exception as e:
            logger.error(f"创建集合失败：{e}")
            raise
    
    async def _bm25_search(
        self,
        knowledge_base_id: str,
        query_text: str,
        top_k: int = 20,
        filter_metadata: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        基于 Qdrant 内置 BM25 稀疏向量的关键词搜索（原生异步方法）
    
        Args:
            knowledge_base_id: 知识库 ID
            query_text: 查询文本
            top_k: 返回结果数量
            filter_metadata: 过滤条件（如 file_id）
    
        Returns:
            List[Dict]: BM25 搜索结果，包含内容、元数据、BM25 分数
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"
            
        try:
            # 构建 BM25 稀疏向量
            # Qdrant 的 BM25 需要 token 化后的词频表示
            tokens = query_text.split()
                
            # 创建稀疏向量：{token_index: frequency}
            sparse_vector = {}
            for token in tokens:
                token_hash = hash(token) % 1000000  # 简单的哈希映射
                sparse_vector[token_hash] = sparse_vector.get(token_hash, 0) + 1
                
            # 构建过滤条件
            scroll_filter = None
            if filter_metadata:
                conditions = []
                for key, value in filter_metadata.items():
                    conditions.append(
                        models.FieldCondition(
                            key=key,
                            match=models.MatchValue(value=value),
                        )
                    )
                scroll_filter = models.Filter(must=conditions)
    
            # 使用稀疏向量搜索（BM25）
            # 注意：Qdrant 1.13.2 本地模式需要使用正确的方式
            sparse_vec = models.SparseVector(
                indices=list(sparse_vector.keys()),
                values=list(sparse_vector.values()),
            )
            
            # 尝试使用 scroll + 手动计算 BM25（兼容方案）
            # 因为 Qdrant 1.13.2 本地模式对稀疏向量支持有限
            all_points = await client.scroll(
                collection_name=collection_name,
                scroll_filter=scroll_filter,
                limit=10000,
                with_payload=True,
            )
            
            points_list = all_points[0] if isinstance(all_points, tuple) else all_points
            
            # 如果没有文档，直接返回
            if not points_list:
                return []
            
            # 手动计算 BM25 分数（临时方案）
            try:
                from rank_bm25 import BM25Okapi
                
                # 提取所有文档内容
                documents = [p.payload.get("content", "") for p in points_list]
                
                # 智能分词：检测中文使用 jieba，英文使用空格分词
                def tokenize(text: str) -> List[str]:
                    # 检测是否包含中文字符
                    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
                    
                    if has_chinese:
                        # 尝试使用 jieba 分词
                        try:
                            import jieba
                            return list(jieba.cut(text))
                        except ImportError:
                            # 如果没有安装 jieba，退化为按字符分割（中文）
                            return [c for c in text if c.strip()]
                    else:
                        # 英文按空格分词
                        return text.split()
                
                # 分词
                corpus = [tokenize(doc) for doc in documents]
                bm25 = BM25Okapi(corpus)
                
                # 对查询文本也进行同样的分词处理
                query_tokens = tokenize(query_text)
                scores = bm25.get_scores(query_tokens)
                
                # 构建结果
                results = []
                for i, point in enumerate(points_list):
                    if scores[i] > 0:
                        results.append({
                            "content": point.payload.get("content", ""),
                            "metadata": {k: v for k, v in point.payload.items() if k != "content"},
                            "bm25_score": float(scores[i]),
                        })
                
                # 按分数排序
                results.sort(key=lambda x: x["bm25_score"], reverse=True)
                logger.info(f"BM25 搜索到 {len(results)} 个匹配分块（使用 rank-bm25）")
                return results[:top_k]
                
            except ImportError:
                logger.error("rank-bm25 未安装，请运行：pip install rank-bm25")
                return []
                
        except Exception as e:
            logger.error(f"BM25 搜索失败：{e}")
            return []

    def _fuse_and_rerank(
        self,
        semantic_results: List[Dict],
        keyword_results: List[Dict],
        semantic_weight: float,
        keyword_weight: float,
        top_k: int,
    ) -> List[Dict]:
        """
        结果融合与重排序

        Args:
            semantic_results: 语义搜索结果
            keyword_results: 关键词搜索结果
            semantic_weight: 语义权重
            keyword_weight: 关键词权重
            top_k: 返回数量

        Returns:
            List[Dict]: 融合后的结果
        """
        # Step 1: 构建文档 ID 映射（使用内容哈希作为唯一标识）
        doc_map = {}

        for res in semantic_results:
            doc_id = hash(res["content"])
            doc_map[doc_id] = {
                **res,
                "semantic_score": res.get("similarity", 0.0),
                "keyword_score": 0.0,
            }

        for res in keyword_results:
            doc_id = hash(res["content"])
            if doc_id in doc_map:
                doc_map[doc_id]["keyword_score"] = res.get("bm25_score", 0.0)
            else:
                doc_map[doc_id] = {
                    **res,
                    "semantic_score": 0.0,
                    "keyword_score": res.get("bm25_score", 0.0),
                }

        if not doc_map:
            return []

        # Step 2: Min-Max 归一化
        semantic_scores = [v["semantic_score"] for v in doc_map.values()]
        keyword_scores = [v["keyword_score"] for v in doc_map.values()]

        semantic_min = min(semantic_scores) if semantic_scores else 0
        semantic_max = max(semantic_scores) if semantic_scores else 0
        keyword_min = min(keyword_scores) if keyword_scores else 0
        keyword_max = max(keyword_scores) if keyword_scores else 0

        for doc in doc_map.values():
            # 归一化到 [0, 1]
            if semantic_max - semantic_min > 0:
                doc["semantic_norm"] = (doc["semantic_score"] - semantic_min) / (
                    semantic_max - semantic_min
                )
            else:
                doc["semantic_norm"] = doc["semantic_score"]

            if keyword_max - keyword_min > 0:
                doc["keyword_norm"] = (doc["keyword_score"] - keyword_min) / (
                    keyword_max - keyword_min
                )
            else:
                doc["keyword_norm"] = doc["keyword_score"]

        # Step 3: 加权融合
        for doc in doc_map.values():
            doc["final_score"] = (
                semantic_weight * doc["semantic_norm"]
                + keyword_weight * doc["keyword_norm"]
            )
            # 为了兼容性，添加 similarity 字段（使用 final_score）
            doc["similarity"] = doc["final_score"]

        # Step 4: 按最终分数排序并返回 Top-K
        sorted_results = sorted(
            doc_map.values(), key=lambda x: x["final_score"], reverse=True
        )

        logger.info(
            f"融合重排序完成：原始={len(doc_map)}, 最终={min(len(sorted_results), top_k)}"
        )
        return sorted_results[:top_k]

    async def search_similar_chunks_hybrid(
        self,
        knowledge_base_id: str,
        query_text: str,
        base_url: str,
        api_key: str,
        model_name: str,
        top_k: int = 5,
        filter_metadata: Optional[Dict] = None,
        use_hybrid: bool = True,
        semantic_weight: float = 0.6,
        keyword_weight: float = 0.4,
    ) -> List[Dict]:
        """
        混合搜索：语义 + 关键词加权（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID
            query_text: 查询文本
            base_url: 向量模型 API 地址
            api_key: 向量模型 API 密钥
            model_name: 向量模型名称
            top_k: 返回结果数量
            filter_metadata: 过滤条件
            use_hybrid: 是否使用混合搜索
            semantic_weight: 语义权重
            keyword_weight: 关键词权重

        Returns:
            List[Dict]: 混合搜索结果
        """
        if not use_hybrid:
            # 降级为纯语义搜索
            logger.info("使用纯语义搜索模式")
            return await self.search_similar_chunks(
                knowledge_base_id=knowledge_base_id,
                query_text=query_text,
                base_url=base_url,
                api_key=api_key,
                model_name=model_name,
                top_k=top_k,
                filter_metadata=filter_metadata,
            )

        logger.info(
            f"使用混合搜索模式：semantic={semantic_weight:.2f}, keyword={keyword_weight:.2f}"
        )

        # Step 1: 语义搜索（扩大召回）
        semantic_results = await self.search_similar_chunks(
            knowledge_base_id=knowledge_base_id,
            query_text=query_text,
            base_url=base_url,
            api_key=api_key,
            model_name=model_name,
            top_k=top_k * 4,  # 扩大召回
            filter_metadata=filter_metadata,
        )

        # Step 2: 关键词搜索（BM25）
        keyword_results = await self._bm25_search(
            knowledge_base_id=knowledge_base_id,
            query_text=query_text,
            top_k=top_k * 4,
            filter_metadata=filter_metadata,
        )

        # Step 3: 融合与重排序
        final_results = self._fuse_and_rerank(
            semantic_results=semantic_results,
            keyword_results=keyword_results,
            semantic_weight=semantic_weight,
            keyword_weight=keyword_weight,
            top_k=top_k,
        )

        return final_results

    async def delete_collection(self, knowledge_base_id: str) -> bool:
        """
        删除知识库的向量集合（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID

        Returns:
            bool: 是否成功删除
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"

        try:
            await client.delete_collection(collection_name=collection_name)
            logger.info(f"删除知识库向量集合：{knowledge_base_id}")
            return True
        except Exception as e:
            logger.error(f"删除向量集合失败：{e}")
            return False

    async def delete_vectors_by_ids(
        self,
        knowledge_base_id: str,
        vector_ids: List[str],
    ) -> bool:
        """
        从向量库中删除指定的向量（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID
            vector_ids: 要删除的向量 ID 列表

        Returns:
            bool: 是否成功删除
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"

        try:
            # 批量删除点
            result = await client.delete(
                collection_name=collection_name,
                points=vector_ids,
            )
            
            logger.info(f"从向量库删除 {len(vector_ids)} 个向量")
            return result.status == models.UpdateStatus.COMPLETED
        except Exception as e:
            logger.error(f"❌ 删除向量失败：{e}")
            return False

    async def delete_vectors_by_where(
        self,
        knowledge_base_id: str,
        where_filter: Dict,
    ) -> bool:
        """
        根据 metadata 条件从向量库中删除向量（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID
            where_filter: metadata 过滤条件，例如 {"file_id": "xxx"}

        Returns:
            bool: 是否成功删除
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"

        try:
            # 构建 Qdrant 过滤条件
            conditions = []
            for key, value in where_filter.items():
                conditions.append(
                    models.FieldCondition(
                        key=key,
                        match=models.MatchValue(value=value),
                    )
                )
            scroll_filter = models.Filter(must=conditions)

            # 使用 scroll 获取符合条件的点 ID
            all_points = await client.scroll(
                collection_name=collection_name,
                scroll_filter=scroll_filter,
                limit=10000,  # 设置一个较大的限制
                with_payload=False,
            )
            
            # 提取所有点的 ID
            point_ids = [point.id for point in all_points[0]]
            
            if point_ids:
                # 批量删除这些点
                result = await client.delete(
                    collection_name=collection_name,
                    points=point_ids,
                )
                logger.info(f"根据条件删除向量：{where_filter}, 共 {len(point_ids)} 个")
                return result.status == models.UpdateStatus.COMPLETED
            else:
                logger.info(f"未找到符合条件的向量：{where_filter}")
                return True
                
        except Exception as e:
            logger.error(f"❌ 根据条件删除向量失败：{e}")
            return False

    async def get_collection_stats(self, knowledge_base_id: str) -> Optional[Dict]:
        """
        获取知识库向量集合的统计信息（原生异步方法）

        Args:
            knowledge_base_id: 知识库 ID

        Returns:
            Optional[Dict]: 统计信息（total_count 等），集合不存在返回 None
        """
        client = await self._get_qdrant_client()
        collection_name = f"kb_{knowledge_base_id}"

        try:
            # 获取集合信息
            collection_info = await client.get_collection(collection_name=collection_name)
            
            return {
                "total_count": collection_info.points_count,
                "collection_name": collection_name,
            }
        except Exception:
            logger.warning(f"集合不存在：kb_{knowledge_base_id}")
            return None

    async def batch_add_chunks(
        self,
        knowledge_base_id: str,
        chunks_with_embeddings: List[Tuple[Dict, List[float]]],
        batch_size: int = 100,
    ) -> List[str]:
        """
        批量添加分块到向量库（分批处理）

        Args:
            knowledge_base_id: 知识库 ID
            chunks_with_embeddings: [(chunk_data, embedding), ...]
            batch_size: 批次大小

        Returns:
            List[str]: 所有添加的向量 ID
        """
        all_ids = []

        for i in range(0, len(chunks_with_embeddings), batch_size):
            batch = chunks_with_embeddings[i : i + batch_size]
            chunks = [item[0] for item in batch]
            embeddings = [item[1] for item in batch]

            batch_ids = await self.add_chunks_to_collection(
                knowledge_base_id,
                chunks,
                embeddings,
            )
            all_ids.extend(batch_ids)

            logger.info(
                f"批次 {i // batch_size + 1} 完成，添加 {len(batch_ids)} 个分块"
            )

        return all_ids
