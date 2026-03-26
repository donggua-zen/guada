from datetime import datetime, timezone
import ulid

from sqlalchemy import String, DateTime, Text, BigInteger, ForeignKey, Column, Boolean, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import ModelBase


class File(ModelBase):
    __tablename__ = "file"

    id = Column(String(26), primary_key=True, default=lambda: str(ulid.new()))
    file_name = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    file_type = Column(String(100), nullable=False)
    file_extension = Column(String(100), nullable=False)
    content = Column(Text, nullable=True)
    url = Column(String(255), nullable=True)
    preview_url = Column(String(255), nullable=True)
    content_hash = Column(String(64), nullable=False, index=True)
    upload_user_id = Column(String(26), nullable=True, index=True)
    session_id = Column(String(26), nullable=True, index=True)
    message_id = Column(
        String(26),
        ForeignKey("message.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    is_public = Column(Boolean, default=False)
    file_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    message = relationship(
        "Message",
        back_populates="files",
    )
