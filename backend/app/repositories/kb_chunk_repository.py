"""
知识库分块仓库 - 负责知识库分块的数据库操作
"""

from typing import List, Optional
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.kb_chunk import KBChunk


class KBChunkRepository:
    """知识库分块仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_chunk(
        self,
        file_id: str,
        knowledge_base_id: str,
        content: str,
        chunk_index: int,
        vector_id: Optional[str] = None,
        embedding_dimensions: Optional[int] = None,
        token_count: int = 0,
        metadata: Optional[dict] = None,
    ) -> KBChunk:
        """创建分块记录

        Args:
            file_id: 文件 ID
            knowledge_base_id: 知识库 ID
            content: 分块文本内容
            chunk_index: 分块索引
            vector_id: 向量 ID
            embedding_dimensions: 向量维度
            token_count: Token 数量
            metadata: 元数据

        Returns:
            KBChunk: 创建的 分块对象
        """
        chunk = KBChunk(
            file_id=file_id,
            knowledge_base_id=knowledge_base_id,
            content=content,
            chunk_index=chunk_index,
            vector_id=vector_id,
            embedding_dimensions=embedding_dimensions,
            token_count=token_count,
            metadata=metadata,
        )
        self.session.add(chunk)
        await self.session.flush()
        return chunk

    async def get_chunk(self, chunk_id: str) -> Optional[KBChunk]:
        """获取分块

        Args:
            chunk_id: 分块 ID

        Returns:
            Optional[KBChunk]: 分块对象，不存在返回 None
        """
        stmt = select(KBChunk).where(KBChunk.id == chunk_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_chunks_by_file(
        self,
        file_id: str,
        skip: int = 0,
        limit: int = 100,
    ) -> List[KBChunk]:
        """列出文件的分块

        Args:
            file_id: 文件 ID
            skip: 跳过数量
            limit: 返回数量限制

        Returns:
            List[KBChunk]: 分块列表
        """
        stmt = select(KBChunk).where(
            KBChunk.file_id == file_id
        ).order_by(KBChunk.chunk_index).offset(skip).limit(limit)
        
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_chunks_by_file_with_vector_ids(
        self,
        file_id: str,
    ) -> List[KBChunk]:
        """获取文件的所有分块（包含 vector_id）

        Args:
            file_id: 文件 ID

        Returns:
            List[KBChunk]: 分块列表，包含 vector_id
        """
        stmt = select(KBChunk).where(
            KBChunk.file_id == file_id
        ).order_by(KBChunk.chunk_index)
        
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def list_chunks_by_kb(
        self,
        knowledge_base_id: str,
        skip: int = 0,
        limit: int = 100,
    ) -> List[KBChunk]:
        """列出知识库的分块

        Args:
            knowledge_base_id: 知识库 ID
            skip: 跳过数量
            limit: 返回数量限制

        Returns:
            List[KBChunk]: 分块列表
        """
        stmt = select(KBChunk).where(
            KBChunk.knowledge_base_id == knowledge_base_id
        ).order_by(KBChunk.created_at.desc()).offset(skip).limit(limit)
        
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def delete_chunk(self, chunk_id: str) -> bool:
        """删除分块

        Args:
            chunk_id: 分块 ID

        Returns:
            bool: 是否成功删除
        """
        stmt = sql_delete(KBChunk).where(KBChunk.id == chunk_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def delete_chunks_by_file(self, file_id: str) -> int:
        """批量删除文件的分块

        Args:
            file_id: 文件 ID

        Returns:
            int: 删除的分块数量
        """
        stmt = sql_delete(KBChunk).where(KBChunk.file_id == file_id)
        result = await self.session.execute(stmt)
        return result.rowcount

    async def count_chunks(self, file_id: str) -> int:
        """统计分块数量

        Args:
            file_id: 文件 ID

        Returns:
            int: 分块数量
        """
        from sqlalchemy import func
        stmt = select(func.count(KBChunk.id)).where(
            KBChunk.file_id == file_id
        )
        result = await self.session.execute(stmt)
        return result.scalar() or 0
