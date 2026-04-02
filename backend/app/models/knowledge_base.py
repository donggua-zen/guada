"""
知识库模型

支持用户创建和管理独立的知识库
每个知识库可配置独立的向量模型和分块参数
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, String, Text, Integer, Boolean, JSON, ForeignKey, Index
from sqlalchemy.orm import relationship
import ulid
from app.database import ModelBase


class KnowledgeBase(ModelBase):
    """知识库模型
    
    Attributes:
        id: 知识库 ID（ULID 格式）
        name: 知识库名称
        description: 知识库描述
        user_id: 所属用户 ID
        embedding_model_provider: 向量模型提供商（如："openai", "aliyun"）
        embedding_model_name: 向量模型名称（如："text-embedding-v4"）
        chunk_max_size: 最大分块大小（字符数）
        chunk_overlap_size: 分块重叠大小（字符数）
        chunk_min_size: 最小分块大小（字符数）
        is_active: 是否激活（软删除标记）
        is_public: 是否公开
        metadata_config: 额外配置（JSON 格式）
        created_at: 创建时间
        updated_at: 更新时间
    """
    __tablename__ = "knowledge_base"
    
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # 用户关联
    user_id = Column(String(26), nullable=False, index=True, comment="所属用户 ID")
    
    # 向量模型配置（使用 model_id 关联）
    embedding_model_id = Column(
        String(26), 
        ForeignKey("model.id", ondelete="RESTRICT"),
        nullable=False,
        comment="向量模型 ID（关联 model 表）"
    )
    
    # 分块配置
    chunk_max_size = Column(Integer, default=1000, comment="最大分块大小（字符数）")
    chunk_overlap_size = Column(Integer, default=100, comment="分块重叠大小（字符数）")
    chunk_min_size = Column(Integer, default=50, comment="最小分块大小（字符数）")
    
    # 状态
    is_active = Column(Boolean, default=True, comment="是否激活（软删除标记）")
    is_public = Column(Boolean, default=False, comment="是否公开")
    
    # 元数据
    metadata_config = Column(JSON, nullable=True, comment="额外配置")
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    
    # 关联关系
    files = relationship(
        "KBFile", 
        back_populates="knowledge_base", 
        cascade="all, delete-orphan",
        lazy="select"
    )
    
    # 向量模型关联
    embedding_model = relationship(
        "Model",
        back_populates="knowledge_bases",
        lazy="joined"
    )
    
    # 索引
    __table_args__ = (
        Index("idx_kb_user_active", "user_id", "is_active"),
        Index("idx_kb_created", "created_at"),
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "user_id": self.user_id,
            "embedding_model_id": self.embedding_model_id,
            "chunk_config": {
                "max_size": self.chunk_max_size,
                "overlap_size": self.chunk_overlap_size,
                "min_size": self.chunk_min_size,
            },
            "is_active": self.is_active,
            "is_public": self.is_public,
            "metadata_config": self.metadata_config,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
