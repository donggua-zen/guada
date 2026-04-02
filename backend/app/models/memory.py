"""
长期记忆存储模型

支持 SQLite 和 MySQL 双数据库兼容
已重构为支持长期/短期记忆分离架构
"""

from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text, func, Index
from sqlalchemy.orm import relationship
import ulid
from app.database import ModelBase


class MemoryCategory(str, Enum):
    """记忆分类（顶层分类）"""
    LONG_TERM = "long_term"      # 长期记忆
    SHORT_TERM = "short_term"    # 短期记忆


class LongTermMemoryType(str, Enum):
    """长期记忆细分类型"""
    FACTUAL = "factual"          # 核心事实性知识
    SOUL = "soul"               # AI 人格与风格定义


class ShortTermMemoryType(str, Enum):
    """短期记忆类型（可扩展）"""
    TEMPORARY = "temporary"      # 临时信息
    CONTEXT = "context"         # 上下文缓冲


class Memory(ModelBase):
    """记忆模型（支持长期/短期记忆）
    
    Attributes:
        id: 记忆 ID（ULID 格式）
        session_id: 所属会话 ID（外键）
        category: 记忆分类（long_term/short_term）
        content: 记忆内容（文本）
        memory_type: 记忆子类型（factual/soul 或 temporary/context）
        importance: 重要性评分（1-10）
        tags: 标签列表（JSON 格式）
        metadata_: 元数据（JSON 格式，预留向量嵌入等）
        expires_at: 过期时间（仅短期记忆使用）
        created_at: 创建时间
        updated_at: 更新时间
    """
    __tablename__ = "memory"
    
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    
    session_id = Column(
        String(26),
        ForeignKey("session.id", ondelete="CASCADE", name="fk_memory_session_id"),
        index=True,
        nullable=False,
    )
    
    content = Column(Text, nullable=False)
    
    # ===== 记忆分类字段 =====
    category = Column(
        String(20),
        nullable=False,
        default="long_term",
        server_default="long_term",
        comment="记忆分类：long_term/short_term"
    )
    
    # 复用 memory_type 字段，但语义扩展
    memory_type = Column(
        String(50), 
        nullable=False, 
        default="factual",
        comment="记忆子类型：factual/soul(长期) 或 temporary/context(短期)"
    )
    
    importance = Column(
        Integer, 
        default=5,
        comment="重要性评分：1-10"
    )
    
    tags = Column(JSON, nullable=True, comment="标签列表")
    
    metadata_ = Column(
        "metadata",  # 数据库列名映射到 Python 属性
        JSON, 
        nullable=True,
        default=dict,
        comment="元数据（预留向量嵌入等）"
    )
    
    # ===== 短期记忆特有字段 =====
    expires_at = Column(
        DateTime,
        nullable=True,
        comment="过期时间（仅短期记忆使用）"
    )
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    
    # 关系
    session = relationship("Session", back_populates="memories")
    
    # 索引（增强版）
    __table_args__ = (
        Index("idx_memory_category", "category"),
        Index("idx_memory_session_category", "session_id", "category"),
        Index("idx_memory_type", "memory_type"),
        Index("idx_memory_importance", "importance"),
        Index("idx_memory_expires", "expires_at"),
        # MySQL 和 SQLite 都支持复合索引
        Index("idx_memory_session_type", "session_id", "memory_type"),
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "category": self.category.value if isinstance(self.category, MemoryCategory) else self.category,
            "content": self.content,
            "memory_type": self.memory_type,
            "importance": self.importance,
            "tags": self.tags or [],
            "metadata": self.metadata_,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
