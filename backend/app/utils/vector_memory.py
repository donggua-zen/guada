"""
向量记忆管理模块

该模块提供基于Chroma向量数据库的记忆存储和检索功能，主要用于:
1. 对话内容的向量化存储
2. 相似对话历史的检索
3. 按会话ID管理记忆
4. 记忆的增删改查操作

通过将文本转换为向量表示，实现高效的语义相似性搜索，支持角色扮演对话系统中的上下文记忆功能。
"""

import logging
from typing import List, Dict, Optional
from openai import OpenAI
import chromadb
from openai import OpenAI
from typing import List, Dict, Optional
import chromadb
from openai import OpenAI
import ulid
from typing import List, Dict, Optional
import time

from app.repositories.model_repository import ModelRepository

logger = logging.getLogger(__name__)


class _VectorMemory:
    def __init__(
        self,
        collection_name: str = "roleplay_conversations",
        persist_directory: str = "./data/chroma_db",
    ):
        """
        初始化向量记忆管理器

        Args:
            collection_name: 集合名称，用于区分不同的记忆库
            persist_directory: Chroma数据持久化目录
        """

        # 初始化Chroma客户端（持久化模式）
        # self.chroma_client = chromadb.Client(
        #     Settings(
        #         chroma_db_impl="duckdb+parquet", persist_directory=persist_directory
        #     )
        # )

        # 初始化Chroma客户端（新API）
        self.chroma_client = chromadb.PersistentClient(path=persist_directory)

        # 创建或获取集合
        self.collection = self.chroma_client.get_or_create_collection(
            name=collection_name, metadata={"hnsw:space": "cosine"}  # 使用余弦相似度
        )

        # 保存持久化目录
        self.persist_directory = persist_directory

    def _get_embedding(self, text: str) -> List[float]:
        """
        使用OpenAI的文本嵌入模型获取文本向量

        Args:
            text: 要嵌入的文本

        Returns:
            文本的向量表示
        """

        provider = ModelRepository.get_provider_by_name("硅基流动")

        # 初始化OpenAI客户端
        openai_client = OpenAI(
            base_url=provider["api_url"], api_key=provider["api_key"]
        )
        try:
            response = openai_client.embeddings.create(
                model="text-embedding-v4", input=text  # 可根据需要更换模型
            )
            return response.data[0].embedding
        except Exception as e:
            logger.exception(f"获取嵌入时出错: {e}")
            raise

    def add_memory(
        self, content: str, session_id: str, metadata: Optional[Dict] = None
    ) -> str:
        """
        添加记忆到集合中

        Args:
            content: 要存储的文本内容
            session_id: 会话ID，用于区分不同对话
            metadata: 可选的元数据

        Returns:
            生成的内存ID (ULID格式)
        """
        # 生成ULID
        memory_id = str(ulid.new())

        # 获取内容嵌入
        embedding = self._get_embedding(content)

        # 准备元数据，确保包含session_id
        if metadata is None:
            metadata = {}
        metadata["session_id"] = session_id
        metadata["timestamp"] = time.time()  # 添加时间戳

        # 添加到集合
        self.collection.add(
            ids=[memory_id],
            embeddings=[embedding],
            metadatas=[metadata],
            documents=[content],
        )

        return memory_id

    def query_memories(
        self,
        query_text: str,
        session_id: Optional[str] = None,
        n_results: int = 5,
        where=None,
    ) -> List[Dict]:
        """
        查询相似记忆，支持按session_id筛选

        Args:
            query_text: 查询文本
            session_id: 可选，指定要查询的会话ID
            n_results: 返回的结果数量

        Returns:
            相似记忆列表，包含内容、元数据和相似度分数
        """
        # 获取查询文本的嵌入
        query_embedding = self._get_embedding(query_text)

        # 构建查询条件
        where_condition = where
        if session_id:
            if where_condition is None:
                where_condition = {"session_id": session_id}
            else:
                where_condition = {
                    "$and": [where_condition, {"session_id": session_id}]
                }

        # 执行查询
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where_condition,  # 添加筛选条件
            include=["metadatas", "documents", "distances"],
        )

        # 格式化结果
        formatted_results = []
        if results["ids"]:
            for i in range(len(results["ids"][0])):
                formatted_results.append(
                    {
                        "id": results["ids"][0][i],
                        "content": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i],
                        "score": 1
                        - results["distances"][0][i],  # 将距离转换为相似度分数
                    }
                )

        # 按ULID时间戳排序（ULID本身包含时间信息，按ID排序即可）
        # formatted_results.sort(key=lambda x: x["id"])

        return formatted_results

    def delete_memory(self, memory_id: str, session_id: Optional[str] = None) -> bool:
        """
        删除指定记忆，可选的session_id验证

        Args:
            memory_id: 要删除的记忆ID
            session_id: 可选，用于验证记忆是否属于指定会话

        Returns:
            删除是否成功
        """
        try:
            # 如果需要验证session_id
            if session_id:
                # 先获取记忆的元数据
                memory_data = self.collection.get(
                    ids=[memory_id], include=["metadatas"]
                )
                if not memory_data["ids"]:
                    return False  # 记忆不存在

                # 检查session_id是否匹配
                actual_session_id = memory_data["metadatas"][0].get("session_id")
                if actual_session_id != session_id:
                    return False  # session_id不匹配

            # 删除记忆
            self.collection.delete(ids=[memory_id])
            # self.chroma_client.persist()
            return True
        except Exception as e:
            logger.exception(f"删除记忆时出错: {e}")
            return False

    def delete_session_memories(self, session_id: str) -> bool:
        """
        删除指定会话的所有记忆

        Args:
            session_id: 要删除的会话ID

        Returns:
            删除是否成功
        """
        try:
            # 获取会话的所有记忆ID
            session_memories = self.collection.get(
                where={"session_id": session_id}, include=["metadatas"]
            )

            if session_memories["ids"]:
                self.collection.delete(ids=session_memories["ids"])

            # self.chroma_client.persist()
            return True
        except Exception as e:
            logger.exception(f"删除会话记忆时出错: {e}")
            return False

    def delete_memory_by_message_id(self, message_id: str) -> bool:
        """
        删除指定会话的所有记忆

        Args:
            session_id: 要删除的会话ID

        Returns:
            删除是否成功
        """
        try:
            # 获取会话的所有记忆ID
            session_memories = self.collection.get(
                where={"message_id": message_id},
                include=["metadatas"],
            )

            if session_memories["ids"]:
                self.collection.delete(ids=session_memories["ids"])

            # self.chroma_client.persist()
            return True
        except Exception as e:
            logger.exception(f"删除会话记忆时出错: {e}")
            return False

    def get_session_memories(self, session_id: str) -> List[Dict]:
        """
        获取指定会话的所有记忆

        Args:
            session_id: 会话ID

        Returns:
            会话的所有记忆列表
        """
        try:
            # 获取会话的所有记忆
            results = self.collection.get(
                where={"session_id": session_id}, include=["metadatas", "documents"]
            )

            # 格式化结果
            formatted_results = []
            for i in range(len(results["ids"])):
                formatted_results.append(
                    {
                        "id": results["ids"][i],
                        "content": results["documents"][i],
                        "metadata": results["metadatas"][i],
                    }
                )

            # 按ULID排序（时间顺序）
            # formatted_results.sort(key=lambda x: x["id"])

            return formatted_results
        except Exception as e:
            logger.exception(f"获取会话记忆时出错: {e}")
            return []

    def get_all_memories(self, session_id: Optional[str] = None) -> List[Dict]:
        """
        获取所有记忆，支持按session_id筛选

        Args:
            session_id: 可选，指定要获取的会话ID

        Returns:
            所有记忆的列表
        """
        try:
            # 构建查询条件
            where_condition = None
            if session_id:
                where_condition = {"session_id": session_id}

            # 获取记忆
            results = self.collection.get(
                where=where_condition, include=["metadatas", "documents"]
            )

            # 格式化结果
            formatted_results = []
            for i in range(len(results["ids"])):
                formatted_results.append(
                    {
                        "id": results["ids"][i],
                        "content": results["documents"][i],
                        "metadata": results["metadatas"][i],
                    }
                )

            # 按ULID排序（时间顺序）
            # formatted_results.sort(key=lambda x: x["id"])

            return formatted_results
        except Exception as e:
            logger.exception(f"获取所有记忆时出错: {e}")
            return []

    def clear_collection(self) -> bool:
        """
        清空整个集合

        Returns:
            清空是否成功
        """
        try:
            # 获取所有ID
            all_ids = self.collection.get()["ids"]
            if all_ids:
                self.collection.delete(ids=all_ids)
            # self.chroma_client.persist()
            return True
        except Exception as e:
            logger.exception(f"清空集合时出错: {e}")
            return False

    def __del__(self):
        """析构函数，确保资源被正确清理"""
        try:
            self.chroma_client.close()
        except Exception as e:
            pass


_vector_memory = _VectorMemory()


def get_vector_memory() -> _VectorMemory:
    """获取向量内存实例"""
    return _vector_memory
