"""
知识库仓库 - 负责知识库的数据库操作
"""

from typing import List, Optional
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.knowledge_base import KnowledgeBase


class KBRepository:
    """知识库仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_kb(
        self,
        name: str,
        user_id: str,
        embedding_model_id: str,
        description: Optional[str] = None,
        chunk_max_size: int = 1000,
        chunk_overlap_size: int = 100,
        chunk_min_size: int = 50,
        is_public: bool = False,
        metadata_config: Optional[dict] = None,
    ) -> KnowledgeBase:
        """创建知识库

        Args:
            name: 知识库名称
            user_id: 用户 ID
            embedding_model_id: 向量模型 ID（关联 model 表）
            description: 知识库描述
            chunk_max_size: 最大分块大小
            chunk_overlap_size: 分块重叠大小
            chunk_min_size: 最小分块大小
            is_public: 是否公开
            metadata_config: 额外配置

        Returns:
            KnowledgeBase: 创建的知识库对象
        """
        kb = KnowledgeBase(
            name=name,
            description=description,
            user_id=user_id,
            embedding_model_id=embedding_model_id,
            chunk_max_size=chunk_max_size,
            chunk_overlap_size=chunk_overlap_size,
            chunk_min_size=chunk_min_size,
            is_public=is_public,
            metadata_config=metadata_config,
        )
        self.session.add(kb)
        await self.session.flush()
        return kb

    async def get_kb(self, kb_id: str) -> Optional[KnowledgeBase]:
        """获取知识库

        Args:
            kb_id: 知识库 ID

        Returns:
            Optional[KnowledgeBase]: 知识库对象，不存在返回 None
        """
        stmt = select(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.is_active == True
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_kbs_by_ids(self, kb_ids: List[str]) -> List[KnowledgeBase]:
        """批量获取知识库（使用 IN 查询）

        Args:
            kb_ids: 知识库 ID 列表

        Returns:
            List[KnowledgeBase]: 知识库列表（可能为空）
        """
        if not kb_ids:
            return []
        
        stmt = select(KnowledgeBase).where(
            KnowledgeBase.id.in_(kb_ids),
            KnowledgeBase.is_active == True
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def list_kbs(
        self,
        user_id: str,
        skip: int = 0,
        limit: int = 20,
    ) -> List[KnowledgeBase]:
        """列出用户的知识库

        Args:
            user_id: 用户 ID
            skip: 跳过数量
            limit: 返回数量限制

        Returns:
            List[KnowledgeBase]: 知识库列表
        """
        stmt = select(KnowledgeBase).where(
            KnowledgeBase.user_id == user_id,
            KnowledgeBase.is_active == True
        ).order_by(KnowledgeBase.created_at.desc()).offset(skip).limit(limit)
        
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def update_kb(self, kb_id: str, data: dict) -> Optional[KnowledgeBase]:
        """更新知识库

        Args:
            kb_id: 知识库 ID
            data: 更新数据字典

        Returns:
            Optional[KnowledgeBase]: 更新后的知识库对象
        """
        # 排除只读字段
        readonly_fields = ['id', 'user_id', 'created_at', 'updated_at']
        update_data = {k: v for k, v in data.items() if k not in readonly_fields}
        
        if not update_data:
            return await self.get_kb(kb_id)
        
        stmt = update(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.is_active == True
        ).values(**update_data)
        await self.session.execute(stmt)
        
        return await self.get_kb(kb_id)

    async def delete_kb(self, kb_id: str) -> bool:
        """软删除知识库

        Args:
            kb_id: 知识库 ID

        Returns:
            bool: 是否成功删除
        """
        stmt = update(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.is_active == True
        ).values(is_active=False)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def count_kbs(self, user_id: str) -> int:
        """统计知识库数量

        Args:
            user_id: 用户 ID

        Returns:
            int: 知识库数量
        """
        from sqlalchemy import func
        stmt = select(func.count(KnowledgeBase.id)).where(
            KnowledgeBase.user_id == user_id,
            KnowledgeBase.is_active == True
        )
        result = await self.session.execute(stmt)
        return result.scalar() or 0
