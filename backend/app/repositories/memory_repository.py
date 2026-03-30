"""
记忆仓库 - 负责记忆的数据库操作

支持 SQLite 和 MySQL 双数据库兼容
"""

from typing import Dict, List, Optional
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.memory import Memory


class MemoryRepository:
    """记忆仓库"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_memory(
        self,
        session_id: str,
        content: str,
        memory_type: str = "general",
        importance: int = 5,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict] = None,
    ) -> Memory:
        """创建记忆
        
        Args:
            session_id: 会话 ID
            content: 记忆内容
            memory_type: 记忆类型
            importance: 重要性评分（1-10）
            tags: 标签列表
            metadata: 元数据
            
        Returns:
            Memory: 创建的记忆对象
        """
        memory = Memory(
            session_id=session_id,
            content=content,
            memory_type=memory_type,
            importance=importance,
            tags=tags or [],
            metadata_=metadata,
        )
        self.session.add(memory)
        await self.session.flush()  # 获取生成的 ID
        return memory
    
    async def search_memories(
        self,
        session_id: str,
        query: Optional[str] = None,
        memory_type: Optional[str] = None,
        min_importance: Optional[int] = None,
        tags: Optional[List[str]] = None,
        limit: int = 10,
    ) -> List[Memory]:
        """搜索记忆
        
        Args:
            session_id: 会话 ID
            query: 搜索关键词（全文搜索）
            memory_type: 记忆类型过滤
            min_importance: 最小重要性
            tags: 标签过滤
            limit: 返回数量限制
            
        Returns:
            List[Memory]: 记忆列表
        """
        stmt = select(Memory).filter(Memory.session_id == session_id)
        
        # 类型过滤
        if memory_type:
            stmt = stmt.filter(Memory.memory_type == memory_type)
        
        # 重要性过滤
        if min_importance is not None:
            stmt = stmt.filter(Memory.importance >= min_importance)
        
        # 标签过滤（JSON 包含查询）
        if tags:
            for tag in tags:
                # SQLite 和 MySQL 都支持 JSON 包含查询
                stmt = stmt.filter(Memory.tags.contains([tag]))
        
        # 全文搜索（简单 LIKE，后续可用 FTS 优化）
        if query:
            stmt = stmt.filter(Memory.content.ilike(f"%{query}%"))
        
        # 排序：重要性降序，时间降序
        stmt = stmt.order_by(
            desc(Memory.importance),
            desc(Memory.created_at)
        )
        
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
        limit: int = 20,
    ) -> str:
        """获取记忆摘要
        
        Args:
            session_id: 会话 ID
            limit: 最多返回的记忆数量
            
        Returns:
            str: 记忆摘要文本
        """
        stmt = (
            select(Memory)
            .filter(Memory.session_id == session_id)
            .order_by(desc(Memory.importance), desc(Memory.created_at))
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        memories = result.scalars().all()
        
        if not memories:
            return "暂无长期记忆"
        
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
        
        ⚠️ 预留接口，暂不实现
        
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
