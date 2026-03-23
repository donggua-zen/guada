from datetime import datetime, timezone
from typing import TYPE_CHECKING, List
import ulid
from sqlalchemy import String, DateTime, ForeignKey, Column, Text
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func
from app.database import ModelBase

if TYPE_CHECKING:
    from app.models.file import File
    from app.models.message_content import MessageContent


class Message(ModelBase):
    __tablename__ = "message"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    session_id = Column(
        String(26),
        ForeignKey("session.id", ondelete="CASCADE"),
        index=True,
    )
    role = Column(String(50))
    parent_id = Column(String(26), nullable=True)
    current_turns_id = Column(String(26), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    files: Mapped[List["File"]] = relationship(
        "File",
        back_populates="message",
        cascade="save-update, merge, refresh-expire",  # 不要级联删除files，files会置空外键
    )
    session = relationship(
        "Session",
        back_populates="messages",
    )

    contents: Mapped[List["MessageContent"]] = relationship(
        "MessageContent",
        back_populates="message",
        cascade="all, delete-orphan",
    )
