"""
知识库分块模型

存储文件分块后的文本片段及其向量嵌入信息
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, String, Text, Integer, ForeignKey, Index, JSON
from sqlalchemy.orm import relationship
import ulid
from app.database import ModelBase


class KBChunk(ModelBase):
    """知识库分块模型
    
    Attributes:
        id: 分块 ID（ULID 格式）
        file_id: 所属文件 ID（外键）
        knowledge_base_id: 所属知识库 ID（外键）
        content: 分块文本内容
        chunk_index: 分块索引（在文件中的顺序）
        vector_id: ChromaDB 中的向量 ID
        embedding_dimensions: 向量维度数
        token_count: Token 数量
        metadata: 元数据（如：页码、段落位置等）
        created_at: 创建时间
    """
    __tablename__ = "kb_chunk"
    
    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    
    # 外键关联
    file_id = Column(
        String(26),
        ForeignKey("kb_file.id", ondelete="CASCADE", name="fk_kb_chunk_file_id"),
        nullable=False,
        index=True,
        comment="所属文件 ID"
    )
    knowledge_base_id = Column(
        String(26),
        ForeignKey("knowledge_base.id", ondelete="CASCADE", name="fk_kb_chunk_kb_id"),
        nullable=False,
        index=True,
        comment="所属知识库 ID"
    )
    
    # 分块内容
    content = Column(Text, nullable=False, comment="分块文本内容")
    chunk_index = Column(Integer, nullable=False, comment="分块索引（在文件中的顺序）")
    
    # 向量信息
    vector_id = Column(String(100), nullable=True, index=True, comment="ChromaDB 中的向量 ID")
    embedding_dimensions = Column(Integer, nullable=True, comment="向量维度数")
    
    # Token 信息
    token_count = Column(Integer, default=0, comment="Token 数量")
    
    # 元数据
    chunk_metadata = Column("metadata", JSON, nullable=True, comment="元数据（如：页码、段落位置等）")
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间")
    
    # 关联关系
    file = relationship("KBFile", back_populates="chunks")
    
    # 索引
    __table_args__ = (
        Index("idx_kb_chunk_file", "file_id"),
        Index("idx_kb_chunk_kb", "knowledge_base_id"),
        Index("idx_kb_chunk_vector", "vector_id"),
    )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "file_id": self.file_id,
            "knowledge_base_id": self.knowledge_base_id,
            "content": self.content,
            "chunk_index": self.chunk_index,
            "vector_id": self.vector_id,
            "embedding_dimensions": self.embedding_dimensions,
            "token_count": self.token_count,
            "metadata": self.chunk_metadata,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
