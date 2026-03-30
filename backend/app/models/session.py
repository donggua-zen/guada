from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
import ulid

from sqlalchemy import String, DateTime, JSON, ForeignKey, Column, Text, BigInteger
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func
from app.database import ModelBase

if TYPE_CHECKING:
    from app.models.model import Model
    from app.models.message import Message


class Session(ModelBase):
    __tablename__ = "session"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    title = Column(String(255), index=True)
    user_id = Column(String(26), index=True)
    avatar_url = Column(String(255), nullable=True)
    description = Column(String(512), nullable=True)
    model_id = Column(
        String(26),
        ForeignKey("model.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    character_id = Column(
        String(26),
        ForeignKey("character.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    settings = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    last_active_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        index=True,
        nullable=True,
    )

    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    summary = relationship(
        "Summary",
        back_populates="session",
        cascade="all, delete-orphan",
        uselist=False,  # 关键参数，表示一对一关系
    )
    
    memories = relationship(
        "Memory",
        back_populates="session",
        cascade="all, delete-orphan",  # 删除会话时自动删除记忆
    )

    model: Mapped[Optional["Model"]] = relationship(
        "Model",
        # 添加 passive_deletes 配置，确保 SQLAlchemy 知道数据库会处理 SET NULL
        passive_deletes=True,
        uselist=False,  # 关键参数，表示一对一关系
    )

    character: Mapped[Optional["Character"]] = relationship(
        "Character",
        passive_deletes=True,
        uselist=False,
    )
