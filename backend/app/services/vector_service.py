"""
向量存储服务

基于 ChromaDB 实现知识库分块的向量化存储和检索
支持多种 Embedding 模型提供商（OpenAI、阿里云、硅基流动等）

注意：当前使用同步客户端 + 线程池方案，避免阻塞事件循环
"""

import logging
from typing import List, Dict, Optional, Tuple
import chromadb
from chromadb.config import Settings
from openai import AsyncOpenAI
from concurrent.futures import ThreadPoolExecutor
import asyncio

logger = logging.getLogger(__name__)


class VectorService:
    """向量存储服务"""

    def __init__(self):
        """初始化向量服务"""
        self.chroma_client = None
        self.collection_map = {}  # kb_id -> collection
        # ✅ 新增：线程池，用于在异步上下文中执行同步操作
        self.executor = ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="chroma_worker"
        )

    def _get_chroma_client(self, persist_directory: str = "./data/chroma_db"):
        """获取 ChromaDB 客户端（单例模式）"""
        if self.chroma_client is None:
            # ✅ 使用统一的配置，避免 "instance already exists" 错误
            self.chroma_client = chromadb.PersistentClient(
                path=persist_directory,
                settings=chromadb.config.Settings(
                    anonymized_telemetry=False,
                    allow_reset=True,
                ),
            )
            logger.info(f"✅ ChromaDB 客户端已初始化：{persist_directory}")
        return self.chroma_client

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
            # ✅ 使用异步 OpenAI 客户端
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
        将分块添加到 ChromaDB 集合（异步方法，使用线程池执行同步操作）

        Args:
            knowledge_base_id: 知识库 ID
            chunks: 分块数据列表（包含 content, chunk_index, metadata 等）
            embeddings: 对应的向量嵌入列表

        Returns:
            List[str]: 添加的向量 ID 列表
        """
        loop = asyncio.get_event_loop()

        # 在线程池中执行同步操作（不阻塞事件循环）
        def _add_sync():
            client = self._get_chroma_client()

            # 获取或创建集合（每个知识库一个集合）
            collection_name = f"kb_{knowledge_base_id}"
            collection = client.get_or_create_collection(
                name=collection_name,
                metadata={"hnsw:space": "cosine"},  # 余弦相似度
            )

            # 准备数据
            ids = [
                f"chunk_{chunk['chunk_index']}_{chunk.get('file_id', 'unknown')}"
                for chunk in chunks
            ]

            documents = [chunk["content"] for chunk in chunks]
            metadatas = [chunk["metadata"] for chunk in chunks]

            # 添加到 ChromaDB
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas,
            )

            logger.info(f"✅ 添加 {len(ids)} 个分块到知识库 {knowledge_base_id}")
            return ids

        # 在线程池中执行，不阻塞事件循环
        try:
            ids = await loop.run_in_executor(self.executor, _add_sync)
            return ids
        except Exception as e:
            logger.error(f"❌ 添加分块到向量库失败：{e}")
            raise

    async def search_similar_chunks(
        self,
        knowledge_base_id: str,
        query_text: str,
        provider_name: str,
        model_name: str,
        top_k: int = 5,
        filter_metadata: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        搜索相似的分块（异步方法，使用线程池执行同步操作）

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
        loop = asyncio.get_event_loop()

        # 先获取查询文本的向量（这是异步方法）
        query_embedding = await self.get_embedding(
            query_text, provider_name, model_name
        )

        def _search_sync():
            client = self._get_chroma_client()

            # 获取集合
            collection_name = f"kb_{knowledge_base_id}"
            try:
                collection = client.get_collection(name=collection_name)
            except Exception:
                logger.warning(f"集合不存在：{collection_name}")
                return []

            # 搜索
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                where=filter_metadata,
                include=["documents", "metadatas", "distances"],
            )

            # 格式化结果
            formatted_results = []
            if results and results["documents"]:
                for i, doc in enumerate(results["documents"][0]):
                    result = {
                        "content": doc,
                        "metadata": (
                            results["metadatas"][0][i] if results["metadatas"] else {}
                        ),
                        "distance": (
                            results["distances"][0][i] if results["distances"] else 0
                        ),
                        "similarity": (
                            1 - results["distances"][0][i]
                            if results["distances"]
                            else 1.0
                        ),
                    }
                    formatted_results.append(result)

            logger.info(f"✅ 搜索到 {len(formatted_results)} 个相似分块")
            return formatted_results

        # 在线程池中执行
        try:
            return await loop.run_in_executor(self.executor, _search_sync)
        except Exception as e:
            logger.error(f"❌ 搜索相似分块失败：{e}")
            raise

    async def delete_collection(self, knowledge_base_id: str) -> bool:
        """
        删除知识库的向量集合（异步方法，使用线程池执行同步操作）

        Args:
            knowledge_base_id: 知识库 ID

        Returns:
            bool: 是否成功删除
        """
        loop = asyncio.get_event_loop()

        def _delete_sync():
            client = self._get_chroma_client()

            try:
                collection_name = f"kb_{knowledge_base_id}"
                client.delete_collection(name=collection_name)
                logger.info(f"✅ 删除知识库向量集合：{knowledge_base_id}")
                return True
            except Exception as e:
                logger.error(f"删除向量集合失败：{e}")
                return False

        # 在线程池中执行
        try:
            return await loop.run_in_executor(self.executor, _delete_sync)
        except Exception as e:
            logger.error(f"❌ 删除向量集合失败：{e}")
            return False

    async def get_collection_stats(self, knowledge_base_id: str) -> Optional[Dict]:
        """
        获取知识库向量集合的统计信息（异步方法，使用线程池执行同步操作）

        Args:
            knowledge_base_id: 知识库 ID

        Returns:
            Optional[Dict]: 统计信息（total_count 等），集合不存在返回 None
        """
        loop = asyncio.get_event_loop()

        def _stats_sync():
            client = self._get_chroma_client()

            try:
                collection_name = f"kb_{knowledge_base_id}"
                collection = client.get_collection(name=collection_name)

                # 获取集合大小
                count = collection.count()

                return {
                    "total_count": count,
                    "collection_name": collection_name,
                }
            except Exception:
                logger.warning(f"集合不存在：kb_{knowledge_base_id}")
                return None

        # 在线程池中执行
        try:
            return await loop.run_in_executor(self.executor, _stats_sync)
        except Exception as e:
            logger.error(f"❌ 获取集合统计信息失败：{e}")
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
