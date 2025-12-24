from datetime import datetime, timezone
import ulid
from sqlalchemy import String, DateTime, Boolean, Text, JSON, ForeignKey, Column
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import ModelBase


class MessageContent(ModelBase):
    __tablename__ = "message_content"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    message_id = Column(
        String(26),
        ForeignKey("message.id", ondelete="CASCADE"),
        index=True,
    )
    is_current = Column(Boolean, default=False)
    content = Column(Text, nullable=True)
    reasoning_content = Column(Text, nullable=True)
    meta_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    message = relationship(
        "Message",
        back_populates="contents",
    )
