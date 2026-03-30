"""
长期记忆存储模型

支持 SQLite 和 MySQL 双数据库兼容
"""

from datetime import datetime, timezone
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text, func, Index
from sqlalchemy.orm import relationship
import ulid
from app.database import ModelBase


class Memory(ModelBase):
    """长期记忆
    
    Attributes:
        id: 记忆 ID（ULID 格式）
        session_id: 所属会话 ID（外键）
        content: 记忆内容（文本）
        memory_type: 记忆类型（general/emotional/factual）
        importance: 重要性评分（1-10）
        tags: 标签列表（JSON 格式）
        metadata_: 元数据（JSON 格式，预留向量嵌入等）
        created_at: 创建时间
        updated_at: 更新时间
    """
    __tablename__ = "memories"
    
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    
    session_id = Column(
        String(26),
        ForeignKey("session.id", ondelete="CASCADE", name="fk_memory_session_id"),
        index=True,
        nullable=False,
    )
    
    content = Column(Text, nullable=False)
    
    memory_type = Column(
        String(50), 
        nullable=False, 
        default="general",
        comment="记忆类型：general(一般)/emotional(情感)/factual(事实)"
    )
    
    importance = Column(
        Integer, 
        default=5,
        comment="重要性评分：1-10"
    )
    
    tags = Column(JSON, nullable=True, comment="标签列表")
    
    metadata_ = Column(
        "metadata",  # 列名为 metadata，避免 Python 关键字冲突
        JSON, 
        nullable=True,
        comment="元数据（预留向量嵌入等）"
    )
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    
    # 关系
    session = relationship("Session", back_populates="memories")
    
    # 索引
    __table_args__ = (
        Index("idx_memory_type", "memory_type"),
        Index("idx_memory_importance", "importance"),
        # MySQL 和 SQLite 都支持复合索引
        Index("idx_memory_session_type", "session_id", "memory_type"),
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "content": self.content,
            "memory_type": self.memory_type,
            "importance": self.importance,
            "tags": self.tags or [],
            "metadata": self.metadata_,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
