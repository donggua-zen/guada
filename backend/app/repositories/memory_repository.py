"""
记忆仓库 - 负责记忆的数据库操作

支持 SQLite 和 MySQL 双数据库兼容
已重构为支持长期/短期记忆分离架构
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.memory import (
    Memory,
    MemoryCategory,
    LongTermMemoryType,
    ShortTermMemoryType,
)


class MemoryRepository:
    """记忆仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_memory(
        self,
        session_id: str,
        content: str,
        category: str = "long_term",
        memory_type: str = "factual",
        importance: int = 5,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict] = None,
        expires_at: Optional[datetime] = None,
    ) -> Memory:
        """创建记忆（增强版）

        Args:
            session_id: 会话 ID
            content: 记忆内容
            category: 记忆分类（long_term/short_term）
            memory_type: 记忆子类型
            importance: 重要性评分（1-10）
            tags: 标签列表
            metadata: 元数据
            expires_at: 过期时间（仅短期记忆使用）

        Returns:
            Memory: 创建的记忆对象
        """
        memory = Memory(
            session_id=session_id,
            content=content,
            category=category,
            memory_type=memory_type,
            importance=importance,
            tags=tags or [],
            metadata_=metadata,
            expires_at=expires_at,
        )
        self.session.add(memory)
        await self.session.flush()  # 获取生成的 ID
        return memory

    async def upsert_long_term_memory(
        self,
        session_id: str,
        memory_type: str = "factual",
        content: str = None,
        write_mode: str = "append",
    ) -> Memory:
        """Upsert 长期记忆（按类型编辑或自动创建）
            
        设计说明:
        - 根据 memory_type 查找对应类型的记忆记录
        - 如果记录存在则执行更新操作，如果不存在则自动创建新记录
        - 支持两种写入模式：append(追加) 和 overwrite(覆盖)
            
        Args:
            session_id: 会话 ID（用于数据隔离）
            memory_type: 记忆类型（factual/soul）- 用于定位记录
            content: 记忆内容
            write_mode: 写入模式（append/overwrite），默认 append
                
        Returns:
            Memory: 创建或更新的记忆对象
        """
        # 根据类型查找现有记录
        stmt = select(Memory).filter(
            and_(
                Memory.session_id == session_id,
                Memory.category == MemoryCategory.LONG_TERM.value,
                Memory.memory_type == memory_type
            )
        )
        result = await self.session.execute(stmt)
        existing = result.scalar_one_or_none()
            
        if existing:
            # 更新现有记录
            if write_mode == "overwrite":
                # 覆盖模式：完全替换原有内容
                existing.content = content
            else:
                # 追加模式：将新内容添加到现有内容后面
                if existing.content:
                    existing.content = existing.content + "\n" + content
                else:
                    existing.content = content
            await self.session.flush()
            return existing
            
        # 记录不存在，创建新记录
        new_memory = Memory(
            session_id=session_id,
            category=MemoryCategory.LONG_TERM.value,
            memory_type=memory_type,
            content=content,
            importance=5,  # 默认重要性
            tags=[],  # 空标签
        )
        self.session.add(new_memory)
        await self.session.flush()
        return new_memory

    async def add_short_term_memory(
        self,
        session_id: str,
        content: str,
        memory_type: str = "temporary",
        ttl_seconds: int = 3600,
        tags: Optional[List[str]] = None,
    ) -> Memory:
        """添加短期记忆（带过期时间）

        Args:
            session_id: 会话 ID
            content: 记忆内容
            memory_type: 记忆子类型（temporary/context）
            ttl_seconds: 生存时间（秒），默认 1 小时
            tags: 标签列表

        Returns:
            Memory: 创建的短期记忆对象
        """
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)

        new_memory = Memory(
            session_id=session_id,
            category=MemoryCategory.SHORT_TERM.value,
            memory_type=memory_type,
            content=content,
            expires_at=expires_at,
            tags=tags or [],
        )
        self.session.add(new_memory)
        await self.session.flush()
        return new_memory

    async def search_short_term_memories(
        self,
        session_id: str,
        query: Optional[str] = None,
        memory_type: Optional[str] = None,
        limit: int = 10,
    ) -> List[Memory]:
        """搜索短期记忆（自动过滤过期数据）

        Args:
            session_id: 会话 ID
            query: 搜索关键词
            memory_type: 记忆子类型过滤
            limit: 返回数量限制

        Returns:
            List[Memory]: 未过期的短期记忆列表
        """
        now = datetime.now(timezone.utc)

        stmt = select(Memory).filter(
            and_(
                Memory.session_id == session_id,
                Memory.category == MemoryCategory.SHORT_TERM.value,
                or_(
                    Memory.expires_at.is_(None),  # 没有过期时间
                    Memory.expires_at > now,  # 未过期
                ),
            )
        )

        if memory_type:
            stmt = stmt.filter(Memory.memory_type == memory_type)

        if query:
            stmt = stmt.filter(Memory.content.ilike(f"%{query}%"))

        stmt = stmt.order_by(desc(Memory.created_at)).limit(limit)

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete_short_term_memory(
        self,
        session_id: str,
        memory_id: str,
    ) -> bool:
        """删除短期记忆（带权限验证）

        Args:
            session_id: 会话 ID（用于权限验证）
            memory_id: 记忆 ID

        Returns:
            bool: 是否成功删除
        """
        stmt = select(Memory).filter(
            and_(
                Memory.id == memory_id,
                Memory.session_id == session_id,
                Memory.category == MemoryCategory.SHORT_TERM.value,
            )
        )
        result = await self.session.execute(stmt)
        memory = result.scalar_one_or_none()

        if not memory:
            return False

        await self.session.delete(memory)
        return True

    async def cleanup_expired_short_term_memories(self) -> int:
        """清理所有过期的短期记忆

        Returns:
            int: 清理的记录数量
        """
        now = datetime.now(timezone.utc)

        stmt = select(Memory).filter(
            and_(
                Memory.category == MemoryCategory.SHORT_TERM.value,
                Memory.expires_at.isnot(None),
                Memory.expires_at <= now,
            )
        )
        result = await self.session.execute(stmt)
        expired_memories = result.scalars().all()

        for memory in expired_memories:
            await self.session.delete(memory)

        return len(expired_memories)

    async def search_memories(
        self,
        session_id: str,
        category: Optional[str] = None,
        query: Optional[str] = None,
        memory_type: Optional[str] = None,
        min_importance: Optional[int] = None,
        tags: Optional[List[str]] = None,
        limit: int = 10,
        exclude_expired: bool = True,
    ) -> List[Memory]:
        """搜索记忆（增强版，支持分类和过期过滤）

        Args:
            session_id: 会话 ID
            category: 记忆分类过滤（long_term/short_term）
            query: 搜索关键词（全文搜索）
            memory_type: 记忆子类型过滤
            min_importance: 最小重要性
            tags: 标签过滤
            limit: 返回数量限制
            exclude_expired: 是否排除过期的短期记忆

        Returns:
            List[Memory]: 记忆列表
        """
        now = datetime.now(timezone.utc)

        # 基础查询条件
        filters = [Memory.session_id == session_id]

        # 分类过滤
        if category:
            filters.append(Memory.category == category)

        # 类型过滤
        if memory_type:
            filters.append(Memory.memory_type == memory_type)

        # 重要性过滤
        if min_importance is not None:
            filters.append(Memory.importance >= min_importance)

        # 标签过滤（JSON 包含查询）
        if tags:
            for tag in tags:
                filters.append(Memory.tags.contains([tag]))

        # 过期过滤
        if exclude_expired:
            filters.append(or_(Memory.expires_at.is_(None), Memory.expires_at > now))

        stmt = select(Memory).filter(and_(*filters))

        # 全文搜索（简单 LIKE，后续可用 FTS 优化）
        if query:
            stmt = stmt.filter(Memory.content.ilike(f"%{query}%"))

        # 排序：重要性降序，时间降序
        stmt = stmt.order_by(desc(Memory.importance), desc(Memory.created_at))

        # 限制数量
        stmt = stmt.limit(limit)

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update_memory(
        self,
        memory_id: str,
        content: Optional[str] = None,
        importance: Optional[int] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict] = None,
    ) -> Optional[Memory]:
        """更新记忆

        Args:
            memory_id: 记忆 ID
            content: 新内容
            importance: 新重要性
            tags: 新标签
            metadata: 新元数据

        Returns:
            Optional[Memory]: 更新后的记忆，None 表示未找到
        """
        stmt = select(Memory).filter(Memory.id == memory_id)
        result = await self.session.execute(stmt)
        memory = result.scalar_one_or_none()

        if not memory:
            return None

        # 更新字段
        if content:
            memory.content = content
        if importance is not None:
            memory.importance = importance
        if tags is not None:
            memory.tags = tags
        if metadata is not None:
            memory.metadata_ = metadata

        await self.session.flush()
        return memory

    async def delete_memory(self, memory_id: str) -> bool:
        """删除记忆

        Args:
            memory_id: 记忆 ID

        Returns:
            bool: 是否成功删除
        """
        stmt = select(Memory).filter(Memory.id == memory_id)
        result = await self.session.execute(stmt)
        memory = result.scalar_one_or_none()

        if not memory:
            return False

        await self.session.delete(memory)
        return True

    async def get_memory_by_id(self, memory_id: str) -> Optional[Memory]:
        """根据 ID 获取记忆"""
        stmt = select(Memory).filter(Memory.id == memory_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def summarize_memories(
        self,
        session_id: str,
        category: str = "long_term",
        limit: int = 20,
    ) -> str:
        """获取记忆摘要（增强版）

        Args:
            session_id: 会话 ID
            category: 记忆分类（long_term/short_term）
            limit: 最多返回的记忆数量

        Returns:
            str: 记忆摘要文本
        """
        now = datetime.now(timezone.utc)

        stmt = (
            select(Memory)
            .filter(
                and_(
                    Memory.session_id == session_id,
                    Memory.category == category,
                    or_(Memory.expires_at.is_(None), Memory.expires_at > now),
                )
            )
            .order_by(desc(Memory.importance), desc(Memory.created_at))
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        memories = result.scalars().all()

        if not memories:
            return "暂无记忆"

        summaries = []
        for mem in memories:
            summaries.append(f"[{mem.memory_type}] {mem.content}")

        return "\n".join(summaries)

    # ========== 预留接口：向量搜索（暂不实现）==========

    async def search_similar_memories(
        self,
        session_id: str,
        embedding: List[float],
        threshold: float = 0.7,
        limit: int = 10,
    ) -> List[Memory]:
        """搜索相似记忆（基于向量相似度）

        预留接口，暂不实现

        Args:
            session_id: 会话 ID
            embedding: 查询向量
            threshold: 相似度阈值
            limit: 返回数量

        Returns:
            List[Memory]: 相似记忆列表
        """
        # TODO: 实现向量搜索
        # 需要在 metadata_中存储向量嵌入
        # 可使用 FAISS、ChromaDB 或数据库原生向量插件
        raise NotImplementedError("向量搜索功能暂未实现")
