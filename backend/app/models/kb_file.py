"""
知识库文件模型

记录上传到知识库的文件及其处理状态
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    DateTime,
    String,
    Text,
    Integer,
    ForeignKey,
    Index,
    BigInteger,
)
from sqlalchemy.orm import relationship
import ulid
from app.database import ModelBase


class KBFile(ModelBase):
    """知识库文件模型

    Attributes:
        id: 文件 ID（ULID 格式）
        knowledge_base_id: 所属知识库 ID（外键）
        file_name: 原始文件名
        display_name: 显示名称
        file_size: 文件大小（字节）
        file_type: 文件类型（text, pdf, code, image 等）
        file_extension: 文件扩展名
        content_hash: 文件内容哈希（SHA-256，用于去重检测）
        content: 文件内容（纯文本文件存储完整内容）
        processing_status: 处理状态（pending, processing, completed, failed）
        progress_percentage: 处理进度百分比（0-100）
        current_step: 当前处理步骤描述
        error_message: 错误信息（如果失败）
        total_chunks: 总分块数
        total_tokens: 总 token 数
        uploaded_at: 上传时间
        processed_at: 处理完成时间
    """

    __tablename__ = "kb_file"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))

    # 外键关联
    knowledge_base_id = Column(
        String(26),
        ForeignKey("knowledge_base.id", ondelete="CASCADE", name="fk_kb_file_kb_id"),
        nullable=False,
        index=True,
        comment="所属知识库 ID",
    )

    # 文件基本信息
    file_name = Column(String(255), nullable=False, comment="原始文件名")
    display_name = Column(String(255), nullable=False, comment="显示名称")
    file_size = Column(BigInteger, nullable=False, comment="文件大小（字节）")
    file_type = Column(
        String(100), nullable=False, comment="文件类型：text/pdf/code/image 等"
    )
    file_extension = Column(String(100), nullable=False, comment="文件扩展名")
    content_hash = Column(
        String(64), nullable=False, index=True, comment="文件内容哈希（SHA-256）"
    )

    # ✅ 新增：文件存储路径（绝对路径，用于服务重启后恢复）
    file_path = Column(String(500), nullable=True, comment="文件存储路径（绝对路径）")

    # 文件内容（纯文本文件存储完整内容）
    content = Column(Text, nullable=True, comment="文件内容")

    # 处理状态
    processing_status = Column(
        String(50),
        default="pending",
        comment="处理状态：pending/processing/completed/failed",
    )
    progress_percentage = Column(Integer, default=0, comment="处理进度百分比（0-100）")
    current_step = Column(String(255), nullable=True, comment="当前处理步骤描述")
    error_message = Column(Text, nullable=True, comment="错误信息")

    # 处理结果
    total_chunks = Column(Integer, default=0, comment="总分块数")
    total_tokens = Column(Integer, default=0, comment="总 token 数")

    # 时间戳
    uploaded_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="上传时间"
    )
    processed_at = Column(DateTime, nullable=True, comment="处理完成时间")

    # 关联关系
    knowledge_base = relationship("KnowledgeBase", back_populates="files")
    chunks = relationship(
        "KBChunk", back_populates="file", cascade="all, delete-orphan", lazy="select"
    )

    # 索引
    __table_args__ = (
        Index("idx_kb_file_kb_status", "knowledge_base_id", "processing_status"),
        Index("idx_kb_file_uploaded", "uploaded_at"),
    )
